package com.vipgece.customer;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class CustomerMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(@NonNull RemoteMessage message) {
        // Only a bounded version hint is consumed. All URLs, code and commands in messages are ignored.
        FirebaseUpdates.hint(this,message.getData().get("type"),message.getData().get("version_code"));
    }
    @Override public void onNewToken(@NonNull String token) {
        if(UpdateEngine.automatic(this))FirebaseUpdates.start(this);
    }
}
