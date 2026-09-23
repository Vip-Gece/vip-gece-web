"use strict";
const crypto = require("crypto");
const { isIP } = require("node:net");
const { ipKeyGenerator } = require("express-rate-limit");
const { setNoStore } = require("../utils/cacheHeaders");
function requireCustomerGateway(req, res, next) {
  setNoStore(res);
  if (process.env.CUSTOMER_MOBILE_ENABLED !== "true") return res.status(404).json({ ok: false });
  if (process.env.NODE_ENV === "production") {
    const expected = Buffer.from(process.env.CUSTOMER_GATEWAY_ORIGIN_SECRET || "");
    const supplied = Buffer.from(req.get("x-customer-origin-secret") || "");
    if (expected.length < 32 || supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) {
      return res.status(404).json({ ok: false });
    }
    const clientIp = req.get("x-customer-client-ip") || "";
    if (!isIP(clientIp)) return res.status(404).json({ ok: false });
    req.customerClientIp = clientIp;
  }
  return next();
}
function customerRateLimitKey(req) {
  return ipKeyGenerator(req.customerClientIp || req.ip);
}
module.exports = { requireCustomerGateway, customerRateLimitKey };
