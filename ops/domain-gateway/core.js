"use strict";

const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const fsConstants = require("node:fs").constants;
const fs = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const FAILURE_THRESHOLD = 3;
const SUCCESS_THRESHOLD = 3;
const COOLDOWN_MS = 60 * 60 * 1000;
const MAX_FAILOVER_MS = 6 * 60 * 60 * 1000;
const CONFIG_MAX_BYTES = 128 * 1024;
const STATE_MAX_BYTES = 64 * 1024;
const JOURNAL_MAX_BYTES = 128 * 1024;
const SECRET_MAX_BYTES = 4096;
const RESPONSE_MAX_BYTES = 256 * 1024;
const PROBE_TIMEOUT_MS = 8000;
const LOCAL_READINESS_TIMEOUT_MS = 2000;
const LOCAL_READINESS_MAX_BYTES = 1024;
const EXTERNAL_SNAPSHOT_MAX_BYTES = 64 * 1024;
const EXTERNAL_SNAPSHOT_MAX_AGE_MS = 7 * 60 * 1000;
const EXTERNAL_REPORT_MAX_TRANSIT_MS = 2 * 60 * 1000;
const EXTERNAL_CLOCK_SKEW_MS = 30 * 1000;
const ACTIVATION_ATTESTATION_MAX_AGE_MS = 30 * 60 * 1000;
const ACTIVATION_ATTESTATION_CLOCK_SKEW_MS = 30 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const CLOUDFLARE_API_ROOT = "https://api.cloudflare.com/client/v4";
const TARGET_ORIGIN_BY_ID = Object.freeze({
  "vip-gece-site": "https://vip-gece.site",
  "vip-gece-online": "https://vip-gece.online"
});
const ACTIVATION_TARGET_ID = "vip-gece-online";
const ACTIVATION_PRIMARY_TARGET_ID = "vip-gece-site";
const ACTIVATION_PROFILE_COUNT = 27;
const ACTIVATION_SITEMAP_COUNT = 267;
const ACTIVATION_GA4_ID = "G-MGGWKPN1KH";
const ACTIVATION_NAMESERVERS = Object.freeze([
  "brett.ns.cloudflare.com",
  "perla.ns.cloudflare.com"
]);

const ACTIVATION_ATTESTATION_KEYS = [
  "version",
  "target_id",
  "primary_target_id",
  "observed_at",
  "expected_nameservers",
  "observed_nameservers",
  "zone_status",
  "tls_mode",
  "canonical_primary",
  "primary",
  "target"
];

const ACTIVATION_CONTENT_KEYS = [
  "manifest_sha256",
  "profile_count",
  "sitemap_count",
  "ga4_id"
];

const EXTERNAL_SNAPSHOT_KEYS = [
  "schema_version",
  "config_version",
  "probe_id",
  "nonce",
  "observed_at",
  "observations",
  "received_at",
  "payload_sha256"
];

const EXTERNAL_OBSERVATION_KEYS = [
  "target_id",
  "url",
  "http_status",
  "tls_verified",
  "hostname_verified",
  "redirect_followed",
  "expected_server",
  "server_header_match",
  "cf_ray_present",
  "contract_ok",
  "edge_reachable",
  "duration_ms",
  "result_code"
];

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function codedError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseUtcSecond(value) {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return NaN;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value.replace("Z", ".000Z")
    ? milliseconds
    : NaN;
}

function exactHttpsOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

function exactHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function activationAttestationConfigBinding(attestation) {
  return {
    version: attestation.version,
    target_id: attestation.target_id,
    primary_target_id: attestation.primary_target_id,
    observed_at: attestation.observed_at,
    expected_nameservers: [...attestation.expected_nameservers],
    observed_nameservers: [...attestation.observed_nameservers],
    zone_status: attestation.zone_status,
    tls_mode: attestation.tls_mode,
    canonical_primary: attestation.canonical_primary,
    primary: { ...attestation.primary },
    target: { ...attestation.target }
  };
}

function normalizedTargetDocument(primaryTargetId, targets) {
  return {
    version: 1,
    primary_target_id: primaryTargetId,
    targets: targets.map((target) => ({
      id: target.id,
      origin: target.origin,
      enabled: target.enabled,
      role: target.role,
      evidence: target.evidence.map((check) => ({
        source: check.source,
        url: check.url,
        statuses: [...check.statuses],
        body_includes: check.bodyIncludes
      })),
      ...(target.activationAttestation
        ? {
            activation_attestation: activationAttestationConfigBinding(
              target.activationAttestation
            )
          }
        : {})
    }))
  };
}

function validateActivationContent(raw, label) {
  if (
    !hasExactKeys(raw, ACTIVATION_CONTENT_KEYS) ||
    !/^[a-f0-9]{64}$/.test(raw.manifest_sha256 || "") ||
    raw.profile_count !== ACTIVATION_PROFILE_COUNT ||
    raw.sitemap_count !== ACTIVATION_SITEMAP_COUNT ||
    raw.ga4_id !== ACTIVATION_GA4_ID
  ) {
    throw new Error(`${label} activation content is invalid`);
  }
  return Object.freeze({
    manifest_sha256: raw.manifest_sha256,
    profile_count: raw.profile_count,
    sitemap_count: raw.sitemap_count,
    ga4_id: raw.ga4_id
  });
}

function validateActivationAttestation(raw, options = {}) {
  try {
    const targetId = options.targetId || ACTIVATION_TARGET_ID;
    const primaryTargetId = options.primaryTargetId || ACTIVATION_PRIMARY_TARGET_ID;
    const nowMs = options.nowMs ?? Date.now();
    const requireFreshness = options.requireFreshness !== false;
    if (
      targetId !== ACTIVATION_TARGET_ID ||
      primaryTargetId !== ACTIVATION_PRIMARY_TARGET_ID ||
      !Number.isFinite(nowMs) ||
      !hasExactKeys(raw, ACTIVATION_ATTESTATION_KEYS) ||
      raw.version !== 1 ||
      raw.target_id !== targetId ||
      raw.primary_target_id !== primaryTargetId
    ) {
      throw new Error("activation attestation identity or schema is invalid");
    }

    const observedMs = parseUtcSecond(raw.observed_at);
    if (
      !Number.isFinite(observedMs) ||
      observedMs > nowMs + ACTIVATION_ATTESTATION_CLOCK_SKEW_MS
    ) {
      throw new Error("activation attestation has an invalid timestamp");
    }
    if (requireFreshness && nowMs - observedMs > ACTIVATION_ATTESTATION_MAX_AGE_MS) {
      throw codedError(
        "ACTIVATION_ATTESTATION_STALE",
        "activation attestation is stale"
      );
    }
    if (
      stableJson(raw.expected_nameservers) !== stableJson(ACTIVATION_NAMESERVERS) ||
      stableJson(raw.observed_nameservers) !== stableJson(ACTIVATION_NAMESERVERS) ||
      raw.zone_status !== "active" ||
      raw.tls_mode !== "strict" ||
      raw.canonical_primary !== TARGET_ORIGIN_BY_ID[ACTIVATION_PRIMARY_TARGET_ID]
    ) {
      throw new Error("activation attestation infrastructure invariants are invalid");
    }

    const primary = validateActivationContent(raw.primary, "primary");
    const target = validateActivationContent(raw.target, "target");
    if (stableJson(primary) !== stableJson(target)) {
      throw new Error("activation attestation does not prove equal content and analytics");
    }

    return Object.freeze({
      version: 1,
      target_id: targetId,
      primary_target_id: primaryTargetId,
      observed_at: raw.observed_at,
      expected_nameservers: ACTIVATION_NAMESERVERS,
      observed_nameservers: ACTIVATION_NAMESERVERS,
      zone_status: "active",
      tls_mode: "strict",
      canonical_primary: TARGET_ORIGIN_BY_ID[ACTIVATION_PRIMARY_TARGET_ID],
      primary,
      target
    });
  } catch (error) {
    if (
      error.code === "CONFIG_INVALID" ||
      error.code === "ACTIVATION_ATTESTATION_STALE"
    ) {
      throw error;
    }
    throw codedError("CONFIG_INVALID", error.message, error);
  }
}

function assertStandbyActivationAttestation(config, targetId, options = {}) {
  const target = config.targetById.get(targetId);
  if (!target?.enabled || target.id === config.primaryTargetId) return null;
  return validateActivationAttestation(target.activationAttestation, {
    ...options,
    targetId: target.id,
    primaryTargetId: config.primaryTargetId,
    requireFreshness: true
  });
}

function validateTargetsConfig(raw, options = {}) {
  try {
    if (!plainObject(raw) || raw.version !== 1 || !Array.isArray(raw.targets) || !raw.targets.length) {
      throw new Error("targets.json schema is invalid");
    }

    const ids = new Set();
    const targets = raw.targets.map((item) => {
      if (!plainObject(item) || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(item.id || "") || ids.has(item.id)) {
        throw new Error("target id is invalid or duplicated");
      }
      ids.add(item.id);

      const origin = exactHttpsOrigin(item.origin);
      if (!origin || TARGET_ORIGIN_BY_ID[item.id] !== origin) {
        throw new Error(`target ${item.id} is not bound to an approved VIP Gece origin`);
      }
      if (item.role !== "primary" && item.role !== "standby") {
        throw new Error(`target ${item.id} role is invalid`);
      }
      if (!Array.isArray(item.evidence) || item.evidence.length < 2) {
        throw new Error(`target ${item.id} needs at least two evidence sources`);
      }

      const sources = new Set();
      const urls = new Set();
      const evidence = item.evidence.map((check) => {
        const source = String(check?.source || "");
        const url = exactHttpsUrl(check?.url);
        const statuses = Array.isArray(check?.statuses) &&
          check.statuses.every((status) => Number.isInteger(status) && status >= 100 && status <= 599)
          ? [...check.statuses]
          : [];
        const bodyIncludes = typeof check?.body_includes === "string" && check.body_includes.length <= 256
          ? check.body_includes
          : "";

        if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(source) || sources.has(source)) {
          throw new Error(`target ${item.id} has an invalid or duplicated evidence source`);
        }
        if (!url || new URL(url).origin !== origin || urls.has(url) || !statuses.length) {
          throw new Error(`target ${item.id} has an invalid or duplicated evidence URL or status`);
        }
        sources.add(source);
        urls.add(url);
        return Object.freeze({ source, url, statuses: Object.freeze(statuses), bodyIncludes });
      });

      return {
        id: item.id,
        origin,
        enabled: item.enabled === true,
        role: item.role,
        evidence: Object.freeze(evidence),
        rawActivationAttestation: item.activation_attestation
      };
    });

    const primaryTargets = targets.filter((target) => target.role === "primary");
    const primary = targets.find((target) => target.id === raw.primary_target_id);
    if (
      primaryTargets.length !== 1 ||
      !primary ||
      !primary.enabled ||
      primary.role !== "primary"
    ) {
      throw new Error("primary_target_id must reference the only enabled primary target");
    }

    const validatedTargets = targets.map((target) => {
      let activationAttestation = null;
      if (target.id === ACTIVATION_TARGET_ID && target.enabled) {
        if (target.role !== "standby") {
          throw new Error(`${ACTIVATION_TARGET_ID} may only be enabled as the standby target`);
        }
        activationAttestation = validateActivationAttestation(target.rawActivationAttestation, {
          targetId: target.id,
          primaryTargetId: primary.id,
          nowMs: options.nowMs,
          requireFreshness: options.requireFreshness
        });
      } else if (target.rawActivationAttestation !== undefined) {
        throw new Error("activation_attestation is allowed only on the enabled vip-gece-online standby");
      }
      return Object.freeze({
        id: target.id,
        origin: target.origin,
        enabled: target.enabled,
        role: target.role,
        evidence: target.evidence,
        activationAttestation
      });
    });

    const normalized = normalizedTargetDocument(primary.id, validatedTargets);
    const configHash = sha256(stableJson(normalized));
    return Object.freeze({
      version: 1,
      primaryTargetId: primary.id,
      configHash,
      normalized: Object.freeze(normalized),
      targets: Object.freeze(validatedTargets),
      targetById: new Map(validatedTargets.map((target) => [target.id, target])),
      allowedEvidenceUrls: new Set(validatedTargets.flatMap((target) =>
        target.evidence.map((check) => check.url)))
    });
  } catch (error) {
    if (
      error.code === "CONFIG_INVALID" ||
      error.code === "ACTIVATION_ATTESTATION_STALE"
    ) {
      throw error;
    }
    throw codedError("CONFIG_INVALID", error.message, error);
  }
}

async function readTrustedFile(filePath, options = {}) {
  const maxBytes = options.maxBytes || CONFIG_MAX_BYTES;
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size <= 0 ||
      stat.size > maxBytes ||
      (stat.mode & 0o022) !== 0 ||
      (options.requirePrivate && (stat.mode & 0o077) !== 0)
    ) {
      throw codedError(options.errorCode || "UNTRUSTED_FILE", `${options.label || "file"} is not a trusted regular file`);
    }
    if (Number.isInteger(options.ownerUid) && stat.uid !== options.ownerUid) {
      throw codedError(options.errorCode || "UNTRUSTED_FILE", `${options.label || "file"} owner is invalid`);
    }
    return await handle.readFile(options.encoding || "utf8");
  } catch (error) {
    if (options.allowMissing && error.code === "ENOENT") return null;
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function readTrustedJson(filePath, options = {}) {
  const source = await readTrustedFile(filePath, options);
  if (source === null) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    throw codedError(options.errorCode || "INVALID_JSON", `${options.label || "JSON file"} is malformed`, error);
  }
}

async function loadTargetsConfig(filePath, options = {}) {
  try {
    const raw = await readTrustedJson(filePath, {
      maxBytes: CONFIG_MAX_BYTES,
      ownerUid: options.ownerUid,
      errorCode: "CONFIG_INVALID",
      label: "targets config"
    });
    return validateTargetsConfig(raw, options);
  } catch (error) {
    if (error.code === "CONFIG_INVALID") throw error;
    throw codedError("CONFIG_INVALID", `unable to load targets config: ${error.message}`, error);
  }
}

function expectedExternalResultCode(observation, edgeReachable) {
  if (edgeReachable && observation.http_status === 200 && observation.contract_ok) {
    return "edge_reachable_ready";
  }
  if (edgeReachable && observation.http_status === 403) {
    return "edge_reachable_http_403";
  }
  if (edgeReachable && observation.http_status === 200) {
    return "ready_contract_invalid";
  }
  if (!observation.tls_verified || !observation.hostname_verified) {
    return "tls_or_transport_failed";
  }
  if (
    observation.redirect_followed ||
    !observation.server_header_match ||
    !observation.cf_ray_present
  ) {
    return "edge_identity_failed";
  }
  return "http_status_unaccepted";
}

function validateExternalProbeSnapshot(raw, config, options = {}) {
  const expectedProbeId = String(options.probeId || "");
  const expectedConfigVersion = Number(options.configVersion);
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? EXTERNAL_SNAPSHOT_MAX_AGE_MS;
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(expectedProbeId) ||
    !Number.isSafeInteger(expectedConfigVersion) ||
    expectedConfigVersion <= 0 ||
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0
  ) {
    throw codedError("CONFIG_INVALID", "external probe reader configuration is invalid");
  }
  if (
    !hasExactKeys(raw, EXTERNAL_SNAPSHOT_KEYS) ||
    raw.schema_version !== 1 ||
    raw.config_version !== expectedConfigVersion ||
    raw.probe_id !== expectedProbeId ||
    !/^[a-f0-9]{32}$/.test(raw.nonce || "") ||
    !Array.isArray(raw.observations) ||
    !/^[a-f0-9]{64}$/.test(raw.payload_sha256 || "")
  ) {
    throw codedError("EXTERNAL_PROBE_INVALID", "external probe snapshot schema or identity is invalid");
  }

  const observedMs = parseUtcSecond(raw.observed_at);
  const receivedMs = parseUtcSecond(raw.received_at);
  if (!Number.isFinite(observedMs) || !Number.isFinite(receivedMs)) {
    throw codedError("EXTERNAL_PROBE_INVALID", "external probe timestamps are invalid");
  }
  if (receivedMs > nowMs + EXTERNAL_CLOCK_SKEW_MS) {
    throw codedError("EXTERNAL_PROBE_INVALID", "external probe receipt time is in the future");
  }
  if (nowMs - receivedMs > maxAgeMs) {
    throw codedError("EXTERNAL_PROBE_STALE", "external probe snapshot is stale");
  }
  if (
    observedMs > receivedMs + EXTERNAL_CLOCK_SKEW_MS ||
    receivedMs - observedMs > EXTERNAL_REPORT_MAX_TRANSIT_MS
  ) {
    throw codedError("EXTERNAL_PROBE_INVALID", "external probe observation and receipt times are inconsistent");
  }

  const enabledTargets = config.targets.filter((target) => target.enabled);
  if (raw.observations.length !== enabledTargets.length) {
    throw codedError("EXTERNAL_PROBE_INVALID", "external probe target set is incomplete");
  }
  const enabledById = new Map(enabledTargets.map((target) => [target.id, target]));
  const seen = new Set();
  for (const observation of raw.observations) {
    if (
      !hasExactKeys(observation, EXTERNAL_OBSERVATION_KEYS) ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(observation.target_id || "") ||
      !Number.isInteger(observation.http_status) ||
      observation.http_status < 0 ||
      observation.http_status > 599 ||
      typeof observation.tls_verified !== "boolean" ||
      typeof observation.hostname_verified !== "boolean" ||
      typeof observation.redirect_followed !== "boolean" ||
      observation.expected_server !== "cloudflare" ||
      typeof observation.server_header_match !== "boolean" ||
      typeof observation.cf_ray_present !== "boolean" ||
      typeof observation.contract_ok !== "boolean" ||
      typeof observation.edge_reachable !== "boolean" ||
      !Number.isInteger(observation.duration_ms) ||
      observation.duration_ms < 0 ||
      observation.duration_ms > 60 * 1000 ||
      typeof observation.result_code !== "string"
    ) {
      throw codedError("EXTERNAL_PROBE_INVALID", "external probe observation schema is invalid");
    }

    const target = enabledById.get(observation.target_id);
    const expectedUrl = target ? `${target.origin}/api/ready` : "";
    if (
      !target ||
      seen.has(target.id) ||
      observation.url !== expectedUrl ||
      (observation.hostname_verified && !observation.tls_verified) ||
      (observation.contract_ok && observation.http_status !== 200)
    ) {
      throw codedError("EXTERNAL_PROBE_INVALID", "external probe target binding is invalid");
    }
    seen.add(target.id);

    const edgeReachable = observation.tls_verified &&
      observation.hostname_verified &&
      !observation.redirect_followed &&
      (observation.http_status === 200 || observation.http_status === 403) &&
      observation.server_header_match &&
      observation.cf_ray_present;
    if (
      observation.edge_reachable !== edgeReachable ||
      observation.result_code !== expectedExternalResultCode(observation, edgeReachable)
    ) {
      throw codedError("EXTERNAL_PROBE_INVALID", "external probe evidence is internally inconsistent");
    }
  }

  const report = {
    schema_version: raw.schema_version,
    config_version: raw.config_version,
    probe_id: raw.probe_id,
    nonce: raw.nonce,
    observed_at: raw.observed_at,
    observations: raw.observations
  };
  if (sha256(stableJson(report)) !== raw.payload_sha256) {
    throw codedError("EXTERNAL_PROBE_INVALID", "external probe payload hash does not match");
  }
  return raw;
}

async function readExternalProbeSnapshot(filePath, config, options = {}) {
  if (!path.isAbsolute(String(filePath || ""))) {
    throw codedError("CONFIG_INVALID", "external probe snapshot path must be absolute");
  }
  try {
    const raw = await readTrustedJson(filePath, {
      maxBytes: EXTERNAL_SNAPSHOT_MAX_BYTES,
      ownerUid: options.ownerUid,
      errorCode: "EXTERNAL_PROBE_INVALID",
      label: "external probe snapshot"
    });
    return validateExternalProbeSnapshot(raw, config, options);
  } catch (error) {
    if (
      error.code === "CONFIG_INVALID" ||
      error.code === "EXTERNAL_PROBE_INVALID" ||
      error.code === "EXTERNAL_PROBE_STALE"
    ) {
      throw error;
    }
    if (error.code === "ELOOP") {
      throw codedError("EXTERNAL_PROBE_INVALID", "external probe snapshot must not be a symlink", error);
    }
    throw codedError("EXTERNAL_PROBE_UNAVAILABLE", "external probe snapshot is unavailable", error);
  }
}

function exactLoopbackReadinessUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !/^\d{1,5}$/.test(url.port) ||
      Number(url.port) < 1 ||
      Number(url.port) > 65535 ||
      url.username ||
      url.password ||
      url.pathname !== "/api/ready" ||
      url.search ||
      url.hash
    ) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function probeLocalReadiness(readinessUrl, options = {}) {
  const exactUrl = exactLoopbackReadinessUrl(readinessUrl);
  if (!exactUrl) {
    return Promise.reject(codedError("CONFIG_INVALID", "local readiness URL is invalid"));
  }
  const timeoutMs = options.timeoutMs || LOCAL_READINESS_TIMEOUT_MS;
  const maxBytes = options.maxBytes || LOCAL_READINESS_MAX_BYTES;
  const requester = options.requester || http.request;

  return new Promise((resolve, reject) => {
    let request;
    let response;
    let settled = false;
    let total = 0;
    const chunks = [];
    const deadline = setTimeout(() => finish(codedError("LOCAL_READINESS_TIMEOUT", "local readiness deadline exceeded")), timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        if (response && typeof response.destroy === "function" && !response.destroyed) response.destroy();
        if (request && typeof request.destroy === "function" && !request.destroyed) request.destroy();
        reject(error);
        return;
      }
      resolve(value);
    }

    try {
      request = requester(exactUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "vip-gece-domain-gateway-local/1.0"
        }
      }, (incoming) => {
        response = incoming;
        response.on("data", (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            finish(codedError("LOCAL_READINESS_TOO_LARGE", "local readiness response exceeded the cap"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", (error) =>
          finish(codedError("LOCAL_READINESS_RESPONSE_ERROR", "local readiness response failed", error)));
        response.once("aborted", () =>
          finish(codedError("LOCAL_READINESS_ABORTED", "local readiness response was aborted")));
        response.once("end", () => {
          const body = Buffer.concat(chunks, total).toString("utf8");
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = null;
          }
          finish(null, {
            source: "local-origin",
            ok: response.statusCode === 200 &&
              hasExactKeys(parsed, ["status"]) &&
              parsed.status === "ready",
            status: response.statusCode || 0
          });
        });
        response.once("close", () => {
          if (!settled && response.complete === false) {
            finish(codedError("LOCAL_READINESS_CLOSED", "local readiness response closed early"));
          }
        });
      });
      request.setTimeout(timeoutMs, () =>
        finish(codedError("LOCAL_READINESS_TIMEOUT", "local readiness socket timed out")));
      request.once("error", (error) =>
        finish(codedError("LOCAL_READINESS_REQUEST_ERROR", "local readiness request failed", error)));
      request.end();
    } catch (error) {
      finish(codedError("LOCAL_READINESS_REQUEST_ERROR", "local readiness request could not be created", error));
    }
  });
}

async function evaluateTargetsWithExternalProbe(config, snapshot, options = {}) {
  const staleStandbyIds = new Set();
  for (const target of config.targets) {
    if (target.enabled && target.id !== config.primaryTargetId) {
      try {
        assertStandbyActivationAttestation(config, target.id, { nowMs: options.nowMs });
      } catch (error) {
        if (error.code !== "ACTIVATION_ATTESTATION_STALE") throw error;
        staleStandbyIds.add(target.id);
      }
    }
  }
  const localEvaluator = options.localReadinessProbe || probeLocalReadiness;
  let local;
  try {
    local = await localEvaluator(options.localReadinessUrl, options.localReadinessOptions);
  } catch (error) {
    local = { source: "local-origin", ok: false, status: 0, error: error.code || "unavailable" };
  }
  const localEvidence = {
    source: "local-origin",
    ok: local?.ok === true && local.status === 200,
    status: Number.isInteger(local?.status) ? local.status : 0,
    ...(local?.error ? { error: String(local.error) } : {})
  };
  const externalById = new Map(snapshot.observations.map((item) => [item.target_id, item]));
  const observations = {};
  for (const target of config.targets) {
    if (!target.enabled) {
      observations[target.id] = { healthy: false, evidenceCount: 0, evidence: [] };
      continue;
    }
    const external = externalById.get(target.id);
    const externalOk = external?.edge_reachable === true &&
      external.http_status === 200 &&
      external.contract_ok === true;
    const edgeOnly = external?.edge_reachable === true &&
      external.http_status === 403;
    const externalEvidence = {
      source: "turkey-edge",
      ok: externalOk,
      status: Number.isInteger(external?.http_status) ? external.http_status : 0,
      result: external?.result_code || "missing"
    };
    if (staleStandbyIds.has(target.id)) {
      observations[target.id] = {
        healthy: false,
        evidenceCount: Number(externalEvidence.ok),
        indeterminate: true,
        reason: "activation_attestation_stale",
        evidence: [externalEvidence]
      };
      continue;
    }
    const evidenceCount = Number(externalEvidence.ok) + Number(localEvidence.ok);
    observations[target.id] = {
      healthy: evidenceCount === 2,
      evidenceCount,
      indeterminate: edgeOnly,
      evidence: [externalEvidence, { ...localEvidence }]
    };
  }
  return observations;
}

function externalProbeRecord(snapshot) {
  return {
    probe_id: snapshot.probe_id,
    config_version: snapshot.config_version,
    nonce: snapshot.nonce,
    observed_at: snapshot.observed_at,
    received_at: snapshot.received_at,
    payload_sha256: snapshot.payload_sha256
  };
}

function externalProbeDisposition(state, snapshot, config) {
  const validated = validateState(state, config);
  if (!validated) throw codedError("STATE_INVALID", "cannot compare external probe against invalid state");
  const next = externalProbeRecord(snapshot);
  const previous = validated.last_external_probe;
  if (!previous) return "new";
  if (previous.nonce === next.nonce) {
    if (stableJson(previous) === stableJson(next)) return "replay";
    throw codedError("EXTERNAL_PROBE_REPLAY_CONFLICT", "external probe nonce was reused with different metadata");
  }
  if (
    parseUtcSecond(next.observed_at) <= parseUtcSecond(previous.observed_at) ||
    parseUtcSecond(next.received_at) < parseUtcSecond(previous.received_at)
  ) {
    throw codedError("EXTERNAL_PROBE_OUT_OF_ORDER", "external probe snapshot is older than the last consumed sample");
  }
  return "new";
}

function recordExternalProbe(state, snapshot, config) {
  const validated = validateState(state, config);
  if (!validated) throw codedError("STATE_INVALID", "cannot record external probe on invalid state");
  if (externalProbeDisposition(validated, snapshot, config) !== "new") {
    throw codedError("EXTERNAL_PROBE_REPLAY", "external probe snapshot was already consumed");
  }
  return {
    ...validated,
    last_external_probe: externalProbeRecord(snapshot)
  };
}

function buildRedirectLocation(targetOrigin, rawRequestUrl) {
  const origin = exactHttpsOrigin(targetOrigin);
  const requestUrl = String(rawRequestUrl || "");
  if (
    !origin ||
    !requestUrl.startsWith("/") ||
    requestUrl.startsWith("//") ||
    requestUrl.length > 8192 ||
    /[\u0000-\u001f\u007f]/.test(requestUrl) ||
    /%(?:0d|0a)/i.test(requestUrl) ||
    requestUrl.includes("#")
  ) {
    return "";
  }

  try {
    const parsed = new URL(requestUrl, origin);
    if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash) {
      return "";
    }
    return `${origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

function initialState(config, nowMs = Date.now()) {
  return {
    version: 3,
    config_hash: config.configHash,
    active_target_id: config.primaryTargetId,
    counters: Object.fromEntries(config.targets.map((target) => [
      target.id,
      { consecutive_failures: 0, consecutive_successes: 0 }
    ])),
    last_external_probe: null,
    last_switch_at: null,
    failover_started_at: null,
    updated_at: new Date(nowMs).toISOString()
  };
}

function validIsoOrNull(value) {
  if (value === null) return true;
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validCounter(counter) {
  return plainObject(counter) &&
    Number.isSafeInteger(counter.consecutive_failures) &&
    counter.consecutive_failures >= 0 &&
    Number.isSafeInteger(counter.consecutive_successes) &&
    counter.consecutive_successes >= 0;
}

function validExternalProbeRecord(record) {
  return record === null || (
    hasExactKeys(record, [
      "probe_id",
      "config_version",
      "nonce",
      "observed_at",
      "received_at",
      "payload_sha256"
    ]) &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(record.probe_id || "") &&
    Number.isSafeInteger(record.config_version) &&
    record.config_version > 0 &&
    /^[a-f0-9]{32}$/.test(record.nonce || "") &&
    Number.isFinite(parseUtcSecond(record.observed_at)) &&
    Number.isFinite(parseUtcSecond(record.received_at)) &&
    /^[a-f0-9]{64}$/.test(record.payload_sha256 || "")
  );
}

function rebaseStateForConfig(raw, config) {
  if (
    !plainObject(raw) ||
    (raw.version !== 1 && raw.version !== 2 && raw.version !== 3) ||
    !config.targetById.get(raw.active_target_id)?.enabled ||
    !plainObject(raw.counters) ||
    (raw.version === 3 && !validExternalProbeRecord(raw.last_external_probe)) ||
    !validIsoOrNull(raw.last_switch_at) ||
    !validIsoOrNull(raw.failover_started_at) ||
    typeof raw.updated_at !== "string" ||
    !validIsoOrNull(raw.updated_at)
  ) {
    return null;
  }

  const resetHealthHistory = raw.version !== 3 || raw.config_hash !== config.configHash;
  const counters = {};
  for (const target of config.targets) {
    const counter = raw.counters[target.id];
    counters[target.id] = !resetHealthHistory && validCounter(counter)
      ? {
          consecutive_failures: counter.consecutive_failures,
          consecutive_successes: counter.consecutive_successes
        }
      : { consecutive_failures: 0, consecutive_successes: 0 };
  }

  return {
    version: 3,
    config_hash: config.configHash,
    active_target_id: raw.active_target_id,
    counters,
    last_external_probe: resetHealthHistory ? null : raw.last_external_probe,
    last_switch_at: raw.last_switch_at,
    failover_started_at: raw.failover_started_at,
    updated_at: raw.updated_at
  };
}

function validateState(raw, config) {
  if (
    !plainObject(raw) ||
    raw.version !== 3 ||
    raw.config_hash !== config.configHash
  ) {
    return null;
  }
  return rebaseStateForConfig(raw, config);
}

async function readState(filePath, config, options = {}) {
  const raw = await readTrustedJson(filePath, {
    allowMissing: options.allowMissing,
    maxBytes: STATE_MAX_BYTES,
    errorCode: "STATE_INVALID",
    label: "state file"
  });
  if (raw === null) return null;

  const state = options.allowConfigRebase
    ? rebaseStateForConfig(raw, config)
    : validateState(raw, config);
  if (!state) {
    const code = raw?.config_hash && raw.config_hash !== config.configHash
      ? "CONFIG_MISMATCH"
      : "STATE_INVALID";
    throw codedError(code, code === "CONFIG_MISMATCH"
      ? "state and targets config hashes do not match"
      : "state schema is invalid");
  }
  return state;
}

async function fsyncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY || 0));
    await handle.sync();
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function writeJsonAtomic(filePath, document, options = {}) {
  const directory = path.dirname(filePath);
  const mode = options.mode || 0o600;
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`;
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o022) !== 0) {
    throw codedError(options.errorCode || "UNTRUSTED_DIRECTORY", `${options.label || "output"} directory is not trusted`);
  }

  let handle;
  try {
    handle = await fs.open(temporary, "wx", mode);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, mode);
    await fsyncDirectory(directory);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function removeFileDurable(filePath) {
  try {
    await fs.unlink(filePath);
    await fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function writeStateAtomic(filePath, state, config) {
  const validated = validateState(state, config);
  if (!validated) throw codedError("STATE_INVALID", "refusing to write invalid state");
  await writeJsonAtomic(filePath, validated, { mode: 0o600, errorCode: "STATE_INVALID", label: "state" });
}

function createPendingJournal(config, beforeState, committedState, decision, nowMs = Date.now()) {
  const before = validateState(beforeState, config);
  const committed = validateState(committedState, config);
  if (
    !before ||
    !committed ||
    decision?.type !== "switch" ||
    decision.from !== before.active_target_id ||
    decision.to !== committed.active_target_id ||
    decision.from === decision.to ||
    !config.targetById.get(decision.to)?.enabled
  ) {
    throw codedError("JOURNAL_INVALID", "refusing to create an invalid pending journal");
  }
  return {
    version: 1,
    config_hash: config.configHash,
    decision: {
      type: "switch",
      from: decision.from,
      to: decision.to
    },
    before_state: before,
    committed_state: committed,
    created_at: new Date(nowMs).toISOString()
  };
}

function validatePendingJournal(raw, config) {
  if (
    !plainObject(raw) ||
    raw.version !== 1 ||
    raw.config_hash !== config.configHash ||
    typeof raw.created_at !== "string" ||
    !validIsoOrNull(raw.created_at) ||
    !plainObject(raw.decision) ||
    raw.decision.type !== "switch"
  ) {
    return null;
  }
  try {
    return createPendingJournal(
      config,
      raw.before_state,
      raw.committed_state,
      raw.decision,
      Date.parse(raw.created_at)
    );
  } catch {
    return null;
  }
}

async function readPendingJournal(filePath, config, options = {}) {
  const raw = await readTrustedJson(filePath, {
    allowMissing: options.allowMissing,
    maxBytes: JOURNAL_MAX_BYTES,
    errorCode: "JOURNAL_INVALID",
    label: "pending journal"
  });
  if (raw === null) return null;
  const journal = validatePendingJournal(raw, config);
  if (!journal) throw codedError("JOURNAL_INVALID", "pending journal schema or config hash is invalid");
  return journal;
}

async function writePendingJournalAtomic(filePath, journal, config) {
  const validated = validatePendingJournal(journal, config);
  if (!validated) throw codedError("JOURNAL_INVALID", "refusing to write invalid pending journal");
  await writeJsonAtomic(filePath, validated, {
    mode: 0o600,
    errorCode: "JOURNAL_INVALID",
    label: "pending journal"
  });
}

function pidIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function readLockIdentity(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o022) !== 0) {
      throw codedError("LOCK_INVALID", "monitor lock is not trusted");
    }
    const parsed = JSON.parse(await handle.readFile("utf8"));
    if (
      !plainObject(parsed) ||
      !Number.isSafeInteger(parsed.pid) ||
      !/^[a-f0-9]{32}$/.test(parsed.nonce || "") ||
      typeof parsed.created_at !== "string" ||
      !validIsoOrNull(parsed.created_at)
    ) {
      throw codedError("LOCK_INVALID", "monitor lock identity is invalid");
    }
    return { identity: parsed, stat };
  } catch (error) {
    if (error instanceof SyntaxError) throw codedError("LOCK_INVALID", "monitor lock JSON is malformed", error);
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function createOwnedLock(filePath, directory) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const candidate = `${filePath}.candidate.${process.pid}.${nonce}`;
  const identity = {
    pid: process.pid,
    nonce,
    created_at: new Date().toISOString()
  };
  let handle;
  try {
    handle = await fs.open(candidate, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(identity)}\n`, "utf8");
    await handle.sync();
    const ownedStat = await handle.stat();
    await fs.link(candidate, filePath);
    await fs.unlink(candidate);
    await fsyncDirectory(directory);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        const current = await readLockIdentity(filePath).catch(() => null);
        if (
          current &&
          current.identity.nonce === nonce &&
          current.stat.dev === ownedStat.dev &&
          current.stat.ino === ownedStat.ino
        ) {
          await fs.unlink(filePath);
          await fsyncDirectory(directory);
        }
      } finally {
        await handle.close().catch(() => {});
      }
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(candidate).catch(() => {});
    throw error;
  }
}

async function acquireFileLock(filePath, options = {}) {
  const staleMs = options.staleMs || LOCK_STALE_MS;
  const alive = options.pidIsAlive || pidIsAlive;
  const directory = path.dirname(filePath);
  const takeoverFile = `${filePath}.takeover`;
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o022) !== 0) {
    throw codedError("LOCK_INVALID", "monitor lock directory is not trusted");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const takeoverExists = await fs.access(takeoverFile).then(() => true, (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    if (takeoverExists) {
      throw codedError("LOCKED", "monitor lock takeover is already in progress");
    }

    try {
      return await createOwnedLock(filePath, directory);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const current = await readLockIdentity(filePath).catch((readError) => {
        if (readError.code === "ENOENT") return null;
        throw readError;
      });
      if (!current) continue;
      const ageMs = Date.now() - current.stat.mtimeMs;
      if (ageMs <= staleMs || alive(current.identity.pid)) {
        const locked = codedError("LOCKED", "monitor lock is already held");
        locked.ownerPid = current.identity.pid;
        throw locked;
      }

      let takeoverHandle;
      try {
        takeoverHandle = await fs.open(takeoverFile, "wx", 0o600);
        await takeoverHandle.writeFile(`${JSON.stringify({
          pid: process.pid,
          nonce: crypto.randomBytes(16).toString("hex"),
          created_at: new Date().toISOString()
        })}\n`, "utf8");
        await takeoverHandle.sync();

        const latest = await readLockIdentity(filePath);
        const latestAgeMs = Date.now() - latest.stat.mtimeMs;
        if (
          latest.identity.nonce !== current.identity.nonce ||
          latest.stat.dev !== current.stat.dev ||
          latest.stat.ino !== current.stat.ino ||
          latestAgeMs <= staleMs ||
          alive(latest.identity.pid)
        ) {
          throw codedError("LOCKED", "monitor lock changed or became live during stale takeover");
        }

        const quarantine = `${filePath}.stale.${latest.identity.nonce}.${crypto.randomBytes(6).toString("hex")}`;
        await fs.rename(filePath, quarantine);
        await fs.unlink(quarantine).catch(() => {});
        await fsyncDirectory(directory);
        return await createOwnedLock(filePath, directory);
      } catch (takeoverError) {
        if (takeoverError.code === "EEXIST") {
          throw codedError("LOCKED", "another monitor is handling stale lock takeover");
        }
        throw takeoverError;
      } finally {
        if (takeoverHandle) {
          await takeoverHandle.close().catch(() => {});
          await fs.unlink(takeoverFile).catch(() => {});
          await fsyncDirectory(directory).catch(() => {});
        }
      }
    }
  }
  throw codedError("LOCKED", "unable to acquire monitor lock");
}

async function withFileLock(filePath, callback, options) {
  const release = await acquireFileLock(filePath, options);
  try {
    return await callback();
  } finally {
    await release();
  }
}

function ipv4Number(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inIpv4Range(value, base, bits) {
  const shift = 32 - bits;
  return (value >>> shift) === (base >>> shift);
}

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    const denied = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4]
    ];
    return !denied.some(([base, bits]) => inIpv4Range(value, ipv4Number(base), bits));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return /^[23][0-9a-f]{3}:/.test(normalized) && !normalized.startsWith("2001:db8:");
  }
  return false;
}

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const entry = addresses[0];
    if (options?.all) {
      callback(null, addresses);
      return;
    }
    callback(null, entry.address, entry.family);
  };
}

function requestHttps(url, addresses, options = {}) {
  const timeoutMs = options.timeoutMs || PROBE_TIMEOUT_MS;
  const maxBytes = options.maxBytes || RESPONSE_MAX_BYTES;
  const requester = options.requester || https.request;

  return new Promise((resolve, reject) => {
    let request;
    let response;
    let settled = false;
    let total = 0;
    const chunks = [];
    const deadline = setTimeout(() => {
      finish(codedError("PROBE_TIMEOUT", "probe total deadline exceeded"));
    }, timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        if (response && typeof response.destroy === "function" && !response.destroyed) {
          response.destroy();
        }
        if (request && typeof request.destroy === "function" && !request.destroyed) {
          request.destroy();
        }
        reject(error);
        return;
      }
      resolve(value);
    }

    try {
      request = requester(url, {
        method: "GET",
        headers: {
          Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1",
          "User-Agent": "vip-gece-domain-gateway/1.0"
        },
        lookup: pinnedLookup(addresses),
        servername: new URL(url).hostname
      }, (incoming) => {
        response = incoming;
        response.on("data", (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            finish(codedError("PROBE_TOO_LARGE", "probe response body exceeded the cap"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", (error) => finish(codedError("PROBE_RESPONSE_ERROR", "probe response failed", error)));
        response.once("aborted", () => finish(codedError("PROBE_ABORTED", "probe response was aborted")));
        response.once("end", () => {
          finish(null, {
            status: response.statusCode || 0,
            body: Buffer.concat(chunks, total).toString("utf8")
          });
        });
        response.once("close", () => {
          if (!settled && response.complete === false) {
            finish(codedError("PROBE_CLOSED", "probe response closed before completion"));
          }
        });
      });
      request.setTimeout(timeoutMs, () => finish(codedError("PROBE_TIMEOUT", "probe socket timed out")));
      request.once("error", (error) => finish(codedError("PROBE_REQUEST_ERROR", "probe request failed", error)));
      request.end();
    } catch (error) {
      finish(codedError("PROBE_REQUEST_ERROR", "probe request could not be created", error));
    }
  });
}

async function withDeadline(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(codedError("PROBE_TIMEOUT", message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function probeEvidence(check, allowedUrls, options = {}) {
  const exactUrl = exactHttpsUrl(check?.url);
  if (!exactUrl || !allowedUrls.has(exactUrl)) {
    throw new Error("probe URL is not in the exact HTTPS allowlist");
  }

  const timeoutMs = options.timeoutMs || PROBE_TIMEOUT_MS;
  const startedAt = Date.now();
  const hostname = new URL(exactUrl).hostname;
  const resolver = options.resolver || dns.lookup;
  const resolved = await withDeadline(
    Promise.resolve().then(() => resolver(hostname, { all: true, verbatim: true })),
    timeoutMs,
    "probe DNS deadline exceeded"
  );
  const addresses = (Array.isArray(resolved) ? resolved : [resolved])
    .map((entry) => ({ address: entry.address, family: Number(entry.family) }));
  if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new Error("probe DNS resolved to a non-public address");
  }

  const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
  const response = await requestHttps(exactUrl, addresses, { ...options, timeoutMs: remainingMs });
  const ok = check.statuses.includes(response.status) &&
    (!check.bodyIncludes || response.body.includes(check.bodyIncludes));
  return { source: check.source, ok, status: response.status };
}

async function evaluateTarget(target, config, options = {}) {
  if (!target.enabled) {
    return { healthy: false, evidenceCount: 0, evidence: [] };
  }

  const evidence = await Promise.all(target.evidence.map(async (check) => {
    try {
      return await probeEvidence(check, config.allowedEvidenceUrls, options);
    } catch (error) {
      return { source: check.source, ok: false, status: 0, error: error.message };
    }
  }));
  const independentSources = new Set(evidence.filter((item) => item.ok).map((item) => item.source));
  return {
    healthy: evidence.length >= 2 && evidence.every((item) => item.ok) && independentSources.size >= 2,
    evidenceCount: independentSources.size,
    evidence
  };
}

function advanceState(currentState, config, observations, nowMs = Date.now()) {
  const validated = validateState(currentState, config);
  if (!validated) throw codedError("STATE_INVALID", "cannot advance invalid state");
  const state = JSON.parse(JSON.stringify(validated));
  const enabledTargets = config.targets.filter((target) => target.enabled);
  const previousProbeObservedMs = parseUtcSecond(state.last_external_probe?.observed_at);
  if (
    Number.isFinite(previousProbeObservedMs) &&
    nowMs - previousProbeObservedMs > EXTERNAL_SNAPSHOT_MAX_AGE_MS
  ) {
    for (const counter of Object.values(state.counters)) {
      counter.consecutive_failures = 0;
      counter.consecutive_successes = 0;
    }
  }

  for (const target of config.targets) {
    const observation = observations[target.id] || {};
    const counter = state.counters[target.id];
    if (!target.enabled) {
      counter.consecutive_failures = 0;
      counter.consecutive_successes = 0;
      continue;
    }
    if (observation.indeterminate === true) {
      counter.consecutive_failures = 0;
      counter.consecutive_successes = 0;
      continue;
    }
    const healthy = observation.healthy === true && observation.evidenceCount >= 2;
    if (healthy) {
      counter.consecutive_successes = Math.min(counter.consecutive_successes + 1, SUCCESS_THRESHOLD);
      counter.consecutive_failures = 0;
    } else {
      counter.consecutive_failures = Math.min(counter.consecutive_failures + 1, FAILURE_THRESHOLD);
      counter.consecutive_successes = 0;
    }
  }
  state.updated_at = new Date(nowMs).toISOString();

  const healthyEnabled = enabledTargets.filter((target) => observations[target.id]?.healthy === true &&
    observations[target.id]?.evidenceCount >= 2);
  if (!healthyEnabled.length) {
    if (enabledTargets.some((target) => observations[target.id]?.indeterminate === true)) {
      return { state, decision: null, reason: "external_evidence_indeterminate" };
    }
    return { state, decision: null, reason: "all_targets_unhealthy" };
  }

  const active = config.targetById.get(state.active_target_id);
  if (!active) return { state, decision: null, reason: "active_target_invalid" };
  if (observations[active.id]?.indeterminate === true) {
    return { state, decision: null, reason: "active_external_evidence_indeterminate" };
  }

  if (active.id !== config.primaryTargetId) {
    const started = Date.parse(state.failover_started_at || "");
    if (Number.isFinite(started) && nowMs - started >= MAX_FAILOVER_MS) {
      return { state, decision: null, reason: "max_failover_window_requires_manual_action" };
    }
    return { state, decision: null, reason: "automatic_failback_disabled" };
  }

  if (state.counters[active.id].consecutive_failures < FAILURE_THRESHOLD) {
    return { state, decision: null, reason: "active_failure_threshold_not_met" };
  }

  const lastSwitch = Date.parse(state.last_switch_at || "");
  if (Number.isFinite(lastSwitch) && nowMs - lastSwitch < COOLDOWN_MS) {
    return { state, decision: null, reason: "switch_cooldown_active" };
  }

  const candidate = config.targets.find((target) =>
    target.enabled &&
    target.role === "standby" &&
    target.id !== active.id &&
    observations[target.id]?.healthy === true &&
    observations[target.id]?.evidenceCount >= 2 &&
    state.counters[target.id].consecutive_successes >= SUCCESS_THRESHOLD
  );
  if (!candidate) {
    return { state, decision: null, reason: "candidate_success_threshold_not_met" };
  }

  return {
    state,
    decision: { type: "switch", from: active.id, to: candidate.id },
    reason: "failover_thresholds_met"
  };
}

function commitSwitch(state, decision, config, nowMs = Date.now()) {
  const validated = validateState(state, config);
  if (
    !validated ||
    decision?.type !== "switch" ||
    decision.from !== validated.active_target_id ||
    !config.targetById.get(decision.to)?.enabled
  ) {
    throw new Error("invalid switch decision");
  }

  const next = JSON.parse(JSON.stringify(validated));
  next.active_target_id = decision.to;
  next.last_switch_at = new Date(nowMs).toISOString();
  next.failover_started_at = decision.to === config.primaryTargetId
    ? null
    : new Date(nowMs).toISOString();
  next.updated_at = new Date(nowMs).toISOString();
  return next;
}

function cloudflareId(value, label) {
  const id = String(value || "");
  if (!/^[a-f0-9]{32}$/i.test(id)) throw codedError("CONFIG_INVALID", `${label} is invalid`);
  return id;
}

function exactDomainName(value, label = "domain name") {
  const source = String(value || "").toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(source)) {
    throw codedError("CONFIG_INVALID", `${label} is invalid`);
  }
  return source;
}

function exactRuleRef(value) {
  const source = String(value || "");
  if (!/^[a-z0-9][a-z0-9_-]{2,127}$/i.test(source)) {
    throw codedError("CONFIG_INVALID", "Cloudflare rule ref is missing or invalid");
  }
  return source;
}

function exactRuleExpression(value) {
  const source = String(value || "");
  if (!source || source.length > 4096 || /[\r\n]/.test(source)) {
    throw codedError("CONFIG_INVALID", "Cloudflare expected rule expression is missing or invalid");
  }
  return source;
}

function redirectExpression(origin) {
  return `concat("${origin}", http.request.uri.path)`;
}

function hasExplicitRuleRef(rule) {
  return typeof rule.ref === "string" &&
    rule.ref.length > 0 &&
    rule.ref !== rule.id;
}

function rulePatchBody(rule, targetOrigin) {
  const body = {
    action: rule.action,
    action_parameters: {
      ...(rule.action_parameters || {}),
      from_value: {
        ...(rule.action_parameters?.from_value || {}),
        status_code: 301,
        target_url: { expression: redirectExpression(targetOrigin) },
        preserve_query_string: true
      }
    },
    expression: rule.expression,
    description: rule.description || "",
    enabled: rule.enabled !== false
  };
  // Cloudflare returns the public rule ID as `ref` when no explicit ref was
  // assigned. Sending that generated value back in a PATCH is rejected; only
  // preserve refs that were explicitly assigned by an operator.
  if (hasExplicitRuleRef(rule)) body.ref = rule.ref;
  if (plainObject(rule.logging)) body.logging = rule.logging;
  return body;
}

function existingRulePatchBody(rule) {
  const body = {
    action: rule.action,
    action_parameters: rule.action_parameters,
    expression: rule.expression,
    description: rule.description || "",
    enabled: rule.enabled !== false
  };
  if (hasExplicitRuleRef(rule)) body.ref = rule.ref;
  if (plainObject(rule.logging)) body.logging = rule.logging;
  return body;
}

async function cloudflareJson(fetchImpl, token, method, url, body) {
  if (typeof token !== "string" || token.length < 20 || token.length > SECRET_MAX_BYTES || /[\r\n]/.test(token)) {
    throw codedError("CONFIG_INVALID", "Cloudflare API token is missing or invalid");
  }
  const response = await fetchImpl(url, {
    method,
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const source = await response.text();
  if (source.length > RESPONSE_MAX_BYTES) throw codedError("CF_API_ERROR", "Cloudflare API response exceeded the cap");
  let parsed;
  try {
    parsed = source ? JSON.parse(source) : {};
  } catch (error) {
    throw codedError("CF_API_ERROR", "Cloudflare API returned malformed JSON", error);
  }
  if (!response.ok || parsed.success !== true) {
    const code = response.status === 401 || response.status === 403 ? "CONFIG_INVALID" : "CF_API_ERROR";
    throw codedError(code, `Cloudflare API ${method} failed with HTTP ${response.status}`);
  }
  return parsed.result;
}

function validateCloudflareMetadata(options) {
  return {
    zoneId: cloudflareId(options.zoneId, "zone id"),
    rulesetId: cloudflareId(options.rulesetId, "ruleset id"),
    ruleId: cloudflareId(options.ruleId, "rule id"),
    expectedZoneName: exactDomainName(options.expectedZoneName, "Cloudflare expected zone name"),
    expectedRuleRef: exactRuleRef(options.expectedRuleRef),
    expectedRuleExpression: exactRuleExpression(options.expectedRuleExpression)
  };
}

async function inspectCloudflareRedirect(options) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const metadata = validateCloudflareMetadata(options);
  const allowedCurrentOrigins = (options.allowedCurrentOrigins || [])
    .map(exactHttpsOrigin)
    .filter(Boolean);
  if (!allowedCurrentOrigins.length) {
    throw codedError("CONFIG_INVALID", "at least one allowed current redirect origin is required");
  }

  const zoneUrl = `${CLOUDFLARE_API_ROOT}/zones/${metadata.zoneId}`;
  const rulesetUrl = `${zoneUrl}/rulesets/${metadata.rulesetId}`;
  const zone = await cloudflareJson(fetchImpl, options.token, "GET", zoneUrl);
  if (exactDomainName(zone?.name, "Cloudflare returned zone name") !== metadata.expectedZoneName) {
    throw codedError("CF_IDENTITY_MISMATCH", "Cloudflare zone ID does not match the expected zone name");
  }
  const ruleset = await cloudflareJson(fetchImpl, options.token, "GET", rulesetUrl);
  if (ruleset?.phase !== "http_request_dynamic_redirect" || !Array.isArray(ruleset.rules)) {
    throw codedError("CF_IDENTITY_MISMATCH", "refusing to inspect a non-dynamic-redirect ruleset");
  }
  const rule = ruleset.rules.find((item) => item.id === metadata.ruleId);
  if (
    !rule ||
    rule.action !== "redirect" ||
    rule.ref !== metadata.expectedRuleRef ||
    rule.expression !== metadata.expectedRuleExpression ||
    rule.enabled !== true ||
    rule.action_parameters?.from_value?.status_code !== 301 ||
    rule.action_parameters?.from_value?.preserve_query_string !== true
  ) {
    throw codedError("CF_IDENTITY_MISMATCH", "exact Cloudflare redirect rule identity or invariant did not match");
  }
  const currentOrigin = allowedCurrentOrigins.find((origin) =>
    rule.action_parameters?.from_value?.target_url?.expression === redirectExpression(origin)
  );
  if (!currentOrigin) {
    throw codedError("CF_TARGET_MISMATCH", "Cloudflare redirect target is not in the expected current-origin set");
  }
  const rulesetVersion = String(ruleset.version || "");
  if (!/^[0-9]+$/.test(rulesetVersion)) {
    throw codedError("CF_IDENTITY_MISMATCH", "Cloudflare ruleset version is missing or invalid");
  }
  return {
    metadata,
    zone,
    rulesetVersion,
    rule,
    ruleBody: existingRulePatchBody(rule),
    currentOrigin,
    zoneUrl,
    rulesetUrl,
    ruleUrl: `${rulesetUrl}/rules/${metadata.ruleId}`
  };
}

async function updateCloudflareRedirect(options) {
  const targetOrigin = exactHttpsOrigin(options.targetOrigin);
  const expectedCurrentOrigin = exactHttpsOrigin(options.expectedCurrentOrigin);
  if (!targetOrigin || !expectedCurrentOrigin || targetOrigin === expectedCurrentOrigin) {
    throw codedError("CONFIG_INVALID", "Cloudflare current and target origins are invalid");
  }

  const inspectOptions = {
    ...options,
    allowedCurrentOrigins: [expectedCurrentOrigin]
  };
  const before = await inspectCloudflareRedirect(inspectOptions);
  const beforeBody = before.ruleBody;
  const desiredBody = rulePatchBody(before.rule, targetOrigin);

  const preflight = await inspectCloudflareRedirect(inspectOptions);
  if (
    preflight.rulesetVersion !== before.rulesetVersion ||
    stableJson(preflight.ruleBody) !== stableJson(beforeBody)
  ) {
    throw codedError("CF_CONCURRENT_CHANGE", "Cloudflare rule changed during preflight; mutation refused");
  }

  if (typeof options.beforePatch === "function") await options.beforePatch();
  await cloudflareJson(options.fetchImpl || global.fetch, options.token, "PATCH", before.ruleUrl, desiredBody);
  let after = null;
  try {
    after = await inspectCloudflareRedirect({
      ...options,
      allowedCurrentOrigins: [targetOrigin]
    });
  } catch {
    // The CAS-like rollback below decides whether it is still safe to restore.
  }

  let postMutationValidationError = null;
  if (after && stableJson(after.ruleBody) === stableJson(desiredBody)) {
    try {
      if (typeof options.afterUpdate === "function") await options.afterUpdate();
      return {
        changed: true,
        ruleId: before.metadata.ruleId,
        targetOrigin,
        beforeBody,
        desiredBody
      };
    } catch (error) {
      postMutationValidationError = error;
    }
  }

  let current;
  try {
    current = await inspectCloudflareRedirect({
      ...options,
      allowedCurrentOrigins: [expectedCurrentOrigin, targetOrigin]
    });
  } catch (error) {
    throw codedError(
      "CF_UPDATE_UNCERTAIN",
      "Cloudflare validation failed and rollback was skipped because current rule ownership could not be proven",
      error
    );
  }

  if (stableJson(current.ruleBody) === stableJson(beforeBody)) {
    throw codedError("CF_UPDATE_ROLLED_BACK", "Cloudflare update did not persist; original rule is confirmed");
  }
  if (stableJson(current.ruleBody) !== stableJson(desiredBody)) {
    throw codedError(
      "CF_CONCURRENT_CHANGE",
      "Cloudflare rule changed concurrently; rollback refused to avoid overwriting an operator change"
    );
  }

  await cloudflareJson(options.fetchImpl || global.fetch, options.token, "PATCH", current.ruleUrl, beforeBody);
  const rollback = await inspectCloudflareRedirect({
    ...options,
    allowedCurrentOrigins: [expectedCurrentOrigin]
  });
  if (stableJson(rollback.ruleBody) !== stableJson(beforeBody)) {
    throw codedError("CF_UPDATE_UNCERTAIN", "Cloudflare rollback could not be confirmed");
  }
  if (postMutationValidationError) throw postMutationValidationError;
  throw codedError("CF_UPDATE_ROLLED_BACK", "Cloudflare redirect validation failed; CAS-like rollback confirmed");
}

async function loadSecretFile(filePath, options = {}) {
  if (!path.isAbsolute(String(filePath || ""))) {
    throw codedError("CONFIG_INVALID", `${options.label || "secret"} path must be absolute`);
  }
  const source = await readTrustedFile(filePath, {
    maxBytes: SECRET_MAX_BYTES,
    ownerUid: options.ownerUid,
    requirePrivate: true,
    errorCode: "CONFIG_INVALID",
    label: options.label || "secret"
  });
  const secret = source.trim();
  if (secret.length < 20 || secret.length > SECRET_MAX_BYTES || /[\r\n]/.test(secret)) {
    throw codedError("CONFIG_INVALID", `${options.label || "secret"} value is invalid`);
  }
  return secret;
}

function assertRuntimeUser(expected = process.env.DOMAIN_GATEWAY_EXPECTED_OS_USER || "vipgateway") {
  const current = os.userInfo().username;
  if (current !== expected) {
    throw codedError("CONFIG_INVALID", `domain gateway must run as OS user ${expected}, not ${current}`);
  }
  return current;
}

module.exports = {
  ACTIVATION_ATTESTATION_MAX_AGE_MS,
  CLOUDFLARE_API_ROOT,
  COOLDOWN_MS,
  FAILURE_THRESHOLD,
  LOCK_STALE_MS,
  MAX_FAILOVER_MS,
  EXTERNAL_SNAPSHOT_MAX_AGE_MS,
  PROBE_TIMEOUT_MS,
  SUCCESS_THRESHOLD,
  acquireFileLock,
  advanceState,
  assertStandbyActivationAttestation,
  assertRuntimeUser,
  buildRedirectLocation,
  commitSwitch,
  createPendingJournal,
  evaluateTarget,
  evaluateTargetsWithExternalProbe,
  exactHttpsOrigin,
  exactHttpsUrl,
  exactLoopbackReadinessUrl,
  externalProbeDisposition,
  externalProbeRecord,
  initialState,
  inspectCloudflareRedirect,
  isPublicIp,
  loadSecretFile,
  loadTargetsConfig,
  probeLocalReadiness,
  probeEvidence,
  readExternalProbeSnapshot,
  readPendingJournal,
  readState,
  rebaseStateForConfig,
  recordExternalProbe,
  removeFileDurable,
  stableJson,
  updateCloudflareRedirect,
  validateCloudflareMetadata,
  validateActivationAttestation,
  validateExternalProbeSnapshot,
  validatePendingJournal,
  validateState,
  validateTargetsConfig,
  withFileLock,
  writeJsonAtomic,
  writePendingJournalAtomic,
  writeStateAtomic
};
