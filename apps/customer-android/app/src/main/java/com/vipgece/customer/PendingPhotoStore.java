package com.vipgece.customer;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Immutable upload envelopes and small atomic state records in app-private storage. */
final class PendingPhotoStore {
    static final int MAX_IMAGE_BYTES=8*1024*1024, MAX_JOBS=24;
    static final long MAX_QUEUE_BYTES=128L*1024*1024;
    private static final Object LOCK=new Object();
    private static final String ID="[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
    enum State { PENDING, UPLOADING, RETRYING, AUTH_REQUIRED, FAILED, DONE, CANCELLED }
    static final class Entry {
        final String id,accountId,profileId,mime,sha256,error;
        final int size;
        final long created,updated;
        final State state;
        Entry(Properties p) throws IOException {
            try {
                id=p.getProperty("id","");accountId=p.getProperty("account","");profileId=p.getProperty("profile","");
                mime=p.getProperty("mime","");sha256=p.getProperty("sha256","");error=p.getProperty("error","");
                size=Integer.parseInt(p.getProperty("size","0"));created=Long.parseLong(p.getProperty("created","0"));
                updated=Long.parseLong(p.getProperty("updated","0"));state=State.valueOf(p.getProperty("state","PENDING"));
                if(!"1".equals(p.getProperty("schema"))||!id.matches(ID)||!validScope(accountId)||!validScope(profileId)||
                    !validMime(mime)||!sha256.matches("[a-f0-9]{64}")||size<1||size>MAX_IMAGE_BYTES||created<=0||updated<created||
                    !error.matches("[A-Z_0-9]{0,64}"))throw new IllegalArgumentException();
            }catch(RuntimeException e){throw new IOException("Invalid upload record",e);}
        }
        boolean terminal(){return state==State.DONE||state==State.CANCELLED;}
        Properties properties(){
            Properties p=new Properties();p.setProperty("schema","1");p.setProperty("id",id);
            p.setProperty("account",accountId);p.setProperty("profile",profileId);p.setProperty("mime",mime);
            p.setProperty("sha256",sha256);p.setProperty("size",Integer.toString(size));
            p.setProperty("created",Long.toString(created));p.setProperty("updated",Long.toString(updated));
            p.setProperty("state",state.name());p.setProperty("error",error);return p;
        }
        boolean sameContent(Entry other){return accountId.equals(other.accountId)&&profileId.equals(other.profileId)&&
            mime.equals(other.mime)&&sha256.equals(other.sha256)&&size==other.size&&created==other.created;}
    }
    private final File root;
    PendingPhotoStore(File directory) throws IOException {
        synchronized(LOCK){
            root=directory.getCanonicalFile();
            if(!root.isDirectory()&&!root.mkdirs())throw new IOException("Upload storage unavailable");
            File[] partials=root.listFiles((dir,name)->name.matches(ID+"\\.part"));
            if(partials==null)throw new IOException("Upload storage unavailable");
            // All writers use LOCK and a single app process. Uncommitted envelopes are never queued.
            for(File partial:partials)Files.deleteIfExists(partial.toPath());
        }
    }
    static boolean validScope(String value){return value!=null&&value.matches("[A-Za-z0-9_-]{1,80}");}
    static boolean validMime(String value){return Arrays.asList("image/jpeg","image/png","image/webp").contains(value);}
    private File file(String id,String suffix) throws IOException {
        if(id==null||!id.matches(ID))throw new IOException("Invalid upload identifier");
        File value=new File(root,id+suffix);
        if(!value.getCanonicalFile().getParentFile().equals(root)||Files.isSymbolicLink(value.toPath()))throw new IOException("Invalid upload path");
        return value;
    }
    static String digest(byte[] bytes) throws IOException {
        try {
            StringBuilder result=new StringBuilder();
            for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))result.append(String.format(Locale.ROOT,"%02x",b&255));
            return result.toString();
        }catch(java.security.NoSuchAlgorithmException e){throw new IOException("SHA256 unavailable",e);}
    }
    Entry stage(String id,String account,String profile,String mime,byte[] bytes) throws IOException {
        synchronized(LOCK){
            if(!validScope(account)||!validScope(profile)||!validMime(mime)||bytes==null||bytes.length<1||bytes.length>MAX_IMAGE_BYTES)
                throw new IOException("Invalid upload");
            File target=file(id,".job");String sha=digest(bytes);
            if(target.exists()||file(id,".state").exists()){
                Entry existing=load(id);
                if(!existing.accountId.equals(account)||!existing.profileId.equals(profile)||!existing.mime.equals(mime)||
                    !existing.sha256.equals(sha))throw new IOException("Upload identifier conflict");
                return existing;
            }
            pruneReceipts();
            File[] jobs=root.listFiles((dir,name)->name.endsWith(".job"));
            if(jobs==null)throw new IOException("Upload storage unavailable");
            long used=0;for(File job:jobs)used+=job.length();
            if(jobs.length>=MAX_JOBS||used+bytes.length+8192>MAX_QUEUE_BYTES)throw new IOException("Upload queue is full");
            Properties p=new Properties();p.setProperty("schema","1");p.setProperty("id",id);p.setProperty("account",account);
            p.setProperty("profile",profile);p.setProperty("mime",mime);p.setProperty("sha256",sha);
            p.setProperty("size",Integer.toString(bytes.length));String now=Long.toString(System.currentTimeMillis());
            p.setProperty("created",now);p.setProperty("updated",now);p.setProperty("state",State.PENDING.name());
            File partial=file(id,".part");
            try {
                try(FileOutputStream out=new FileOutputStream(partial);ZipOutputStream zip=new ZipOutputStream(out)){
                    zip.setLevel(Deflater.NO_COMPRESSION);
                    zip.putNextEntry(new ZipEntry("metadata.properties"));p.store(zip,null);zip.closeEntry();
                    zip.putNextEntry(new ZipEntry("original.bin"));zip.write(bytes);zip.closeEntry();
                    zip.finish();zip.flush();out.getFD().sync();
                }
                Files.move(partial.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);
            }finally{Files.deleteIfExists(partial.toPath());}
            return new Entry(p);
        }
    }
    private Properties readProperties(InputStream stream) throws IOException {
        Properties p=new Properties();p.load(new ByteArrayInputStream(ApiClient.readBounded(stream,8192)));return p;
    }
    Entry load(String id) throws IOException {
        synchronized(LOCK){
            File job=file(id,".job"),state=file(id,".state");Entry envelope=null,saved=null;
            if(job.exists())try(ZipFile zip=new ZipFile(job)){
                if(zip.size()!=2||zip.getEntry("metadata.properties")==null||zip.getEntry("original.bin")==null)
                    throw new IOException("Invalid upload envelope");
                try(InputStream input=zip.getInputStream(zip.getEntry("metadata.properties"))){envelope=new Entry(readProperties(input));}
                if(!id.equals(envelope.id))throw new IOException("Upload identity mismatch");
            }
            if(state.exists())try(InputStream input=new FileInputStream(state)){saved=new Entry(readProperties(input));}
            if(saved!=null&&!id.equals(saved.id))throw new IOException("Upload identity mismatch");
            if(envelope!=null&&saved!=null&&!envelope.sameContent(saved))throw new IOException("Upload state mismatch");
            Entry result=saved==null?envelope:saved;
            if(result==null||(envelope==null&&!result.terminal()))throw new IOException("Upload original missing");
            return result;
        }
    }
    byte[] original(String id,String account) throws IOException {
        synchronized(LOCK){
            Entry entry=owned(id,account);
            if(entry.terminal())throw new IOException("Upload already closed");
            try(ZipFile zip=new ZipFile(file(id,".job"));InputStream input=zip.getInputStream(zip.getEntry("original.bin"))){
                byte[] bytes=ApiClient.readBounded(input,MAX_IMAGE_BYTES);
                if(bytes.length!=entry.size||!digest(bytes).equals(entry.sha256))throw new IOException("Upload original damaged");
                return bytes;
            }
        }
    }
    private Entry owned(String id,String account) throws IOException {
        Entry entry=load(id);if(!entry.accountId.equals(account))throw new IOException("Upload account mismatch");return entry;
    }
    Entry state(String id,String account,State next,String error) throws IOException {
        synchronized(LOCK){
            Entry current=owned(id,account);if(current.terminal())return current;
            Properties p=current.properties();p.setProperty("state",next.name());p.setProperty("error",error);
            p.setProperty("updated",Long.toString(Math.max(current.created,System.currentTimeMillis())));
            Entry result=new Entry(p);File partial=file(id,".part");
            try {
                try(FileOutputStream out=new FileOutputStream(partial)){p.store(out,null);out.getFD().sync();}
                Files.move(partial.toPath(),file(id,".state").toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            }finally{Files.deleteIfExists(partial.toPath());}
            if(result.terminal())Files.deleteIfExists(file(id,".job").toPath());
            return result;
        }
    }
    List<Entry> list(String account) throws IOException {
        synchronized(LOCK){
            if(!validScope(account))return Collections.emptyList();
            List<Entry> result=new ArrayList<>();
            for(String id:ids()){
                Entry entry=load(id);
                if(entry.terminal())Files.deleteIfExists(file(id,".job").toPath());
                if(account.equals(entry.accountId))result.add(entry);
            }
            result.sort(Comparator.comparingLong(e->e.created));return result;
        }
    }
    private Set<String> ids() throws IOException {
        File[] files=root.listFiles();if(files==null)throw new IOException("Upload storage unavailable");
        Set<String> ids=new HashSet<>();
        for(File file:files)if(file.getName().matches(ID+"\\.(job|state)"))ids.add(file.getName().substring(0,36));
        return ids;
    }
    private void pruneReceipts() throws IOException {
        List<Entry> closed=new ArrayList<>();for(String id:ids()){Entry e=load(id);if(e.terminal())closed.add(e);}
        closed.sort(Comparator.comparingLong(e->-e.updated));
        for(int i=0;i<closed.size();i++){
            Entry e=closed.get(i);Files.deleteIfExists(file(e.id,".job").toPath());
            if(i>=63)Files.deleteIfExists(file(e.id,".state").toPath());
        }
    }
}
