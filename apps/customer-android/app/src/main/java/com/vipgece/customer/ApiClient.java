package com.vipgece.customer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class ApiClient {
    static final class Failure extends IOException {
        final int status;
        final String code;
        Failure(int status, String code) { super(code); this.status = status; this.code = code; }
    }
    private final URI origin;
    ApiClient(String value) { origin = GatewayPolicy.origin(value); }
    JSONObject json(String method, String route, String token, JSONObject body) throws Exception {
        return request(method, route, token, body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8), "application/json", null);
    }
    JSONObject image(String profileId, String token, byte[] bytes, String type, String uploadId) throws Exception {
        if (bytes.length == 0 || bytes.length > 8 * 1024 * 1024 || !java.util.Arrays.asList("image/jpeg", "image/png", "image/webp").contains(type)) {
            throw new Failure(400, "INVALID_IMAGE");
        }
        JSONObject response = request("POST", "/api/customer/mobile/profiles/" + profileId + "/images", token, bytes, type, uploadId);
        if (!response.optBoolean("original_saved") || !uploadId.equals(response.optString("upload_id"))) {
            throw new Failure(503, "ORIGINAL_NOT_CONFIRMED");
        }
        return response;
    }
    byte[] photo(String route, String token) throws Exception {
        if (!route.matches("/api/customer/mobile/profiles/[A-Za-z0-9_-]{1,80}/images/(?:[0-9]|1[01])")) {
            throw new Failure(400, "INVALID_IMAGE_PATH");
        }
        HttpsURLConnection connection = (HttpsURLConnection) GatewayPolicy.endpoint(origin, route).toURL().openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "image/jpeg");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            int status = connection.getResponseCode();
            if (status != 200) throw new Failure(status, "IMAGE_UNAVAILABLE");
            String type = connection.getContentType();
            if (type == null || !type.toLowerCase(java.util.Locale.ROOT).startsWith("image/jpeg")) {
                throw new Failure(status, "INVALID_IMAGE_RESPONSE");
            }
            try (InputStream input = connection.getInputStream()) {
                return readBounded(input, 3 * 1024 * 1024);
            }
        } finally { connection.disconnect(); }
    }
    private JSONObject request(String method, String route, String token, byte[] body, String type, String uploadId) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) GatewayPolicy.endpoint(origin, route).toURL().openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setUseCaches(false);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (uploadId != null) connection.setRequestProperty("X-Upload-Id", uploadId);
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", type);
                connection.setFixedLengthStreamingMode(body.length);
                try (var output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new Failure(status, "REDIRECT_BLOCKED");
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT).startsWith("application/json")) throw new Failure(status, "INVALID_RESPONSE");
            JSONObject response;
            try (InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                response = new JSONObject(new String(readBounded(input, 2 * 1024 * 1024), StandardCharsets.UTF_8));
            }
            if (status >= 400 || !response.optBoolean("ok")) throw new Failure(status, response.optString("code", "REQUEST_FAILED"));
            return response;
        } finally { connection.disconnect(); }
    }
    static byte[] readBounded(InputStream input, int max) throws IOException {
        if (input == null) throw new IOException("Empty response");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > max) throw new IOException("Content too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
}
