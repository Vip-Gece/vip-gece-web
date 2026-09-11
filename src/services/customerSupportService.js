"use strict";

const crypto = require("crypto");
const { mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { cleanText } = require("../utils/input");

const SUPPORT_TTL_MS = 30 * 60 * 1000;
const MAX_AUDIT_EVENTS = 80;
const MAX_ERROR_ITEMS = 20;

let supportWriteQueue = Promise.resolve();

function supportStorePath() {
  if (process.env.CUSTOMER_SUPPORT_STORE_PATH) {
    return process.env.CUSTOMER_SUPPORT_STORE_PATH;
  }
  if (process.env.NODE_ENV === "production") {
    return "/var/lib/vip-gece/customer-support-sessions.json";
  }
  return path.join(ROOT_DIR, ".data", "customer-support-sessions.json");
}

async function readSupportStore() {
  try {
    const parsed = JSON.parse(await readFile(supportStorePath(), "utf8"));
    return {
      version: 1,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, sessions: [] };
    const wrapped = new Error("Customer support store could not be read safely.");
    wrapped.status = 503;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function writeSupportStore(store) {
  const filePath = supportStorePath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function mutateSupportStore(callback) {
  const operation = supportWriteQueue.then(async () => {
    const store = await readSupportStore();
    const now = Date.now();
    for (const session of store.sessions) {
      if (session.state !== "closed" && Number(session.expires_at_ms || 0) <= now) {
        session.state = "expired";
      }
    }
    const result = await callback(store);
    await writeSupportStore(store);
    return result;
  });
  supportWriteQueue = operation.catch(() => {});
  return operation;
}

function supportCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function appendAudit(session, action, actor) {
  const events = Array.isArray(session.audit) ? session.audit : [];
  events.push({
    at: new Date().toISOString(),
    action: cleanText(action, 80),
    actor: cleanText(actor, 160)
  });
  session.audit = events.slice(-MAX_AUDIT_EVENTS);
}

function customerSessionView(session) {
  return {
    id: session.id,
    code: session.code,
    state: session.state,
    customer_approved: Boolean(session.customer_approved_at),
    support_approved: Boolean(session.support_approved_at),
    expires_at: session.expires_at,
    scopes: ["app_diagnostics", "endpoint_health", "update_status"],
    can_stop: !["closed", "expired"].includes(session.state)
  };
}

function adminSessionView(session) {
  return {
    ...customerSessionView(session),
    account_id: session.account_id,
    account_label: session.account_label || "",
    support_actor: session.support_actor || "",
    latest_snapshot: session.latest_snapshot || null,
    audit: Array.isArray(session.audit) ? session.audit : []
  };
}

async function createSupportSession(account, device = {}) {
  return mutateSupportStore(async (store) => {
    const active = store.sessions.find(
      (item) =>
        item.account_id === account.id &&
        !["closed", "expired"].includes(item.state) &&
        Number(item.expires_at_ms || 0) > Date.now()
    );
    if (active) return customerSessionView(active);

    const createdAt = Date.now();
    const session = {
      id: crypto.randomUUID(),
      code: supportCode(),
      account_id: account.id,
      account_label: cleanText(account.label, 120),
      state: "waiting_support_approval",
      customer_approved_at: new Date(createdAt).toISOString(),
      support_approved_at: null,
      support_actor: "",
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(createdAt + SUPPORT_TTL_MS).toISOString(),
      expires_at_ms: createdAt + SUPPORT_TTL_MS,
      device: {
        app_version: cleanText(device.app_version, 80),
        android_version: cleanText(device.android_version, 80),
        device_model: cleanText(device.device_model, 120)
      },
      latest_snapshot: null,
      audit: []
    };
    appendAudit(session, "customer_approved", `customer:${account.id}`);
    store.sessions.push(session);
    return customerSessionView(session);
  });
}

async function getCustomerSupportSession(account, sessionId) {
  const store = await readSupportStore();
  const session = store.sessions.find(
    (item) => item.id === sessionId && item.account_id === account.id
  );
  if (!session) return null;
  if (session.state !== "closed" && Number(session.expires_at_ms || 0) <= Date.now()) {
    return { ...customerSessionView(session), state: "expired", can_stop: false };
  }
  return customerSessionView(session);
}

async function approveSupportSession(code, supportActor) {
  return mutateSupportStore(async (store) => {
    const normalizedCode = cleanText(code, 12);
    const session = store.sessions.find((item) => item.code === normalizedCode);
    if (!session || ["closed", "expired"].includes(session.state)) return null;
    if (Number(session.expires_at_ms || 0) <= Date.now()) {
      session.state = "expired";
      return null;
    }

    session.support_approved_at = new Date().toISOString();
    session.support_actor = cleanText(supportActor, 160);
    session.state = "active";
    appendAudit(session, "support_approved", session.support_actor);
    return adminSessionView(session);
  });
}

function sanitizeSnapshot(snapshot = {}) {
  const rawErrors = Array.isArray(snapshot.errors) ? snapshot.errors : [];
  return {
    captured_at: new Date().toISOString(),
    app_version: cleanText(snapshot.app_version, 80),
    android_version: cleanText(snapshot.android_version, 80),
    device_model: cleanText(snapshot.device_model, 120),
    active_origin: cleanText(snapshot.active_origin, 240),
    api_status: cleanText(snapshot.api_status, 120),
    update_status: cleanText(snapshot.update_status, 120),
    config_revision: cleanText(snapshot.config_revision, 120),
    errors: rawErrors
      .map((item) => cleanText(item, 500))
      .filter(Boolean)
      .slice(0, MAX_ERROR_ITEMS)
  };
}

async function submitSupportSnapshot(account, sessionId, snapshot) {
  return mutateSupportStore(async (store) => {
    const session = store.sessions.find(
      (item) => item.id === sessionId && item.account_id === account.id
    );
    if (!session || session.state !== "active") return null;
    if (
      !session.customer_approved_at ||
      !session.support_approved_at ||
      Number(session.expires_at_ms || 0) <= Date.now()
    ) {
      session.state = "expired";
      return null;
    }

    session.latest_snapshot = sanitizeSnapshot(snapshot);
    appendAudit(session, "diagnostics_uploaded", `customer:${account.id}`);
    return customerSessionView(session);
  });
}

async function getAdminSupportSession(sessionId) {
  const store = await readSupportStore();
  const session = store.sessions.find((item) => item.id === sessionId);
  return session ? adminSessionView(session) : null;
}

async function closeSupportSession(sessionId, actor, accountId = "") {
  return mutateSupportStore(async (store) => {
    const session = store.sessions.find(
      (item) =>
        item.id === sessionId &&
        (!accountId || item.account_id === accountId)
    );
    if (!session) return null;
    session.state = "closed";
    session.closed_at = new Date().toISOString();
    appendAudit(session, "session_closed", actor);
    return accountId ? customerSessionView(session) : adminSessionView(session);
  });
}

module.exports = {
  approveSupportSession,
  closeSupportSession,
  createSupportSession,
  getAdminSupportSession,
  getCustomerSupportSession,
  submitSupportSnapshot
};
