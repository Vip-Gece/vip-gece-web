package com.vipgece.customer.config;

import android.content.Context;
import android.content.SharedPreferences;

import com.vipgece.customer.net.HttpJson;

import org.json.JSONObject;

import java.net.URL;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class EndpointResolver {
    private static final String PREFS = "vip_gece_endpoint_state";
    private static final String KEY_CONFIG = "signed_config";
    private static final String KEY_ACTIVE_ORIGIN = "active_origin";
    private static final String KEY_SUPPORT_ENABLED = "support_enabled";
    private static final String[] BUILT_IN_ORIGINS = {
            "https://vip-gece.site"
    };
    private static final String CONFIG_PATH = "/api/mobile/customer/config";

    private EndpointResolver() {}

    public static Resolution refreshAndResolve(Context source, boolean forceRefresh) throws Exception {
        return refreshAndResolve(source, forceRefresh, "");
    }

    public static Resolution refreshAndResolve(
            Context source,
            boolean forceRefresh,
            String excludedOrigin
    ) throws Exception {
        Context context = source.getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        ConfigSignatureVerifier.VerifiedConfig config = readCachedConfig(context, prefs);

        if (forceRefresh || config == null || config.expiresAt - System.currentTimeMillis() < 24 * 60 * 60 * 1000L) {
            ConfigSignatureVerifier.VerifiedConfig refreshed = fetchSignedConfig(context, config);
            if (refreshed != null) {
                config = refreshed;
                prefs.edit().putString(KEY_CONFIG, config.serialized).apply();
            }
        }

        Set<String> candidates = new LinkedHashSet<>();
        String previous = prefs.getString(KEY_ACTIVE_ORIGIN, "");
        if (!previous.isEmpty()) candidates.add(previous);
        if (config != null) {
            candidates.add(config.canonicalOrigin);
            candidates.addAll(config.origins);
        }
        for (String origin : BUILT_IN_ORIGINS) candidates.add(origin);

        String readyPath = config == null ? "/api/ready" : config.readyPath;
        for (String origin : candidates) {
            try {
                String normalized = ConfigSignatureVerifier.normalizeOrigin(origin);
                if (!excludedOrigin.isEmpty() && normalized.equals(
                        ConfigSignatureVerifier.normalizeOrigin(excludedOrigin)
                )) {
                    continue;
                }
                if (isExactlyReady(new URL(normalized + readyPath))) {
                    boolean supportEnabled = config != null && config.supportEnabled;
                    prefs.edit()
                            .putString(KEY_ACTIVE_ORIGIN, normalized)
                            .putBoolean(KEY_SUPPORT_ENABLED, supportEnabled)
                            .apply();
                    return new Resolution(
                            normalized,
                            config == null ? "builtin" : config.revision,
                            config == null ? "/api/customer/mobile/login" : config.loginPath,
                            config == null ? "/api/mobile/customer/update" : config.updateManifestPath,
                            supportEnabled
                    );
                }
            } catch (Exception ignored) {
                // The next signed or built-in candidate is tried.
            }
        }
        throw new IllegalStateException("Hazır VIP Gece API origin'i bulunamadı.");
    }

    public static String activeOrigin(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_ACTIVE_ORIGIN, "");
    }

    public static boolean supportEnabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_SUPPORT_ENABLED, false);
    }

    private static ConfigSignatureVerifier.VerifiedConfig readCachedConfig(
            Context context,
            SharedPreferences prefs
    ) {
        String raw = prefs.getString(KEY_CONFIG, "");
        if (raw.isEmpty()) return null;
        try {
            return ConfigSignatureVerifier.verify(context, new JSONObject(raw));
        } catch (Exception ignored) {
            prefs.edit().remove(KEY_CONFIG).apply();
            return null;
        }
    }

    private static ConfigSignatureVerifier.VerifiedConfig fetchSignedConfig(
            Context context,
            ConfigSignatureVerifier.VerifiedConfig cached
    ) {
        List<String> mirrors = new ArrayList<>();
        if (cached != null) mirrors.addAll(cached.mirrors);
        for (String origin : BUILT_IN_ORIGINS) mirrors.add(origin + CONFIG_PATH);

        for (String mirror : new LinkedHashSet<>(mirrors)) {
            try {
                HttpJson.Response response = HttpJson.request(new URL(mirror), "GET", "", null);
                if (!response.successful()) continue;
                return ConfigSignatureVerifier.verify(context, response.json);
            } catch (Exception ignored) {
                // Signed mirrors intentionally fail closed and fall through.
            }
        }
        return null;
    }

    private static boolean isExactlyReady(URL url) throws Exception {
        HttpJson.Response response = HttpJson.request(url, "GET", "", null);
        JSONObject json = response.json;
        return response.status == 200 &&
                json.length() == 1 &&
                "ready".equals(json.optString("status", ""));
    }

    public static final class Resolution {
        public final String origin;
        public final String revision;
        public final String loginPath;
        public final String updateManifestPath;
        public final boolean supportEnabled;

        public Resolution(
                String origin,
                String revision,
                String loginPath,
                String updateManifestPath,
                boolean supportEnabled
        ) {
            this.origin = origin;
            this.revision = revision;
            this.loginPath = loginPath;
            this.updateManifestPath = updateManifestPath;
            this.supportEnabled = supportEnabled;
        }
    }
}
