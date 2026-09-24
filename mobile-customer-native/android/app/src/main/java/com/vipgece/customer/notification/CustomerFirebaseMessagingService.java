package com.vipgece.customer.notification;

import android.content.Context;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.vipgece.customer.net.CustomerApi;

import java.util.Map;

/**
 * FCM (uzaktan push) alicisi: sunucudan gelen guncelleme duyurularini
 * yerel bildirime cevirir; yeni cihaz token'ini sunucuya kaydeder.
 */
public final class CustomerFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        Context context = getApplicationContext();
        CustomerApi.registerDeviceTokenAsync(context, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Context context = getApplicationContext();
        Map<String, String> data = message.getData();
        String title = valueOrEmpty(data.get("title"));
        String body = valueOrEmpty(data.get("body"));
        String version = valueOrEmpty(data.get("version"));
        RemoteMessage.Notification info = message.getNotification();
        if (title.isEmpty() && info != null && info.getTitle() != null) {
            title = info.getTitle();
        }
        if (body.isEmpty() && info != null && info.getBody() != null) {
            body = info.getBody();
        }
        CustomerNotifications.showPushUpdate(context, title, body, version);
    }

    private static String valueOrEmpty(String value) {
        return value == null ? "" : value.trim();
    }
}
