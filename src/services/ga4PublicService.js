"use strict";

const { SITE_URL } = require("../config/env");
const { validConfig } = require("../../public/js/ga4-consent");

function getGa4Config() {
  const id = process.env.GA4_MEASUREMENT_ID || "";
  const origin = process.env.GA4_PUBLIC_ORIGIN || "";
  return validConfig(id, origin, SITE_URL) ? { id, origin } : null;
}

function appendGa4(html) {
  const config = getGa4Config();
  if (!config || !/<\/body>/i.test(html)) return html;
  const { id, origin } = config;
  // Configuration is validated before entering markup; this never reads private credentials.
  const additions = '<style data-ga4-consent>.vg-consent-preference{display:block;margin:16px auto;padding:8px 12px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;cursor:pointer}.vg-consent-banner{position:fixed;bottom:84px;left:12px;right:12px;z-index:10000;margin:auto;max-width:640px;padding:16px;background:#fff;color:#222;border:1px solid #555;border-radius:4px;box-sizing:border-box;font:14px/1.5 system-ui,sans-serif}.vg-consent-banner[hidden]{display:none}.vg-consent-banner p{margin:0 0 12px}.vg-consent-banner div{display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap}.vg-consent-banner button{min-height:44px;padding:8px 18px;font:inherit;border:1px solid #444;border-radius:4px;background:#fff;color:#222;cursor:pointer}.vg-consent-banner button:last-child{background:#222;color:#fff}.vg-consent-banner button:disabled{opacity:.5;cursor:not-allowed}</style>' +
    `<script defer src="/public/js/ga4-consent.js" data-ga4-id="${id}" data-ga4-origin="${origin}"></script>`;
  return html.replace(/<\/body>/i, `${additions}</body>`);
}

module.exports = { appendGa4, getGa4Config };
