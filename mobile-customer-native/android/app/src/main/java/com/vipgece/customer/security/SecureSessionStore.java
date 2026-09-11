package com.vipgece.customer.security;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.Instant;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class SecureSessionStore {
    private static final String KEY_ALIAS = "vip_gece_customer_session_v1";
    private static final String PREFS = "vip_gece_customer_secure_session";
    private static final String KEY_CIPHER = "session_cipher";
    private static final String KEY_IV = "session_iv";

    private final SharedPreferences preferences;

    public SecureSessionStore(Context context) {
        preferences = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized void save(Session session) throws Exception {
        JSONObject json = new JSONObject()
                .put("token", session.token)
                .put("email", session.email)
                .put("account_label", session.accountLabel)
                .put("expires_at", session.expiresAt);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] encrypted = cipher.doFinal(json.toString().getBytes(StandardCharsets.UTF_8));
        preferences.edit()
                .putString(KEY_CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString(KEY_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .apply();
    }

    public synchronized Session load() {
        try {
            String encodedCipher = preferences.getString(KEY_CIPHER, "");
            String encodedIv = preferences.getString(KEY_IV, "");
            if (encodedCipher.isEmpty() || encodedIv.isEmpty()) return null;

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    getOrCreateKey(),
                    new GCMParameterSpec(128, Base64.decode(encodedIv, Base64.NO_WRAP))
            );
            String raw = new String(
                    cipher.doFinal(Base64.decode(encodedCipher, Base64.NO_WRAP)),
                    StandardCharsets.UTF_8
            );
            JSONObject json = new JSONObject(raw);
            Session session = new Session(
                    json.getString("token"),
                    json.optString("email", ""),
                    json.optString("account_label", ""),
                    json.getString("expires_at")
            );
            if (Instant.parse(session.expiresAt).toEpochMilli() <= System.currentTimeMillis()) {
                clear();
                return null;
            }
            return session;
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    public synchronized void clear() {
        preferences.edit().clear().apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key existing = store.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;

        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                "AndroidKeyStore"
        );
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    public static final class Session {
        public final String token;
        public final String email;
        public final String accountLabel;
        public final String expiresAt;

        public Session(String token, String email, String accountLabel, String expiresAt) {
            this.token = token;
            this.email = email;
            this.accountLabel = accountLabel;
            this.expiresAt = expiresAt;
        }
    }
}
