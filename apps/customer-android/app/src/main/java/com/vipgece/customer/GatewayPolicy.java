package com.vipgece.customer;

import java.net.URI;

final class GatewayPolicy {
    static URI origin(String value) {
        URI uri = URI.create(value == null ? "" : value);
        String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null || !host.matches("(?i)[a-z0-9.-]+") ||
                !host.contains(".") || host.matches("[0-9.]+") || host.endsWith(".supabase.co") ||
                host.endsWith(".local") || host.endsWith(".localhost") || uri.getPort() != -1 ||
                uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null ||
                !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))) {
            throw new IllegalArgumentException("Gateway configuration unavailable");
        }
        return URI.create("https://" + host.toLowerCase(java.util.Locale.ROOT));
    }

    static URI endpoint(URI origin, String path) {
        if (!path.matches("/api/customer/mobile/[a-zA-Z0-9/_-]+") || path.contains("..") || path.contains("//")) {
            throw new IllegalArgumentException("Invalid API path");
        }
        return origin.resolve(path);
    }
}
