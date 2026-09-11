package com.vipgece.admin;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.getcapacitor.JSObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class VipGeceUpdateWorker extends Worker {
    public static final String INPUT_MANIFEST_URL = "manifest_url";

    public VipGeceUpdateWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String manifestUrl = getInputData().getString(INPUT_MANIFEST_URL);
        if (manifestUrl == null || manifestUrl.trim().isEmpty()) {
            manifestUrl = VipGeceUpdateEngine.DEFAULT_MANIFEST_URL;
        }

        CountDownLatch completed = new CountDownLatch(1);
        AtomicBoolean succeeded = new AtomicBoolean(false);
        VipGeceUpdateEngine.checkAndInstall(getApplicationContext(), manifestUrl, false, new VipGeceUpdateEngine.Listener() {
            @Override
            public void onResult(JSObject result) {
                succeeded.set(true);
                completed.countDown();
            }

            @Override
            public void onError(String message) {
                completed.countDown();
            }
        });

        try {
            if (!completed.await(15, TimeUnit.MINUTES)) {
                return getRunAttemptCount() < 3 ? Result.retry() : Result.failure();
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return Result.retry();
        }

        if (succeeded.get()) return Result.success();
        return getRunAttemptCount() < 3 ? Result.retry() : Result.failure();
    }
}
