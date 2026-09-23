package com.vipgece.customer;

import java.net.URI;

final class CustomerAccessLink {
    private CustomerAccessLink() {}
    static String token(String gateway, String value) {
        try {
            URI origin = GatewayPolicy.origin(gateway);
            URI link = URI.create(value);
            String fragment = link.getRawFragment();
            if (!"https".equals(link.getScheme()) || link.getRawUserInfo() != null ||
                !origin.getRawAuthority().equalsIgnoreCase(link.getRawAuthority()) ||
                !"/access".equals(link.getRawPath()) || link.getRawQuery() != null ||
                fragment == null || !fragment.matches("[A-Za-z0-9_-]{43}")) {
                throw new IllegalArgumentException();
            }
            return fragment;
        } catch (RuntimeException invalid) {
            // Never include the secret-bearing input in an exception or log.
            throw new IllegalArgumentException("Invalid customer access link");
        }
    }
}
