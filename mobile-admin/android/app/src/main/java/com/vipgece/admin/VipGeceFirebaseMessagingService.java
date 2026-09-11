package com.vipgece.admin;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class VipGeceFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        String action = message.getData().get("action");
        if (!"admin_app_update".equals(action)) return;

        String manifestUrl = message.getData().get("manifest_url");
        if (manifestUrl == null || manifestUrl.trim().isEmpty()) {
            manifestUrl = VipGeceUpdateEngine.DEFAULT_MANIFEST_URL;
        }
        VipGeceUpdateEngine.enqueueBackgroundCheck(getApplicationContext(), manifestUrl);
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        getSharedPreferences(VipGeceUpdateEngine.PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString("firebase_token", token)
                .apply();
    }
}
