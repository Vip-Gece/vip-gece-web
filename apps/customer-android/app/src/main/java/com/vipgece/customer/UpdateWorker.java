package com.vipgece.customer;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class UpdateWorker extends Worker {
    public UpdateWorker(@NonNull Context context,@NonNull WorkerParameters params){super(context,params);}
    @NonNull @Override public Result doWork() {
        try {UpdateEngine.check(getApplicationContext(),getInputData().getBoolean("manual",false));return Result.success();}
        catch(SecurityException e){UpdateEngine.state(getApplicationContext(),"rejected");return Result.failure();}
        catch(Exception e){UpdateEngine.state(getApplicationContext(),"error");return getRunAttemptCount()<3?Result.retry():Result.failure();}
    }
}
