import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  PRIVATE_PANEL_MODE_EDGE_SECRET,
  PRIVATE_PANEL_MODE_LOOPBACK_SECRET,
  PRIVATE_PANEL_SECRET_HEADER,
  privatePanelEdgeGateEnabled,
  privatePanelRequestAllowed,
  requestHostname
} = await import("../src/middleware/privatePanels.js");

function request(host, headers = {}) {
  return {
    hostname: host,
    get(name) {
      if (String(name).toLowerCase() === "host") return host;
      return headers[String(name).toLowerCase()] || "";
    }
  };
}

const base = {
  NODE_ENV: "production",
  VIP_GECE_PRIVATE_PANELS_ENABLED: "true",
  VIP_GECE_PRIVATE_PANEL_HOSTS: "127.0.0.1,localhost",
  VIP_GECE_PRIVATE_PANEL_MODE: PRIVATE_PANEL_MODE_LOOPBACK_SECRET,
  VIP_GECE_PRIVATE_PANEL_SECRET: "contract-private-panel-secret-000001"
};

const loopbackHeaders = {
  [PRIVATE_PANEL_SECRET_HEADER]: base.VIP_GECE_PRIVATE_PANEL_SECRET
};

assert.equal(requestHostname(request("127.0.0.1:8443")), "127.0.0.1");
assert.equal(requestHostname(request("[::1]:8443")), "::1");
assert.equal(privatePanelEdgeGateEnabled({ NODE_ENV: "production" }), true);
assert.equal(privatePanelEdgeGateEnabled({ NODE_ENV: "staging" }), false);
assert.equal(privatePanelRequestAllowed(request("vip-gece.site", loopbackHeaders), base), false);
assert.equal(privatePanelRequestAllowed(request("vip-gece.online", loopbackHeaders), base), false);
assert.equal(privatePanelRequestAllowed(request("127.0.0.1:8443"), base), false);
assert.equal(
  privatePanelRequestAllowed(request("127.0.0.1:8443", {
    [PRIVATE_PANEL_SECRET_HEADER]: "wrong-private-panel-secret-0000000"
  }), base),
  false
);
assert.equal(
  privatePanelRequestAllowed(request("127.0.0.1:8443", {
    "cf-access-authenticated-user-email": "bkaytanci00@gmail.com",
    "cf-access-jwt-assertion": "legacy-access-assertion"
  }), base),
  false
);
assert.equal(privatePanelRequestAllowed(request("127.0.0.1:8443", loopbackHeaders), base), true);
assert.equal(
  privatePanelRequestAllowed(request("panel.vip-gece.site", loopbackHeaders), {
    ...base,
    VIP_GECE_PRIVATE_PANEL_HOSTS: "panel.vip-gece.site",
    VIP_GECE_PRIVATE_PANEL_MODE: PRIVATE_PANEL_MODE_EDGE_SECRET
  }),
  true
);
assert.equal(
  privatePanelRequestAllowed(request("panel.vip-gece.site"), {
    ...base,
    VIP_GECE_PRIVATE_PANEL_HOSTS: "panel.vip-gece.site",
    VIP_GECE_PRIVATE_PANEL_MODE: PRIVATE_PANEL_MODE_EDGE_SECRET
  }),
  false
);
assert.equal(
  privatePanelRequestAllowed(request("vip-gece.site", loopbackHeaders), {
    ...base,
    VIP_GECE_PRIVATE_PANEL_HOSTS: "panel.vip-gece.site",
    VIP_GECE_PRIVATE_PANEL_MODE: PRIVATE_PANEL_MODE_EDGE_SECRET
  }),
  false
);
assert.equal(
  privatePanelRequestAllowed(request("localhost:3105"), {
    NODE_ENV: "development",
    VIP_GECE_PRIVATE_PANELS_ENABLED: "true",
    VIP_GECE_PRIVATE_PANEL_HOSTS: "localhost"
  }),
  true
);

const nginxSource = await readFile(
  new URL("../ops/nginx/vip-gece-private-loopback.conf", import.meta.url),
  "utf8"
);
assert.match(nginxSource, /listen 127\.0\.0\.1:8443;/);
assert.match(nginxSource, /server_name 127\.0\.0\.1 localhost;/);
assert.match(nginxSource, /X-Vip-Gece-Private-Panel-Secret "__VIP_GECE_PRIVATE_PANEL_SECRET__"/);
assert.doesNotMatch(nginxSource, /yonetim\.vip-gece\.site/i);
assert.doesNotMatch(nginxSource, /listen (?:80|443|\[::\])/);

const [
  adminHtml,
  customerHtml,
  adminThemeSource,
  customerThemeSource,
  adminAppFallback,
  customerAppSource,
  adminAndroidManifest,
  adminNetworkPolicy,
  adminCapacitorConfig
] = await Promise.all([
  readFile(new URL("../vg-panel-91x.html", import.meta.url), "utf8"),
  readFile(new URL("../customer-panel.html", import.meta.url), "utf8"),
  readFile(new URL("../public/js/admin/index.js", import.meta.url), "utf8"),
  readFile(new URL("../public/js/customer-panel.js", import.meta.url), "utf8"),
  readFile(new URL("../mobile-admin/www/index.html", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../mobile-customer-native/android/app/src/main/java/com/vipgece/customer/MainActivity.java",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL("../mobile-admin/android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL(
      "../mobile-admin/android/app/src/main/res/xml/network_security_config.xml",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(new URL("../mobile-admin/capacitor.config.json", import.meta.url), "utf8")
]);

for (const [label, html] of [
  ["admin panel", adminHtml],
  ["customer panel", customerHtml],
  ["admin app fallback", adminAppFallback]
]) {
  assert.match(
    html,
    /name="robots" content="noindex, nofollow, noarchive, nosnippet"/i,
    `${label} must remain private and non-indexable`
  );
  assert.match(html, /value="gece"/i, `${label} exposes the Gece theme`);
  assert.match(html, /value="bordo"/i, `${label} exposes the Bordo theme`);
  assert.match(
    html,
    /value="yuksek-kontrast"/i,
    `${label} exposes the high-contrast theme`
  );
}

assert.match(adminThemeSource, /ADMIN_THEMES = new Set\(\["gece", "bordo", "yuksek-kontrast"\]\)/);
assert.match(adminThemeSource, /\[data-admin-theme\]/);
assert.match(customerThemeSource, /vip-gece-customer-theme/);
assert.match(customerAppSource, /UI_THEME_PREFS = "vip_gece_customer_ui"/);
assert.match(customerAppSource, /showThemePicker\(\)/);
assert.match(customerAppSource, /THEME_HIGH_CONTRAST = "yuksek-kontrast"/);
assert.match(adminAndroidManifest, /android:usesCleartextTraffic="false"/);
assert.match(adminAndroidManifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
assert.match(adminAndroidManifest, /tools:replace="android:usesCleartextTraffic"/);
assert.match(adminNetworkPolicy, /<base-config cleartextTrafficPermitted="false"\s*\/>/);
assert.match(adminNetworkPolicy, /<domain includeSubdomains="false">127\.0\.0\.1<\/domain>/);
assert.match(adminNetworkPolicy, /<domain includeSubdomains="false">localhost<\/domain>/);
assert.match(adminCapacitorConfig, /"url": "http:\/\/127\.0\.0\.1:8443\/vg-panel-91x"/);
assert.doesNotMatch(adminCapacitorConfig, /vip-gece\.(?:site|com|online)/i);

console.log("private panel SSH-loopback contract: ok");
