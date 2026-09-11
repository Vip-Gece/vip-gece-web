package com.vipgece.customer.background;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.vipgece.customer.config.EndpointResolver;
import com.vipgece.customer.net.CustomerApi;
import com.vipgece.customer.notification.CustomerNotifications;
import com.vipgece.customer.security.SecureSessionStore;
import com.vipgece.customer.update.CustomerUpdateEngine;

public final class ConfigRefreshWorker extends Worker {
    public ConfigRefreshWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        boolean updateFailed = false;
        try {
            EndpointResolver.refreshAndResolve(getApplicationContext(), true);
            CustomerUpdateEngine.Candidate candidate =
                    CustomerUpdateEngine.checkAndDownload(getApplicationContext());
            if (candidate != null) {
                CustomerNotifications.showUpdate(getApplicationContext(), candidate);
            } else {
                CustomerNotifications.clearUpdate(getApplicationContext());
            }
        } catch (Exception error) {
            updateFailed = true;
        }

        try {
            SecureSessionStore store = new SecureSessionStore(getApplicationContext());
            SecureSessionStore.Session session = store.load();
            if (session != null) {
                CustomerNotifications.showDailySummary(
                        getApplicationContext(),
                        CustomerApi.dailyAnalytics(getApplicationContext(), session.token)
                );
            } else {
                CustomerNotifications.clearDailySummary(getApplicationContext());
            }
        } catch (CustomerApi.ApiException error) {
            if (error.status == 401) {
                new SecureSessionStore(getApplicationContext()).clear();
                CustomerNotifications.clearDailySummary(getApplicationContext());
            }
        } catch (Exception ignored) {
            // Analytics is best effort and must not block signed update checks.
        }

        return updateFailed && getRunAttemptCount() < 4 ? Result.retry() : Result.success();
    }
}
