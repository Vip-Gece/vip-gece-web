package com.vipgece.customer.background;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

public final class CustomerBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (
                !Intent.ACTION_BOOT_COMPLETED.equals(action) &&
                !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        ) {
            return;
        }
        schedule(context);
    }

    public static void schedule(Context source) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                ConfigRefreshWorker.class,
                1,
                TimeUnit.HOURS,
                15,
                TimeUnit.MINUTES
        ).setConstraints(constraints).build();

        WorkManager workManager = WorkManager.getInstance(source.getApplicationContext());
        workManager.enqueueUniquePeriodicWork(
                "vip-gece-customer-config-refresh",
                ExistingPeriodicWorkPolicy.UPDATE,
                request
        );
        workManager.enqueueUniqueWork(
                "vip-gece-customer-maintenance-now",
                ExistingWorkPolicy.KEEP,
                new OneTimeWorkRequest.Builder(ConfigRefreshWorker.class)
                        .setConstraints(constraints)
                        .build()
        );
    }
}
