package com.vipgece.customer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

public final class UpdateInstallReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent) {
        if(intent==null||!(context.getPackageName()+".UPDATE_RESULT").equals(intent.getAction()))return;
        int expected=UpdateEngine.prefs(context).getInt("install_session",-1);
        if(expected<0||intent.getIntExtra("expected_session",-2)!=expected||intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-3)!=expected)return;
        int status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
        if(status==PackageInstaller.STATUS_PENDING_USER_ACTION) {
            UpdateEngine.state(context,"confirmation");
            Intent confirm=intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if(confirm!=null) {
                // The platform's pending installer action stays private; never accept a URL from a push message.
                UpdateActivity.confirmation=confirm;
                UpdateActivity activity=UpdateActivity.visible.get();if(activity!=null)activity.openConfirmation();
            }
            UpdateEngine.notifyReady(context);return;
        }
        UpdateEngine.prefs(context).edit().remove("install_session").apply();
        UpdateActivity.confirmation=null;
        UpdateEngine.state(context,status==PackageInstaller.STATUS_SUCCESS?"current":status==PackageInstaller.STATUS_FAILURE_ABORTED?"ready":"install_error");
        if(status==PackageInstaller.STATUS_SUCCESS)UpdateEngine.prefs(context).edit().remove("manifest").apply();
    }
}
