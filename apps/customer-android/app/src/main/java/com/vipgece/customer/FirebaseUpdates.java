package com.vipgece.customer;

import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.remoteconfig.FirebaseRemoteConfig;
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings;
import java.util.Collections;

final class FirebaseUpdates {
    static final String TOPIC="vip_gece_customer_updates_v1";
    private FirebaseUpdates() {}
    static void start(Context context) {
        Context c=context.getApplicationContext();
        try {
            if(FirebaseApp.getApps(c).isEmpty()&&FirebaseApp.initializeApp(c)==null)return;
            if(!UpdateEngine.automatic(c))return;
            FirebaseMessaging messaging=FirebaseMessaging.getInstance();messaging.setAutoInitEnabled(true);
            messaging.subscribeToTopic(TOPIC).addOnCompleteListener(task->UpdateEngine.prefs(c).edit().putString("firebase_state",task.isSuccessful()?"connected":"pending").apply());
            FirebaseRemoteConfig config=FirebaseRemoteConfig.getInstance();
            config.setDefaultsAsync(Collections.singletonMap("customer_latest_version_code",0L));
            config.setConfigSettingsAsync(new FirebaseRemoteConfigSettings.Builder().setMinimumFetchIntervalInSeconds(43200).setFetchTimeoutInSeconds(15).build())
                .continueWithTask(task->config.fetchAndActivate()).addOnCompleteListener(task->{
                    if(task.isSuccessful())hint(c,"customer_update",Long.toString(config.getLong("customer_latest_version_code")));
                });
        } catch(RuntimeException ignored) {
            // Public signed polling stays available without Google Play services or Firebase connectivity.
            UpdateEngine.prefs(c).edit().putString("firebase_state","pending").apply();
        }
    }
    static void configure(Context context,boolean enabled) {
        Context c=context.getApplicationContext();
        if(enabled){start(c);return;}
        if(FirebaseApp.getApps(c).isEmpty())return;
        FirebaseMessaging messaging=FirebaseMessaging.getInstance();messaging.setAutoInitEnabled(false);
        messaging.unsubscribeFromTopic(TOPIC).continueWithTask(task->messaging.deleteToken());
        UpdateEngine.prefs(c).edit().putString("firebase_state","off").apply();
    }
    static synchronized void hint(Context c,String type,String version) {
        try {
            long now=System.currentTimeMillis();
            if(!UpdateSignalPolicy.shouldCheck(type,version,UpdateEngine.installedVersion(c),now,UpdateEngine.prefs(c).getLong("last_update_hint",0),UpdateEngine.automatic(c)))return;
            UpdateEngine.prefs(c).edit().putLong("last_update_hint",now).apply();
            UpdateEngine.enqueue(c,false);
        } catch(Exception ignored) { /* A hint is optional; it must never interrupt customer operations. */ }
    }
}
