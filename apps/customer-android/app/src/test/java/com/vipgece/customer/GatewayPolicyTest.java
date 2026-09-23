package com.vipgece.customer;
import org.junit.Test;
import static org.junit.Assert.*;
public class GatewayPolicyTest {
    @Test public void acceptsOnlyConfiguredHttpsGateway() {
        assertEquals("https://gateway.example.test", GatewayPolicy.origin("https://gateway.example.test").toString());
    }
    @Test public void rejectsDirectOriginAndCredentials() {
        for (String bad : new String[]{"", "http://gateway.test", "https://127.0.0.1", "https://[::1]", "https://localhost", "https://a.supabase.co", "https://user:pass@gateway.test", "https://gateway.test:444", "https://gateway.test/path", "https://gateway.test?q=secret", "https://gateway.test#fragment"}) {
            assertThrows(bad, IllegalArgumentException.class, () -> GatewayPolicy.origin(bad));
        }
    }
    @Test public void cannotRedirectTokenToAnotherHostOrPath() {
        var origin = GatewayPolicy.origin("https://gateway.example.test");
        for (String bad : new String[]{"//attacker.test", "https://attacker.test", "/api/customer/mobile/../../config.js", "/api/customer/mobile/profiles/%2f", "/admin"}) {
            assertThrows(IllegalArgumentException.class, () -> GatewayPolicy.endpoint(origin, bad));
        }
        assertEquals("https://gateway.example.test/api/customer/mobile/bootstrap", GatewayPolicy.endpoint(origin, "/api/customer/mobile/bootstrap").toString());
    }
}
