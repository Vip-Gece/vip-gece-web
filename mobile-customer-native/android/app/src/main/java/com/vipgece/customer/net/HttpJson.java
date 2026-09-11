package com.vipgece.customer.net;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class HttpJson {
    private static final int MAX_JSON_BYTES = 512 * 1024;
    private static final int MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

    private HttpJson() {}

    public static Response request(
            URL url,
            String method,
            String bearerToken,
            JSONObject body
    ) throws Exception {
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            throw new SecurityException("Yalnız HTTPS bağlantısı kullanılabilir.");
        }

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(12_000);
        connection.setReadTimeout(25_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "VIP-Gece-Customer-Native/1");
        if (bearerToken != null && !bearerToken.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
        }

        if (body != null) {
            byte[] encoded = body.toString().getBytes(StandardCharsets.UTF_8);
            if (encoded.length > MAX_JSON_BYTES) {
                throw new SecurityException("İstek gövdesi izin verilen boyutu aşıyor.");
            }
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(encoded.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(encoded);
            }
        }

        return readResponse(connection);
    }

    public static Response requestBinary(
            URL url,
            String method,
            String bearerToken,
            String contentType,
            byte[] body
    ) throws Exception {
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            throw new SecurityException("Yalnız HTTPS bağlantısı kullanılabilir.");
        }
        if (body == null || body.length == 0 || body.length > MAX_UPLOAD_BYTES) {
            throw new SecurityException("Görsel boş veya izin verilen boyutu aşıyor.");
        }
        if (
                !"image/jpeg".equals(contentType) &&
                !"image/png".equals(contentType) &&
                !"image/webp".equals(contentType)
        ) {
            throw new SecurityException("Desteklenmeyen görsel türü.");
        }

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(12_000);
        connection.setReadTimeout(45_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "VIP-Gece-Customer-Native/1");
        connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", contentType);
        connection.setFixedLengthStreamingMode(body.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body);
        }
        return readResponse(connection);
    }

    private static Response readResponse(HttpURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 400
                ? connection.getInputStream()
                : connection.getErrorStream();
        byte[] responseBytes = stream == null ? new byte[0] : readLimited(stream, MAX_JSON_BYTES);
        connection.disconnect();

        JSONObject json;
        if (responseBytes.length == 0) {
            json = new JSONObject();
        } else {
            json = new JSONObject(new String(responseBytes, StandardCharsets.UTF_8));
        }
        return new Response(status, json);
    }

    private static byte[] readLimited(InputStream stream, int maxBytes) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > maxBytes) {
                    throw new SecurityException("Sunucu yanıtı izin verilen boyutu aşıyor.");
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    public static final class Response {
        public final int status;
        public final JSONObject json;

        public Response(int status, JSONObject json) {
            this.status = status;
            this.json = json;
        }

        public boolean successful() {
            return status >= 200 && status < 300;
        }
    }
}
