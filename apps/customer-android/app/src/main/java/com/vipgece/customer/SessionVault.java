package com.vipgece.customer;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SessionVault {
    private static final String ALIAS = "vip_customer_session_v1";
    private static final Object LOCK = new Object();
    static final class Session {
        final String token,accountId;
        Session(String token,String accountId){this.token=token;this.accountId=accountId;}
    }
    private final android.content.SharedPreferences prefs;
    SessionVault(Context context) { prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    void save(String token,String accountId) throws Exception {
        synchronized(LOCK){
        if(!PendingPhotoStore.validScope(accountId)||!token.matches("[A-Za-z0-9._-]{1,4096}"))throw new IllegalArgumentException("Invalid session");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
        String payload=new org.json.JSONObject().put("schema",1).put("token",token).put("account",accountId).toString();
        String data = Base64.encodeToString(cipher.doFinal(payload.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!prefs.edit().putString("iv", iv).putString("data", data).commit()) throw new IllegalStateException("Session storage failed");
        }
    }
    String load() {return read().token;}
    Session read() {
        synchronized(LOCK){
        try {
            if (!prefs.contains("data")) return new Session("","");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)));
            String value=new String(cipher.doFinal(Base64.decode(prefs.getString("data", ""), Base64.NO_WRAP)), StandardCharsets.UTF_8);
            // Existing installations bind legacy encrypted sessions after an authenticated bootstrap.
            if(!value.startsWith("{"))return new Session(value,"");
            org.json.JSONObject saved=new org.json.JSONObject(value);
            String token=saved.getString("token"),account=saved.getString("account");
            if(saved.getInt("schema")!=1||!PendingPhotoStore.validScope(account)||!token.matches("[A-Za-z0-9._-]{1,4096}"))throw new IllegalStateException("Invalid session");
            return new Session(token,account);
        } catch (Exception error) { clear(); return new Session("",""); }
        }
    }
    @android.annotation.SuppressLint("ApplySharedPref") // Logout must not defer the durable removal.
    void clear() { synchronized(LOCK){if (!prefs.edit().clear().commit()) throw new IllegalStateException("Session removal failed");} }
}
