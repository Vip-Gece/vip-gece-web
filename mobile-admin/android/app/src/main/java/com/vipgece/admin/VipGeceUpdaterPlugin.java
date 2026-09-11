package com.vipgece.admin;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(name = "VipGeceUpdater")
public class VipGeceUpdaterPlugin extends Plugin {
    @PluginMethod
    public void runUpdate(PluginCall call) {
        String manifestUrl = call.getString("manifestUrl", VipGeceUpdateEngine.DEFAULT_MANIFEST_URL);
        VipGeceUpdateEngine.checkAndInstall(getContext(), manifestUrl, true, new VipGeceUpdateEngine.Listener() {
            @Override
            public void onResult(JSObject result) {
                call.resolve(result);
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(VipGeceUpdateEngine.readStatus(getContext()));
    }

    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls()) {
            call.resolve(new JSObject().put("allowed", true));
            return;
        }

        Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve(new JSObject().put("allowed", false).put("settings_opened", true));
    }

    @PluginMethod
    public void getFirebaseToken(PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    call.reject("Firebase yapilandirmasi veya tokeni hazir degil.");
                    return;
                }
                call.resolve(new JSObject().put("token", task.getResult()));
            });
        } catch (Exception error) {
            call.reject("Firebase bu APK icin henuz yapilandirilmadi.", error);
        }
    }
}
