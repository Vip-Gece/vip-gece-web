package com.vipgece.admin;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

public class VipGeceUpdateReceiver extends BroadcastReceiver {
    public static final String ACTION_INSTALL_STATUS = "com.vipgece.admin.UPDATE_INSTALL_STATUS";
    public static final String ACTION_PERIODIC_CHECK = "com.vipgece.admin.UPDATE_PERIODIC_CHECK";
    public static final String ACTION_HEALTH_TIMEOUT = "com.vipgece.admin.UPDATE_HEALTH_TIMEOUT";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            VipGeceUpdateEngine.schedulePeriodicCheck(context);
            return;
        }

        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            VipGeceUpdateEngine.schedulePeriodicCheck(context);
            VipGeceUpdateEngine.scheduleHealthTimeout(context, 90_000L);
            launchApp(context);
            return;
        }

        if (ACTION_PERIODIC_CHECK.equals(action)) {
            VipGeceUpdateEngine.enqueueBackgroundCheck(context, VipGeceUpdateEngine.DEFAULT_MANIFEST_URL);
            return;
        }

        if (ACTION_HEALTH_TIMEOUT.equals(action)) {
            VipGeceUpdateEngine.handleHealthTimeout(context);
            return;
        }

        if (!ACTION_INSTALL_STATUS.equals(action)) return;

        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String role = intent.getStringExtra("update_role");
        if (role == null) role = "candidate";

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            boolean foreground = intent.getBooleanExtra("update_foreground", false);
            if (foreground && confirmation != null) {
                confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirmation);
            }
            String state = foreground ? "user_confirmation_required" : "user_confirmation_required_background";
            VipGeceUpdateEngine.writeStatus(context, state, "Android kurulum onayi bekleniyor.");
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            if ("rollback".equals(role)) {
                VipGeceUpdateEngine.writeStatus(context, "rolled_back", "Onceki saglam surum geri yuklendi.");
            } else {
                VipGeceUpdateEngine.writeStatus(context, "installed_pending_health", "Yeni surum kuruldu; saglik testi bekleniyor.");
                VipGeceUpdateEngine.scheduleHealthTimeout(context, 90_000L);
            }
            launchApp(context);
            return;
        }

        String detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (detail == null || detail.trim().isEmpty()) detail = "Paket kurulumu basarisiz.";
        String state = "rollback".equals(role) ? "rollback_failed" : "install_failed_old_version_retained";
        VipGeceUpdateEngine.writeStatus(context, state, detail);
    }

    private void launchApp(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) return;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            context.startActivity(launch);
        } catch (Exception ignored) {
            // Background start limits may defer the visible launch; the health alarm remains active.
        }
    }
}
