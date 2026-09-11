"use strict";

function getAuthSupabaseClient() {
  const { getSupabaseClient } = require("../data/supabaseClient");
  return getSupabaseClient();
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getBearerToken(req) {
  const authorization = String(req.get("authorization") || "").trim();
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1].trim() : "";
}

function getAllowedAdminEmails() {
  return parseList(process.env.ADMIN_EMAILS);
}

function getProfileAdminEmails() {
  return parseList(process.env.PROFILE_ADMIN_EMAILS);
}

function resolveAdminRole(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (getAllowedAdminEmails().includes(normalized)) return "full_admin";
  if (getProfileAdminEmails().includes(normalized)) return "profile_admin";
  return "";
}

function getAllowedCustomerEmails() {
  return [
    ...parseList(process.env.CUSTOMER_EMAILS),
    ...parseList(process.env.MOBILE_PARTNER_EMAILS)
  ];
}

async function resolveSupabaseUser(req, res, next) {
  const token = getBearerToken(req);
  const supabase = getAuthSupabaseClient();

  if (!token) {
    return res.status(401).json({ error: "Oturum gerekli." });
  }

  if (!supabase) {
    return res.status(503).json({ error: "Auth servisi staging ortamında hazır değil." });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data || !data.user) {
      return res.status(401).json({ error: "Oturum doğrulanamadı." });
    }

    req.accessToken = token;
    req.authUser = data.user;
    return next();
  } catch (err) {
    console.error("Auth resolve error:", err);
    return res.status(500).json({ error: "Auth kontrolü tamamlanamadı." });
  }
}

function requireAdmin(req, res, next) {
  const email = String(req.authUser && req.authUser.email || "").toLowerCase();
  const role = resolveAdminRole(email);

  if (!role) {
    return res.status(403).json({ error: "Admin yetkisi gerekli." });
  }

  req.adminRole = role;
  return next();
}

function requireFullAdmin(req, res, next) {
  const email = String(req.authUser && req.authUser.email || "").toLowerCase();
  const role = resolveAdminRole(email);

  if (role !== "full_admin") {
    return res.status(403).json({ error: "Tam yönetici yetkisi gerekli." });
  }

  req.adminRole = role;
  return next();
}

function requireCustomerManager(req, res, next) {
  const email = String(req.authUser && req.authUser.email || "").toLowerCase();
  const role = resolveAdminRole(email);

  if (!new Set(["full_admin", "profile_admin"]).has(role)) {
    return res.status(403).json({ error: "Müşteri yönetimi yetkisi gerekli." });
  }

  req.adminRole = role;
  return next();
}

function requireCustomerOrAdmin(req, res, next) {
  const email = String(req.authUser && req.authUser.email || "").toLowerCase();
  const admins = getAllowedAdminEmails();
  const customers = getAllowedCustomerEmails();

  if (admins.includes(email) || customers.includes(email)) {
    return next();
  }

  return res.status(403).json({ error: "Müşteri yetkisi gerekli." });
}

module.exports = {
  resolveSupabaseUser,
  requireAdmin,
  requireFullAdmin,
  requireCustomerManager,
  requireCustomerOrAdmin,
  getBearerToken,
  resolveAdminRole
};
