package com.vipgece.customer.net;

import android.content.Context;

import com.vipgece.customer.config.EndpointResolver;
import com.vipgece.customer.security.SecureSessionStore;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

public final class CustomerApi {
    private static final int MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024;

    private CustomerApi() {}

    public static LoginResult login(Context context, String email, String password) throws Exception {
        EndpointResolver.Resolution resolution = EndpointResolver.refreshAndResolve(context, true);
        JSONObject body = new JSONObject()
                .put("email", email)
                .put("password", password);
        HttpJson.Response response;
        try {
            response = HttpJson.request(
                    new URL(resolution.origin + resolution.loginPath),
                    "POST",
                    "",
                    body
            );
            if (response.status >= 500) {
                resolution = EndpointResolver.refreshAndResolve(context, true, resolution.origin);
                response = HttpJson.request(
                        new URL(resolution.origin + resolution.loginPath),
                        "POST",
                        "",
                        body
                );
            }
        } catch (Exception firstError) {
            resolution = EndpointResolver.refreshAndResolve(context, true, resolution.origin);
            response = HttpJson.request(
                    new URL(resolution.origin + resolution.loginPath),
                    "POST",
                    "",
                    body
            );
        }
        requireSuccess(response);

        JSONObject session = response.json.getJSONObject("session");
        JSONObject account = response.json.getJSONObject("account");
        return new LoginResult(
                new SecureSessionStore.Session(
                        session.getString("token"),
                        account.optString("email", email),
                        account.optString("label", ""),
                        session.getString("expires_at")
                ),
                resolution,
                account.optBoolean("must_change_password", false)
        );
    }

    public static JSONObject changePassword(
            Context context,
            String token,
            String currentPassword,
            String newPassword
    ) throws Exception {
        JSONObject body = new JSONObject()
                .put("current_password", currentPassword)
                .put("new_password", newPassword);
        return authorizedRequest(context, token, "/api/customer/mobile/password", "POST", body);
    }

    public static JSONObject registerDeviceToken(Context context, String token) throws Exception {
        JSONObject body = new JSONObject()
                .put("token", token)
                .put("platform", "android");
        EndpointResolver.Resolution resolution = EndpointResolver.refreshAndResolve(context, false);
        HttpJson.Response response = HttpJson.request(
                new URL(resolution.origin + "/api/customer/mobile/device-token"),
                "POST",
                "",
                body
        );
        requireSuccess(response);
        return response.json;
    }

    public static void registerDeviceTokenAsync(Context context, String token) {
        if (token == null || token.trim().isEmpty()) return;
        final Context appContext = context.getApplicationContext();
        final String value = token.trim();
        Thread worker = new Thread(() -> {
            try {
                registerDeviceToken(appContext, value);
            } catch (Exception ignored) {
                // Sessiz: token yenilendiginde veya sonraki acilista tekrar denenir.
            }
        }, "vip-gece-device-token");
        worker.setDaemon(true);
        worker.start();
    }

    public static JSONObject bootstrap(Context context, String token) throws Exception {
        return authorizedRequest(context, token, "/api/customer/mobile/bootstrap", "GET", null);
    }

    public static JSONObject dailyAnalytics(Context context, String token) throws Exception {
        return authorizedRequest(
                context,
                token,
                "/api/customer/mobile/analytics/daily",
                "GET",
                null
        );
    }

    public static JSONObject profileAnalytics(
            Context context,
            String token,
            String profileId
    ) throws Exception {
        final int days = 7;
        JSONObject response = authorizedRequest(
                context,
                token,
                "/api/customer/mobile/profiles/" +
                        encodePath(profileId) +
                        "/analytics?days=" +
                        days,
                "GET",
                null
        );
        JSONObject profile = response.optJSONObject("profile");
        JSONObject period = response.optJSONObject("period");
        if (
                profile == null ||
                period == null ||
                !profileId.equals(profile.optString("id", "")) ||
                days != period.optInt("days", -1) ||
                !"site_interaction".equals(response.optString("metric_scope", ""))
        ) {
            throw new SecurityException("Profil analiz yanıtı doğrulanamadı.");
        }
        return response;
    }

    public static JSONObject createProfile(
            Context context,
            String token,
            JSONObject profile
    ) throws Exception {
        return authorizedRequest(
                context,
                token,
                "/api/customer/mobile/profiles",
                "POST",
                profile
        );
    }

    public static JSONObject updateProfile(
            Context context,
            String token,
            String profileId,
            JSONObject profile
    ) throws Exception {
        return authorizedRequest(
                context,
                token,
                "/api/customer/mobile/profiles/" + encodePath(profileId),
                "PUT",
                profile
        );
    }

    public static JSONObject uploadProfileImage(
            Context context,
            String token,
            String profileId,
            String contentType,
            byte[] image
    ) throws Exception {
        String origin = EndpointResolver.refreshAndResolve(context, false).origin;
        HttpJson.Response response = HttpJson.requestBinary(
                new URL(
                        origin +
                        "/api/customer/mobile/profiles/" +
                        encodePath(profileId) +
                        "/images"
                ),
                "POST",
                token,
                contentType,
                image
        );
        requireSuccess(response);
        return response.json;
    }

    public static JSONObject removeProfileImage(
            Context context,
            String token,
            String profileId,
            String imageUrl
    ) throws Exception {
        return authorizedRequest(
                context,
                token,
                "/api/customer/mobile/profiles/" + encodePath(profileId) + "/images",
                "DELETE",
                new JSONObject().put("url", imageUrl)
        );
    }

    public static String profilePreviewUrl(Context context, String profileId) throws Exception {
        return absoluteResourceUrl(
                context,
                "/api/customer/mobile/profiles/" + encodePath(profileId) + "/preview"
        );
    }

    public static String absoluteResourceUrl(Context context, String value) throws Exception {
        String origin = EndpointResolver.activeOrigin(context);
        if (origin.isEmpty()) origin = EndpointResolver.refreshAndResolve(context, false).origin;

        URL originUrl = new URL(origin);
        String candidate = String.valueOf(value == null ? "" : value).trim();
        URL resolved = candidate.startsWith("/")
                ? new URL(originUrl, candidate)
                : new URL(candidate);
        if (
                !"https".equalsIgnoreCase(resolved.getProtocol()) ||
                !originUrl.getHost().equalsIgnoreCase(resolved.getHost()) ||
                effectivePort(originUrl) != effectivePort(resolved)
        ) {
            throw new SecurityException("Kaynak adresi etkin VIP Gece origin'iyle eşleşmiyor.");
        }
        return resolved.toString();
    }

    public static byte[] downloadThumbnail(Context context, String value) throws Exception {
        URL url = new URL(absoluteResourceUrl(context, value));
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(20_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "image/*");
        connection.setRequestProperty("User-Agent", "VIP-Gece-Customer-Native/1");
        int status = connection.getResponseCode();
        String contentType = String.valueOf(connection.getContentType()).toLowerCase(Locale.ROOT);
        if (status != 200 || !contentType.startsWith("image/")) {
            connection.disconnect();
            throw new SecurityException("Profil kapağı alınamadı.");
        }
        try (
                InputStream input = connection.getInputStream();
                ByteArrayOutputStream output = new ByteArrayOutputStream()
        ) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_THUMBNAIL_BYTES) {
                    throw new SecurityException("Profil kapağı izin verilen boyutu aşıyor.");
                }
                output.write(buffer, 0, read);
            }
            if (total == 0) throw new SecurityException("Profil kapağı boş.");
            return output.toByteArray();
        } finally {
            connection.disconnect();
        }
    }

    public static JSONObject createSupportSession(
            Context context,
            String token,
            JSONObject device
    ) throws Exception {
        return authorizedRequest(
                context,
                token,
                "/api/customer/mobile/support/sessions",
                "POST",
                device
        );
    }

    public static JSONObject getSupportSession(
            Context context,
            String token,
            String sessionId
    ) throws Exception {
        return authorizedRequest(
                context,
                token,
                "/api/customer/mobile/support/sessions/" + encodePath(sessionId),
                "GET",
                null
        );
    }

    public static JSONObject uploadSupportSnapshot(
            Context context,
            String token,
            String sessionId,
            JSONObject snapshot
    ) throws Exception {
        return authorizedRequest(
                context,
                token,
                "/api/customer/mobile/support/sessions/" + encodePath(sessionId) + "/snapshot",
                "POST",
                snapshot
        );
    }

    public static JSONObject closeSupportSession(
            Context context,
            String token,
            String sessionId
    ) throws Exception {
        return authorizedRequest(
                context,
                token,
                "/api/customer/mobile/support/sessions/" + encodePath(sessionId),
                "DELETE",
                null
        );
    }

    private static JSONObject authorizedRequest(
            Context context,
            String token,
            String path,
            String method,
            JSONObject body
    ) throws Exception {
        boolean retryable = !"POST".equals(method);
        String origin;
        if (retryable) {
            origin = EndpointResolver.activeOrigin(context);
        } else {
            origin = EndpointResolver.refreshAndResolve(context, false).origin;
        }
        if (origin.isEmpty()) origin = EndpointResolver.refreshAndResolve(context, false).origin;

        HttpJson.Response response;
        try {
            response = HttpJson.request(
                    new URL(origin + path),
                    method,
                    token,
                    body
            );
            if (retryable && response.status >= 500) {
                String refreshed = EndpointResolver
                        .refreshAndResolve(context, true, origin)
                        .origin;
                response = HttpJson.request(
                        new URL(refreshed + path),
                        method,
                        token,
                        body
                );
            }
        } catch (Exception firstError) {
            if (!retryable) throw firstError;
            String refreshed = EndpointResolver
                    .refreshAndResolve(context, true, origin)
                    .origin;
            response = HttpJson.request(
                    new URL(refreshed + path),
                    method,
                    token,
                    body
            );
        }
        requireSuccess(response);
        return response.json;
    }

    private static void requireSuccess(HttpJson.Response response) throws ApiException {
        if (response.successful() && response.json.optBoolean("ok", true)) return;
        String message = response.json.optString("error", "Sunucu isteği tamamlanamadı.");
        String code = response.json.optString("code", "");
        throw new ApiException(response.status, code, message);
    }

    private static String encodePath(String value) {
        return android.net.Uri.encode(String.valueOf(value));
    }

    private static int effectivePort(URL url) {
        return url.getPort() >= 0 ? url.getPort() : url.getDefaultPort();
    }

    public static final class LoginResult {
        public final SecureSessionStore.Session session;
        public final EndpointResolver.Resolution resolution;
        public final boolean mustChangePassword;

        public LoginResult(
                SecureSessionStore.Session session,
                EndpointResolver.Resolution resolution,
                boolean mustChangePassword
        ) {
            this.session = session;
            this.resolution = resolution;
            this.mustChangePassword = mustChangePassword;
        }
    }

    public static final class ApiException extends Exception {
        public final int status;
        public final String code;

        public ApiException(int status, String message) {
            this(status, "", message);
        }

        public ApiException(int status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code == null ? "" : code;
        }
    }
}
