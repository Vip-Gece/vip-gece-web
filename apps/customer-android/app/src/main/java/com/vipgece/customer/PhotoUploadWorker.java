package com.vipgece.customer;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.*;
import java.io.File;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

public final class PhotoUploadWorker extends Worker {
    private static final String PREFIX="customer-photo-";
    private static final Object UPLOAD_LOCK=new Object();
    public PhotoUploadWorker(@NonNull Context context,@NonNull WorkerParameters parameters){super(context,parameters);}
    static PendingPhotoStore store(Context context) throws IOException {
        return new PendingPhotoStore(new File(context.getNoBackupFilesDir(),"pending-photos-v1"));
    }
    static String workName(String id){return PREFIX+id;}
    static void enqueue(Context context,PendingPhotoStore.Entry entry){
        if(entry.terminal())return;
        Constraints constraints=new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresStorageNotLow(true).build();
        OneTimeWorkRequest request=new OneTimeWorkRequest.Builder(PhotoUploadWorker.class)
            .setConstraints(constraints).setInputData(new Data.Builder().putString("upload_id",entry.id).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).addTag(PREFIX+entry.accountId).build();
        WorkManager.getInstance(context).enqueueUniqueWork(workName(entry.id),ExistingWorkPolicy.KEEP,request);
    }
    static void resume(Context context,String account,boolean authenticatedAgain) throws IOException {
        PendingPhotoStore store=store(context);
        for(PendingPhotoStore.Entry entry:store.list(account)){
            if(authenticatedAgain&&entry.state==PendingPhotoStore.State.AUTH_REQUIRED)entry=store.state(entry.id,account,PendingPhotoStore.State.PENDING,"");
            if(!entry.terminal()&&entry.state!=PendingPhotoStore.State.FAILED&&entry.state!=PendingPhotoStore.State.AUTH_REQUIRED)enqueue(context,entry);
        }
    }
    static void retry(Context context,String id,String account) throws IOException {
        PendingPhotoStore.Entry entry=store(context).state(id,account,PendingPhotoStore.State.PENDING,"");
        enqueue(context,entry);
    }
    static void cancel(Context context,String id,String account) throws IOException {
        store(context).state(id,account,PendingPhotoStore.State.CANCELLED,"");
        WorkManager.getInstance(context).cancelUniqueWork(workName(id));
    }
    @NonNull @Override public Result doWork(){
        synchronized(UPLOAD_LOCK){return upload();}
    }
    private Result upload(){
        String id=getInputData().getString("upload_id");
        try {
            SessionVault vault=new SessionVault(getApplicationContext());
            SessionVault.Session session=vault.read();
            PhotoUploadProcessor.Outcome outcome=PhotoUploadProcessor.run(store(getApplicationContext()),id,session.accountId,
                getRunAttemptCount(),this::isStopped,(entry,bytes)->{
                    SessionVault.Session current=vault.read();
                    if(current.token.isEmpty()||!current.accountId.equals(entry.accountId)||isStopped())throw new ApiClient.Failure(401,"SESSION_REQUIRED");
                    new ApiClient(BuildConfig.GATEWAY_URL).image(entry.profileId,current.token,bytes,entry.mime,entry.id);
                });
            if(outcome==PhotoUploadProcessor.Outcome.COMPLETE)return Result.success();
            return outcome==PhotoUploadProcessor.Outcome.RETRY?Result.retry():Result.failure();
        }catch(IOException unavailable){return getRunAttemptCount()<7?Result.retry():Result.failure();}
        catch(RuntimeException invalid){return Result.failure();}
    }
}
