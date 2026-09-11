package com.vipgece.customer.update;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class UpdateInstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        CustomerUpdateEngine.handleInstallResult(context, intent);
    }
}
