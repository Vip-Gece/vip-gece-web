package com.vipgece.customer;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.*;
import static org.junit.Assert.*;

public final class PendingPhotoStoreTest {
    private File root;
    private PendingPhotoStore store;
    private byte[] photo;
    @Before public void setup() throws Exception {
        root=Files.createTempDirectory("photo-queue-test-").toFile();store=new PendingPhotoStore(root);
        photo=new byte[4096];new Random(7).nextBytes(photo);
    }
    @After public void cleanup() throws Exception {
        try(java.util.stream.Stream<Path> files=Files.walk(root.toPath())){
            for(Path path:files.sorted(Comparator.reverseOrder()).toArray(Path[]::new))Files.delete(path);
        }
    }
    private String stage() throws Exception {
        String id=UUID.randomUUID().toString();store.stage(id,"account-a","profile-a","image/jpeg",photo);return id;
    }
    @Test public void originalAndIdentitySurviveStoreRecreation() throws Exception {
        String id=stage();PendingPhotoStore restarted=new PendingPhotoStore(root);
        assertArrayEquals(photo,restarted.original(id,"account-a"));
        assertEquals("profile-a",restarted.list("account-a").get(0).profileId);
        assertTrue(restarted.list("account-b").isEmpty());
        assertThrows(IOException.class,()->restarted.original(id,"account-b"));
        assertThrows(IOException.class,()->restarted.state(id,"account-b",PendingPhotoStore.State.CANCELLED,""));
    }
    @Test public void duplicateIdsDoNotDuplicateOrReplaceOriginals() throws Exception {
        String id=stage();store.stage(id,"account-a","profile-a","image/jpeg",photo);
        assertEquals(1,store.list("account-a").size());
        assertThrows(IOException.class,()->store.stage(id,"account-a","profile-b","image/jpeg",photo));
        assertThrows(IOException.class,()->store.stage(id,"account-a","profile-a","image/jpeg",new byte[]{1}));
        assertArrayEquals(photo,store.original(id,"account-a"));
    }
    @Test public void rejectsInvalidScopeMimeSizeAndIdentifiers() throws Exception {
        assertThrows(IOException.class,()->store.stage("../invalid","a","p","image/jpeg",photo));
        assertThrows(IOException.class,()->store.stage(UUID.randomUUID().toString(),"","p","image/jpeg",photo));
        assertThrows(IOException.class,()->store.stage(UUID.randomUUID().toString(),"a","p","text/plain",photo));
        assertThrows(IOException.class,()->store.stage(UUID.randomUUID().toString(),"a","p","image/jpeg",new byte[0]));
        assertThrows(IOException.class,()->store.stage(UUID.randomUUID().toString(),"a","p","image/jpeg",new byte[PendingPhotoStore.MAX_IMAGE_BYTES+1]));
    }
    @Test public void uncommittedTemporaryFileIsNeverScheduled() throws Exception {
        String partial=UUID.randomUUID().toString()+".part";Files.write(new File(root,partial).toPath(),photo);
        store=new PendingPhotoStore(root);assertTrue(store.list("account-a").isEmpty());assertFalse(new File(root,partial).exists());
    }
    @Test public void capacityIsBoundedAcrossAccounts() throws Exception {
        for(int i=0;i<PendingPhotoStore.MAX_JOBS;i++)store.stage(UUID.randomUUID().toString(),i%2==0?"account-a":"account-b","p","image/jpeg",photo);
        assertThrows(IOException.class,this::stage);
    }
    @Test public void byteBudgetIsEnforcedBeforeTheJobCountLimit() throws Exception {
        byte[] large=new byte[PendingPhotoStore.MAX_IMAGE_BYTES];new Random(9).nextBytes(large);
        for(int i=0;i<15;i++)store.stage(UUID.randomUUID().toString(),"account-a","p","image/jpeg",large);
        assertThrows(IOException.class,()->store.stage(UUID.randomUUID().toString(),"account-b","p","image/jpeg",large));
        assertEquals(15,store.list("account-a").size());
        assertTrue(store.list("account-b").isEmpty());
    }
    @Test public void truncatedEnvelopeIsRejectedAndNeverSilentlyRemoved() throws Exception {
        String id=stage();Path job=new File(root,id+".job").toPath();byte[] bytes=Files.readAllBytes(job);
        Files.write(job,Arrays.copyOf(bytes,bytes.length/2));
        assertThrows(IOException.class,()->new PendingPhotoStore(root).original(id,"account-a"));
        assertTrue(Files.exists(job));
    }
    @Test public void originalsRemainUntilConfirmedOrExplicitlyCancelled() throws Exception {
        String id=stage();store.state(id,"account-a",PendingPhotoStore.State.RETRYING,"NETWORK_RETRY");
        assertArrayEquals(photo,new PendingPhotoStore(root).original(id,"account-a"));
        store.state(id,"account-a",PendingPhotoStore.State.DONE,"");
        assertFalse(new File(root,id+".job").exists());assertEquals(PendingPhotoStore.State.DONE,new PendingPhotoStore(root).load(id).state);
        assertEquals(PendingPhotoStore.State.DONE,store.state(id,"account-a",PendingPhotoStore.State.PENDING,"").state);
    }
    @Test public void concurrentSameIdStagingProducesOneEnvelope() throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(2);String id=UUID.randomUUID().toString();
        try {
            List<Future<PendingPhotoStore.Entry>> jobs=pool.invokeAll(Arrays.asList(
                ()->store.stage(id,"account-a","p","image/png",photo),()->new PendingPhotoStore(root).stage(id,"account-a","p","image/png",photo)));
            for(Future<PendingPhotoStore.Entry> job:jobs)assertEquals(id,job.get().id);
            assertEquals(1,store.list("account-a").size());
        }finally{pool.shutdownNow();}
    }
    @Test public void privateMetadataDoesNotContainSessionCredentials() throws Exception {
        String id=stage();store.state(id,"account-a",PendingPhotoStore.State.AUTH_REQUIRED,"SESSION_REQUIRED");
        Properties p=new Properties();try(InputStream input=new FileInputStream(new File(root,id+".state"))){p.load(input);}
        assertFalse(p.containsKey("token"));assertFalse(p.containsKey("password"));assertFalse(p.containsKey("authorization"));
    }
}
