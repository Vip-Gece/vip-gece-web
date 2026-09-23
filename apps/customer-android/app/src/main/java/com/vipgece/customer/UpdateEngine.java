package com.vipgece.customer;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.work.*;
import org.json.JSONObject;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;

final class UpdateEngine {
    static final String CHANNEL="app_updates";
    static final String CHECK_WORK="signed-update-check";
    private static final String PERIODIC_WORK="signed-update-periodic";
    private static final String PREFS="verified_updates_v1";
    private UpdateEngine() {}
    static SharedPreferences prefs(Context c) {return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    @android.annotation.SuppressLint("ApplySharedPref")
    private static void persist(SharedPreferences.Editor edit) throws IOException {
        // Called on the worker thread: rollback and installer state must be durable before proceeding.
        if(!edit.commit())throw new IOException("Cannot persist verified update state");
    }
    static boolean automatic(Context c) {return prefs(c).getBoolean("automatic",true);}
    static void configure(Context c,boolean enabled) {
        prefs(c).edit().putBoolean("automatic",enabled).apply();
        if(enabled)schedule(c);else {WorkManager.getInstance(c).cancelUniqueWork(PERIODIC_WORK);WorkManager.getInstance(c).cancelUniqueWork(CHECK_WORK);}
        FirebaseUpdates.configure(c,enabled);
    }
    static void schedule(Context c) {
        if(!automatic(c))return;
        Constraints constraints=new Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).setRequiresBatteryNotLow(true).setRequiresStorageNotLow(true).build();
        PeriodicWorkRequest periodic=new PeriodicWorkRequest.Builder(UpdateWorker.class,6,TimeUnit.HOURS).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(PERIODIC_WORK,ExistingPeriodicWorkPolicy.KEEP,periodic);
        if(System.currentTimeMillis()-prefs(c).getLong("checked_at",0)>TimeUnit.HOURS.toMillis(6))enqueue(c,false);
    }
    static void enqueue(Context c,boolean manual) {
        if(!manual&&!automatic(c))return;
        Constraints constraints=new Constraints.Builder().setRequiredNetworkType(manual?NetworkType.CONNECTED:NetworkType.UNMETERED).setRequiresStorageNotLow(true).build();
        OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(UpdateWorker.class).setConstraints(constraints).setInputData(new Data.Builder().putBoolean("manual",manual).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build();
        WorkManager.getInstance(c).enqueueUniqueWork(CHECK_WORK,ExistingWorkPolicy.KEEP,work);
    }
    static String state(Context c) {return prefs(c).getString("state","idle");}
    static void state(Context c,String value) {prefs(c).edit().putString("state",value).apply();}
    static long installedVersion(Context c) throws Exception {
        PackageInfo p=c.getPackageManager().getPackageInfo(c.getPackageName(),0);
        return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;
    }
    private static File directory(Context c) throws IOException {
        File dir=new File(c.getFilesDir(),"updates");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Cannot create update directory");return dir;
    }
    private static String publicKey(Context c) throws IOException {
        try(InputStream in=c.getAssets().open("update-public.pem")){return new String(ApiClient.readBounded(in,4096),StandardCharsets.US_ASCII);}
    }
    static final class Release {
        final String envelope,path,hash,certificate,name;
        final long version,size;
        Release(Context c,String json) throws Exception {
            envelope=json;
            JSONObject wrapper=new JSONObject(json);
            if(wrapper.getInt("schema")!=1)throw new SecurityException("Unsupported update envelope");
            byte[] payload=UpdatePolicy.verify(wrapper.getString("payload"),wrapper.getString("signature"),publicKey(c));
            JSONObject p=new JSONObject(new String(payload,StandardCharsets.UTF_8));
            version=p.getLong("version_code");size=p.getLong("size_bytes");hash=p.getString("sha256");certificate=p.getString("certificate_sha256");
            name=p.getString("version_name");path=p.getString("apk_path");
            if(name.isEmpty()||name.length()>80||name.matches("(?s).*\\p{Cntrl}.*"))throw new SecurityException("Invalid version label");
            UpdatePolicy.metadata(p.getString("package_name"),version,size,hash,certificate,p.getLong("issued_at"),p.getLong("expires_at"),System.currentTimeMillis()/1000,p.getInt("min_sdk"),Build.VERSION.SDK_INT);
            UpdatePolicy.apkUrl(UpdatePolicy.origin(BuildConfig.UPDATE_ORIGIN),path);
        }
    }
    private static HttpsURLConnection open(URI url) throws IOException {
        HttpsURLConnection c=(HttpsURLConnection)url.toURL().openConnection();
        c.setConnectTimeout(15000);c.setReadTimeout(30000);c.setInstanceFollowRedirects(false);c.setUseCaches(false);
        c.setRequestProperty("User-Agent","VIP-Gece-Customer-Update/1");return c;
    }
    static synchronized void check(Context c,boolean manual) throws Exception {
        if(!manual&&!automatic(c))return;
        int sessionId=prefs(c).getInt("install_session",-1);
        if(sessionId>=0&&c.getPackageManager().getPackageInstaller().getSessionInfo(sessionId)!=null)return;
        prefs(c).edit().remove("install_session").apply();
        state(c,"checking");
        URI origin=UpdatePolicy.origin(BuildConfig.UPDATE_ORIGIN);
        String json;
        HttpsURLConnection conn=open(origin.resolve(UpdatePolicy.MANIFEST_PATH));
        try {
            int status=conn.getResponseCode();
            if(status==404){state(c,"unpublished");prefs(c).edit().putLong("checked_at",System.currentTimeMillis()).apply();return;}
            if(status!=200)throw new IOException("Update manifest unavailable");
            try(InputStream in=conn.getInputStream()){json=new String(ApiClient.readBounded(in,32768),StandardCharsets.UTF_8);}
        } finally {conn.disconnect();}
        Release r=new Release(c,json);
        long current=installedVersion(c);
        if(r.version<prefs(c).getLong("highest_version",0))throw new SecurityException("Manifest replay rejected");
        if(r.version<=current){state(c,"current");prefs(c).edit().putLong("checked_at",System.currentTimeMillis()).remove("manifest").apply();return;}
        UpdatePolicy.version(r.version,current,prefs(c).getLong("highest_version",0));
        if(!installedCertificates(c).equals(Collections.singleton(r.certificate)))throw new SecurityException("Release does not match installed certificate");
        persist(prefs(c).edit().putLong("highest_version",r.version));
        File candidate=new File(directory(c),"candidate.apk");
        boolean ready=false;
        if(candidate.isFile())try{verifyApk(c,candidate,r);ready=true;}catch(Exception ignored){}
        if(!ready) {
            state(c,"downloading");File partial=new File(directory(c),"candidate.part");
            conn=open(UpdatePolicy.apkUrl(origin,r.path));
            try {
                if(conn.getResponseCode()!=200)throw new IOException("APK unavailable");
                long reported=conn.getContentLengthLong();if(reported>0&&reported!=r.size)throw new SecurityException("APK length header mismatch");
                try(InputStream in=conn.getInputStream();FileOutputStream out=new FileOutputStream(partial)) {
                    UpdatePolicy.verifyApkBytes(in,out,r.size,r.hash);
                    out.getFD().sync();
                }
                verifyApk(c,partial,r);
                Files.move(partial.toPath(),candidate.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
            } finally {conn.disconnect();Files.deleteIfExists(partial.toPath());}
        }
        persist(prefs(c).edit().putString("manifest",json).putLong("checked_at",System.currentTimeMillis()));state(c,"ready");
        notifyReady(c);
        if(automatic(c)&&Build.VERSION.SDK_INT>=31&&c.getPackageManager().canRequestPackageInstalls())install(c,false);
    }
    private static Set<String> certificates(PackageInfo info) throws Exception {
        if(info==null)throw new SecurityException("Package not found");
        android.content.pm.Signature[] signatures=Build.VERSION.SDK_INT>=28?(info.signingInfo==null?null:info.signingInfo.getApkContentsSigners()):info.signatures;
        if(signatures==null||signatures.length!=1)throw new SecurityException("Unexpected signer set");
        Set<String> values=new HashSet<>();for(android.content.pm.Signature s:signatures)values.add(UpdatePolicy.digest(s.toByteArray()));return values;
    }
    private static int signingFlags() {return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
    private static Set<String> installedCertificates(Context c) throws Exception {return certificates(c.getPackageManager().getPackageInfo(c.getPackageName(),signingFlags()));}
    private static void verifyApk(Context c,File apk,Release r) throws Exception {
        if(!apk.isFile()||apk.length()!=r.size)throw new SecurityException("APK file mismatch");
        try(InputStream in=new FileInputStream(apk)){UpdatePolicy.verifyApkBytes(in,null,r.size,r.hash);}
        PackageInfo info=c.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(),signingFlags());
        if(info==null||!c.getPackageName().equals(info.packageName)||(Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode)!=r.version
            ||info.applicationInfo==null||info.applicationInfo.minSdkVersion>Build.VERSION.SDK_INT
            ||!certificates(info).equals(installedCertificates(c))||!certificates(info).equals(Collections.singleton(r.certificate)))throw new SecurityException("APK identity mismatch");
    }
    static synchronized void install(Context c,boolean foreground) throws Exception {
        if(!c.getPackageManager().canRequestPackageInstalls()){state(c,"permission");return;}
        PackageInstaller installer=c.getPackageManager().getPackageInstaller();int existing=prefs(c).getInt("install_session",-1);
        if(existing>=0&&installer.getSessionInfo(existing)!=null){
            if(!foreground||!state(c).equals("confirmation"))return;
            if(UpdateActivity.confirmation!=null)return;
            // After process death the platform action is gone; safely recreate only a waiting session.
            installer.abandonSession(existing);prefs(c).edit().remove("install_session").apply();
        }
        Release r=new Release(c,prefs(c).getString("manifest",""));UpdatePolicy.version(r.version,installedVersion(c),prefs(c).getLong("highest_version",0));
        File apk=new File(directory(c),"candidate.apk");verifyApk(c,apk,r);
        PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());params.setSize(r.size);
        if(Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id=installer.createSession(params);
        try(PackageInstaller.Session session=installer.openSession(id)) {
            try(InputStream in=new FileInputStream(apk);OutputStream out=session.openWrite("base.apk",0,r.size)) {
                byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)out.write(b,0,n);session.fsync(out);
            }
            Intent callback=new Intent(c,UpdateInstallReceiver.class).setAction(c.getPackageName()+".UPDATE_RESULT").putExtra("expected_session",id).putExtra("foreground",foreground);
            int flags=PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0);
            PendingIntent result=PendingIntent.getBroadcast(c,id,callback,flags);
            persist(prefs(c).edit().putInt("install_session",id));state(c,"installing");session.commit(result.getIntentSender());
        } catch(Exception e){installer.abandonSession(id);prefs(c).edit().remove("install_session").apply();throw e;}
    }
    static void notifyReady(Context c) {
        NotificationManager manager=c.getSystemService(NotificationManager.class);if(manager==null)return;
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,"Uygulama güncellemeleri",NotificationManager.IMPORTANCE_DEFAULT));
        if(Build.VERSION.SDK_INT>=33&&c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
        PendingIntent open=PendingIntent.getActivity(c,402,new Intent(c,UpdateActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        manager.notify(402,new NotificationCompat.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("VIP GECE güncellemesi").setContentText("Doğrulanan sürüm kuruluma hazır.").setContentIntent(open).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build());
    }
}
