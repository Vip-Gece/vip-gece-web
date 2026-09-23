package com.vipgece.customer;

import org.junit.Test;
import static org.junit.Assert.*;

public final class CustomerAccessLinkTest {
    private static final String ORIGIN = "https://customer.example.invalid";
    private static final String TOKEN = "a".repeat(43);
    @Test public void acceptsOnlyAnExactGatewayAccessLink() {
        assertEquals(TOKEN, CustomerAccessLink.token(ORIGIN, ORIGIN + "/access#" + TOKEN));
        assertEquals(TOKEN, CustomerAccessLink.token(ORIGIN, "https://CUSTOMER.example.invalid/access#" + TOKEN));
    }
    @Test public void rejectsOtherOriginsAndAmbiguousUrls() {
        for (String url : new String[] {
            "http://customer.example.invalid/access#" + TOKEN,
            "https://other.example.invalid/access#" + TOKEN,
            "https://customer.example.invalid.evil.invalid/access#" + TOKEN,
            "https://user@customer.example.invalid/access#" + TOKEN,
            ORIGIN + ":8443/access#" + TOKEN,
            ORIGIN + "/%61ccess#" + TOKEN,
            ORIGIN + "/access/?x=1#" + TOKEN,
            ORIGIN + "/access?q=1#" + TOKEN,
            ORIGIN + "/access#" + TOKEN + "x",
            ORIGIN + "/access#" + "a".repeat(42),
            ORIGIN + "/access#%61" + "a".repeat(42),
            ORIGIN + "/access", "", "not a URL", "javascript:alert(1)"
        }) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> CustomerAccessLink.token(ORIGIN, url));
            assertEquals("Invalid customer access link", error.getMessage());
        }
    }
    @Test public void unconfiguredGatewayCannotAcceptLinks() {
        assertThrows(IllegalArgumentException.class,
            () -> CustomerAccessLink.token("", ORIGIN + "/access#" + TOKEN));
    }
}
