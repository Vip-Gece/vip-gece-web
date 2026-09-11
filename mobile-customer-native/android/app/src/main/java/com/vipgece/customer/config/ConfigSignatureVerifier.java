package com.vipgece.customer.config;

import android.content.Context;
import android.util.Base64;

import com.vipgece.customer.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class ConfigSignatureVerifier {
    private static final long CLOCK_SKEW_MS = 10 * 60 * 1000L;

    private ConfigSignatureVerifier() {}

    public static VerifiedConfig verify(Context context, JSONObject config) throws Exception {
        if (config.optInt("config_version", 0) != 1) {
            throw new SecurityException("Yapılandırma sürümü desteklenmiyor.");
        }
        String signature = config.optString("signature", "");
        if (signature.isEmpty()) throw new SecurityException("Yapılandırma imzası eksik.");

        java.security.Signature verifier = java.security.Signature.getInstance("SHA256withRSA");
        verifier.initVerify(loadPublicKey(context));
        verifier.update(canonical(config).getBytes(StandardCharsets.UTF_8));
        if (!verifier.verify(Base64.decode(signature, Base64.DEFAULT))) {
            throw new SecurityException("Yapılandırma imzası geçersiz.");
        }

        long issuedAt = parseTime(config.getString("issued_at"));
        long expiresAt = parseTime(config.getString("expires_at"));
        long now = System.currentTimeMillis();
        if (issuedAt > now + CLOCK_SKEW_MS || expiresAt <= now) {
            throw new SecurityException("Yapılandırma zaman aralığı geçersiz.");
        }

        List<String> origins = validatedHttpsUrls(config.getJSONArray("api_origins"), true);
        List<String> mirrors = validatedHttpsUrls(config.getJSONArray("config_mirrors"), false);
        String canonicalOrigin = normalizeOrigin(config.getString("canonical_origin"));
        if (!origins.contains(canonicalOrigin)) {
            throw new SecurityException("Canonical origin izinli origin listesinde değil.");
        }

        return new VerifiedConfig(
                config.optString("revision", ""),
                issuedAt,
                expiresAt,
                canonicalOrigin,
                origins,
                mirrors,
                trustedApiPath(config.optString("ready_path", "/api/ready"), "/api/ready"),
                trustedApiPath(
                        config.optString("login_path", "/api/customer/mobile/login"),
                        "/api/customer/mobile/login"
                ),
                trustedApiPath(
                        config.optString("update_manifest_path", "/api/mobile/customer/update"),
                        "/api/mobile/customer/update"
                ),
                config.optBoolean("support_enabled", false),
                config.toString()
        );
    }

    private static String canonical(JSONObject config) throws Exception {
        return String.join("\n",
                String.valueOf(config.getInt("config_version")),
                config.getString("revision"),
                config.getString("issued_at"),
                config.getString("expires_at"),
                normalizeOrigin(config.getString("canonical_origin")),
                joinNormalized(config.getJSONArray("api_origins"), true),
                joinNormalized(config.getJSONArray("config_mirrors"), false),
                config.getString("ready_path"),
                config.getString("login_path"),
                config.getString("update_manifest_path"),
                String.valueOf(config.optBoolean("support_enabled", false))
        );
    }

    private static String joinNormalized(JSONArray array, boolean origins) throws Exception {
        List<String> values = validatedHttpsUrls(array, origins);
        return String.join(",", values);
    }

    private static List<String> validatedHttpsUrls(JSONArray array, boolean origins) throws Exception {
        Set<String> values = new LinkedHashSet<>();
        for (int index = 0; index < array.length(); index++) {
            String raw = array.getString(index);
            values.add(origins ? normalizeOrigin(raw) : normalizeMirror(raw));
        }
        if (values.isEmpty()) throw new SecurityException("Güvenilir origin listesi boş.");
        return new ArrayList<>(values);
    }

    public static String normalizeOrigin(String raw) throws Exception {
        URL url = trustedHttpsUrl(raw);
        if (!"/".equals(url.getPath()) && !url.getPath().isEmpty()) {
            throw new SecurityException("Origin adresi path içeremez.");
        }
        return "https://" + url.getHost().toLowerCase(Locale.ROOT);
    }

    private static String normalizeMirror(String raw) throws Exception {
        URL url = trustedHttpsUrl(raw);
        if (url.getQuery() != null || url.getRef() != null) {
            throw new SecurityException("Yapılandırma aynası query veya fragment içeremez.");
        }
        return url.toString();
    }

    private static URL trustedHttpsUrl(String raw) throws Exception {
        URL url = new URL(String.valueOf(raw));
        String host = url.getHost().toLowerCase(Locale.ROOT);
        if (
                !"https".equalsIgnoreCase(url.getProtocol()) ||
                host.isEmpty() ||
                url.getUserInfo() != null ||
                (url.getPort() != -1 && url.getPort() != 443) ||
                host.equals("localhost") ||
                host.matches("^\\d{1,3}(?:\\.\\d{1,3}){3}$") ||
                !host.matches("^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$")
        ) {
            throw new SecurityException("Güvenilir olmayan HTTPS adresi.");
        }
        return url;
    }

    private static String trustedApiPath(String raw, String expected) {
        String value = String.valueOf(raw);
        if (
                !expected.equals(value) ||
                value.contains("\\") ||
                value.contains("//") ||
                value.contains("?") ||
                value.contains("#")
        ) {
            throw new SecurityException("Yapılandırma API yolu izinli değil.");
        }
        return value;
    }

    private static long parseTime(String value) throws Exception {
        return java.time.Instant.parse(value).toEpochMilli();
    }

    private static PublicKey loadPublicKey(Context context) throws Exception {
        String pem;
        try (InputStream input = context.getResources().openRawResource(
                R.raw.vip_gece_customer_config_public_key
        )) {
            pem = new String(readAll(input, 16 * 1024), StandardCharsets.US_ASCII);
        }
        String body = pem
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s", "");
        return KeyFactory.getInstance("RSA").generatePublic(
                new X509EncodedKeySpec(Base64.decode(body, Base64.DEFAULT))
        );
    }

    private static byte[] readAll(InputStream input, int maxBytes) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) >= 0) {
            total += read;
            if (total > maxBytes) throw new SecurityException("Anahtar dosyası çok büyük.");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    public static final class VerifiedConfig {
        public final String revision;
        public final long issuedAt;
        public final long expiresAt;
        public final String canonicalOrigin;
        public final List<String> origins;
        public final List<String> mirrors;
        public final String readyPath;
        public final String loginPath;
        public final String updateManifestPath;
        public final boolean supportEnabled;
        public final String serialized;

        VerifiedConfig(
                String revision,
                long issuedAt,
                long expiresAt,
                String canonicalOrigin,
                List<String> origins,
                List<String> mirrors,
                String readyPath,
                String loginPath,
                String updateManifestPath,
                boolean supportEnabled,
                String serialized
        ) {
            this.revision = revision;
            this.issuedAt = issuedAt;
            this.expiresAt = expiresAt;
            this.canonicalOrigin = canonicalOrigin;
            this.origins = origins;
            this.mirrors = mirrors;
            this.readyPath = readyPath;
            this.loginPath = loginPath;
            this.updateManifestPath = updateManifestPath;
            this.supportEnabled = supportEnabled;
            this.serialized = serialized;
        }
    }
}
