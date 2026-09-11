"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ACTIVATION_ATTESTATION_MAX_AGE_MS,
  CLOUDFLARE_API_ROOT,
  FAILURE_THRESHOLD,
  MAX_FAILOVER_MS,
  SUCCESS_THRESHOLD,
  acquireFileLock,
  advanceState,
  buildRedirectLocation,
  commitSwitch,
  createPendingJournal,
  evaluateTargetsWithExternalProbe,
  externalProbeDisposition,
  initialState,
  isPublicIp,
  loadSecretFile,
  loadTargetsConfig,
  probeEvidence,
  readExternalProbeSnapshot,
  readState,
  stableJson,
  updateCloudflareRedirect,
  validateExternalProbeSnapshot,
  validateTargetsConfig,
  writePendingJournalAtomic,
  writeStateAtomic
} = require("../core");
const { createGatewayServer } = require("../server");
const {
  isPermanentMonitorError,
  runCycle,
  writeMonitorHealth
} = require("../monitor");
const { payloadHash: ingestPayloadHash } = require("../../turkey-readiness-probe/ingest");

const CF_ZONE_ID = "a".repeat(32);
const CF_RULESET_ID = "b".repeat(32);
const CF_RULE_ID = "c".repeat(32);
const CF_ZONE_NAME = "vip-gece.com";
const CF_RULE_REF = "vip-gece-canonical-redirect-v1";
const CF_RULE_EXPRESSION = "(http.host in {\"vip-gece.com\" \"www.vip-gece.com\"})";

function utcSecond(nowMs = Date.now()) {
  return new Date(Math.floor(nowMs / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

function activationAttestation(options = {}) {
  const content = {
    manifest_sha256: options.manifestSha256 || "f".repeat(64),
    profile_count: options.profileCount || 27,
    sitemap_count: options.sitemapCount || 267,
    ga4_id: options.ga4Id || "G-MGGWKPN1KH"
  };
  return {
    version: 1,
    target_id: "vip-gece-online",
    primary_target_id: "vip-gece-site",
    observed_at: options.observedAt || utcSecond(),
    expected_nameservers: [
      "brett.ns.cloudflare.com",
      "perla.ns.cloudflare.com"
    ],
    observed_nameservers: [
      "brett.ns.cloudflare.com",
      "perla.ns.cloudflare.com"
    ],
    zone_status: "active",
    tls_mode: "strict",
    canonical_primary: "https://vip-gece.site",
    primary: { ...content },
    target: { ...content }
  };
}

function rawConfig(backupEnabled = true, options = {}) {
  return {
    version: 1,
    primary_target_id: "vip-gece-site",
    targets: [
      {
        id: "vip-gece-site",
        origin: "https://vip-gece.site",
        enabled: true,
        role: "primary",
        evidence: [
          { source: "site-home", url: "https://vip-gece.site/", statuses: [200] },
          { source: "site-ready", url: "https://vip-gece.site/api/ready", statuses: [200] }
        ]
      },
      {
        id: "vip-gece-online",
        origin: "https://vip-gece.online",
        enabled: backupEnabled,
        role: "standby",
        evidence: [
          { source: "online-home", url: "https://vip-gece.online/", statuses: [200] },
          { source: "online-ready", url: "https://vip-gece.online/api/ready", statuses: [200] }
        ],
        ...(backupEnabled
          ? { activation_attestation: activationAttestation(options.attestation) }
          : {})
      }
    ]
  };
}

function externalObservation(target, overrides = {}) {
  const status = overrides.http_status ?? 200;
  const transportOk = status === 200 || status === 403;
  const contractOk = overrides.contract_ok ?? status === 200;
  const edgeReachable = overrides.edge_reachable ?? transportOk;
  let resultCode = "http_status_unaccepted";
  if (edgeReachable && status === 200 && contractOk) resultCode = "edge_reachable_ready";
  else if (edgeReachable && status === 403) resultCode = "edge_reachable_http_403";
  else if (edgeReachable && status === 200) resultCode = "ready_contract_invalid";
  else if (!(overrides.tls_verified ?? transportOk) ||
    !(overrides.hostname_verified ?? transportOk)) resultCode = "tls_or_transport_failed";
  else if ((overrides.redirect_followed ?? false) ||
    !(overrides.server_header_match ?? transportOk) ||
    !(overrides.cf_ray_present ?? transportOk)) resultCode = "edge_identity_failed";

  return {
    target_id: target.id,
    url: `${target.origin}/api/ready`,
    http_status: status,
    tls_verified: overrides.tls_verified ?? transportOk,
    hostname_verified: overrides.hostname_verified ?? transportOk,
    redirect_followed: overrides.redirect_followed ?? false,
    expected_server: "cloudflare",
    server_header_match: overrides.server_header_match ?? transportOk,
    cf_ray_present: overrides.cf_ray_present ?? transportOk,
    contract_ok: contractOk,
    edge_reachable: edgeReachable,
    duration_ms: overrides.duration_ms ?? 50,
    result_code: overrides.result_code || resultCode
  };
}

function externalSnapshot(config, options = {}) {
  const observedAt = options.observedAt || "2026-07-24T20:00:00Z";
  const receivedAt = options.receivedAt || observedAt;
  const observations = config.targets
    .filter((target) => target.enabled)
    .map((target) => externalObservation(target, options.byTarget?.[target.id] || {}));
  const report = {
    schema_version: 1,
    config_version: options.configVersion || 1,
    probe_id: options.probeId || "tr-mac-01",
    nonce: options.nonce || "a".repeat(32),
    observed_at: observedAt,
    observations
  };
  return {
    ...report,
    received_at: receivedAt,
    payload_sha256: crypto.createHash("sha256").update(stableJson(report)).digest("hex")
  };
}

function cfOptions(overrides = {}) {
  return {
    applyArmed: true,
    cloudflareToken: "test-token-that-is-long-enough",
    cloudflareZoneId: CF_ZONE_ID,
    cloudflareRulesetId: CF_RULESET_ID,
    cloudflareRuleId: CF_RULE_ID,
    cloudflareExpectedZoneName: CF_ZONE_NAME,
    cloudflareExpectedRuleRef: CF_RULE_REF,
    cloudflareExpectedRuleExpression: CF_RULE_EXPRESSION,
    ...overrides
  };
}

function cfCoreOptions(fetchImpl, overrides = {}) {
  return {
    fetchImpl,
    token: "test-token-that-is-long-enough",
    zoneId: CF_ZONE_ID,
    rulesetId: CF_RULESET_ID,
    ruleId: CF_RULE_ID,
    expectedZoneName: CF_ZONE_NAME,
    expectedRuleRef: CF_RULE_REF,
    expectedRuleExpression: CF_RULE_EXPRESSION,
    ...overrides
  };
}

function cfRule(origin, overrides = {}) {
  return {
    id: CF_RULE_ID,
    ref: CF_RULE_REF,
    action: "redirect",
    action_parameters: {
      from_value: {
        status_code: 301,
        target_url: {
          expression: `concat("${origin}", http.request.uri.path)`
        },
        preserve_query_string: true
      }
    },
    expression: CF_RULE_EXPRESSION,
    description: "VIP Gece canonical redirect",
    enabled: true,
    ...overrides
  };
}

function cfRuleset(rule, version = "1") {
  return {
    phase: "http_request_dynamic_redirect",
    version,
    rules: [rule]
  };
}

function sequenceFetch(entries, calls = []) {
  return async (url, options) => {
    calls.push({
      url,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : null
    });
    const entry = entries.shift();
    if (!entry) throw new Error(`unexpected Cloudflare call ${options.method} ${url}`);
    const status = entry.httpStatus || 200;
    const success = entry.success ?? (status >= 200 && status < 300);
    return new Response(JSON.stringify({
      success,
      result: entry.result
    }), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  };
}

function request(server, requestPath) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      method: "GET"
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("gateway preserves path/query without becoming an open redirect", () => {
  assert.equal(
    buildRedirectLocation(
      "https://vip-gece.site",
      "/istanbul-escort?utm_source=old&next=https%3A%2F%2Fevil.example"
    ),
    "https://vip-gece.site/istanbul-escort?utm_source=old&next=https%3A%2F%2Fevil.example"
  );
  assert.equal(buildRedirectLocation("https://vip-gece.site", "//evil.example/path"), "");
  assert.equal(buildRedirectLocation("https://vip-gece.site", "/\\evil.example/path"), "");
  assert.equal(buildRedirectLocation("https://vip-gece.site", "/%0d%0aLocation:%20https://evil.example"), "");
});

test("target config is bound to the two approved VIP Gece origins", () => {
  const unknownTarget = rawConfig();
  unknownTarget.targets[1].id = "other-target";
  assert.throws(
    () => validateTargetsConfig(unknownTarget),
    (error) => error.code === "CONFIG_INVALID"
  );

  const mismatchedOrigin = rawConfig();
  mismatchedOrigin.targets[1].origin = "https://example.invalid";
  assert.throws(
    () => validateTargetsConfig(mismatchedOrigin),
    (error) => error.code === "CONFIG_INVALID"
  );

  const crossOriginEvidence = rawConfig();
  crossOriginEvidence.targets[1].evidence[0].url = "https://vip-gece.site/";
  assert.throws(
    () => validateTargetsConfig(crossOriginEvidence),
    (error) => error.code === "CONFIG_INVALID"
  );
});

test("enabled standby requires a fresh exact generation-bound activation attestation", () => {
  const nowMs = Date.parse("2026-07-25T10:00:00Z");
  const validRaw = rawConfig(true, {
    attestation: { observedAt: "2026-07-25T10:00:00Z" }
  });
  const valid = validateTargetsConfig(validRaw, { nowMs });
  assert.equal(
    valid.normalized.targets[1].activation_attestation.target_id,
    "vip-gece-online"
  );
  assert.equal(
    valid.targetById.get("vip-gece-online").activationAttestation.observed_at,
    "2026-07-25T10:00:00Z"
  );
  assert.equal(
    "observed_at" in valid.normalized.targets[1].activation_attestation,
    true
  );

  const missing = structuredClone(validRaw);
  delete missing.targets[1].activation_attestation;
  assert.throws(
    () => validateTargetsConfig(missing, { nowMs }),
    (error) => error.code === "CONFIG_INVALID"
  );
  const disabledWithAttestation = rawConfig(false);
  disabledWithAttestation.targets[1].activation_attestation =
    activationAttestation({ observedAt: "2026-07-25T10:00:00Z" });
  assert.throws(
    () => validateTargetsConfig(disabledWithAttestation, { nowMs }),
    (error) => error.code === "CONFIG_INVALID"
  );

  const refreshed = rawConfig(true, {
    attestation: { observedAt: "2026-07-25T10:00:01Z" }
  });
  assert.notEqual(
    validateTargetsConfig(refreshed, { nowMs: nowMs + 1000 }).configHash,
    valid.configHash
  );

  const changedManifest = structuredClone(validRaw);
  changedManifest.targets[1].activation_attestation.primary.manifest_sha256 = "e".repeat(64);
  changedManifest.targets[1].activation_attestation.target.manifest_sha256 = "e".repeat(64);
  assert.notEqual(
    validateTargetsConfig(changedManifest, { nowMs }).configHash,
    valid.configHash
  );

  const stale = rawConfig(true, {
    attestation: {
      observedAt: utcSecond(nowMs - ACTIVATION_ATTESTATION_MAX_AGE_MS - 1000)
    }
  });
  assert.throws(
    () => validateTargetsConfig(stale, { nowMs }),
    (error) => error.code === "ACTIVATION_ATTESTATION_STALE" &&
      /stale/.test(error.message)
  );
  const passive = validateTargetsConfig(stale, {
    nowMs,
    requireFreshness: false
  });
  assert.equal(passive.targetById.get("vip-gece-online").enabled, true);
  assert.notEqual(passive.configHash, valid.configHash);

  const future = rawConfig(true, {
    attestation: { observedAt: utcSecond(nowMs + 31 * 1000) }
  });
  assert.throws(
    () => validateTargetsConfig(future, { nowMs }),
    (error) => error.code === "CONFIG_INVALID"
  );
  assert.throws(
    () => validateTargetsConfig(future, {
      nowMs,
      requireFreshness: false
    }),
    (error) => error.code === "CONFIG_INVALID"
  );

  const passiveInvariantMismatch = structuredClone(stale);
  passiveInvariantMismatch.targets[1].activation_attestation.zone_status = "pending";
  assert.throws(
    () => validateTargetsConfig(passiveInvariantMismatch, {
      nowMs,
      requireFreshness: false
    }),
    (error) => error.code === "CONFIG_INVALID"
  );

  const invalidCases = [
    (attestation) => { attestation.version = 2; },
    (attestation) => { attestation.target_id = "vip-gece-site"; },
    (attestation) => { attestation.primary_target_id = "vip-gece-online"; },
    (attestation) => { attestation.expected_nameservers.push("extra.ns.cloudflare.com"); },
    (attestation) => { attestation.observed_nameservers[0] = "other.ns.cloudflare.com"; },
    (attestation) => { attestation.zone_status = "pending"; },
    (attestation) => { attestation.tls_mode = "full"; },
    (attestation) => { attestation.canonical_primary = "https://vip-gece.online"; },
    (attestation) => { attestation.target.manifest_sha256 = "0".repeat(64); },
    (attestation) => { attestation.target.profile_count += 1; },
    (attestation) => { attestation.target.sitemap_count += 1; },
    (attestation) => { attestation.target.ga4_id = "G-DIFFERENT1"; }
  ];
  for (const mutate of invalidCases) {
    const candidate = structuredClone(validRaw);
    mutate(candidate.targets[1].activation_attestation);
    assert.throws(
      () => validateTargetsConfig(candidate, { nowMs }),
      (error) => error.code === "CONFIG_INVALID"
    );
  }
});

test("gateway fails closed on poisoned state and while a switch journal exists", async (t) => {
  const config = validateTargetsConfig(rawConfig());
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-server-"));
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  const state = initialState(config);
  await writeStateAtomic(stateFile, state, config);

  const server = createGatewayServer(config, stateFile, journalFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  const redirected = await request(server, "/profil/ada-vip?utm_source=legacy");
  assert.equal(redirected.status, 301);
  assert.equal(redirected.headers.location, "https://vip-gece.site/profil/ada-vip?utm_source=legacy");

  const committed = commitSwitch(
    state,
    { type: "switch", from: "vip-gece-site", to: "vip-gece-online" },
    config
  );
  const journal = createPendingJournal(
    config,
    state,
    committed,
    { type: "switch", from: "vip-gece-site", to: "vip-gece-online" }
  );
  await writePendingJournalAtomic(journalFile, journal, config);
  const pending = await request(server, "/");
  assert.equal(pending.status, 503);

  await fs.unlink(journalFile);
  const poisoned = { ...state, active_target_id: "https://evil.example" };
  await fs.writeFile(stateFile, JSON.stringify(poisoned), { mode: 0o600 });
  const unavailable = await request(server, "/");
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.headers["cache-control"], /no-store/);
  assert.equal(unavailable.headers["x-robots-tag"], undefined);
});

test("gateway hot reloads targets and accepts only matching config_hash state", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-hot-config-"));
  const configFile = path.join(directory, "targets.json");
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  await fs.writeFile(configFile, `${JSON.stringify(rawConfig(false))}\n`, { mode: 0o600 });
  const initialConfig = await loadTargetsConfig(configFile);
  await writeStateAtomic(stateFile, initialState(initialConfig), initialConfig);

  const provider = () => loadTargetsConfig(configFile);
  const server = createGatewayServer(provider, stateFile, journalFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  const before = await request(server, "/x");
  assert.equal(before.headers.location, "https://vip-gece.site/x");

  await fs.writeFile(configFile, `${JSON.stringify(rawConfig(true))}\n`, { mode: 0o600 });
  const enabledConfig = await loadTargetsConfig(configFile);
  const switched = commitSwitch(
    initialState(enabledConfig),
    { type: "switch", from: "vip-gece-site", to: "vip-gece-online" },
    enabledConfig
  );
  await writeStateAtomic(stateFile, switched, enabledConfig);
  const after = await request(server, "/x");
  assert.equal(after.status, 301);
  assert.equal(after.headers.location, "https://vip-gece.online/x");
  assert.notEqual(initialConfig.configHash, enabledConfig.configHash);
});

test("expired standby lease cannot take down the active redirect", async (t) => {
  const base = Date.parse("2026-07-25T10:00:00Z");
  let nowMs = base;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-expired-lease-"));
  const configFile = path.join(directory, "targets.json");
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  const raw = rawConfig(true, {
    attestation: { observedAt: utcSecond(base) }
  });
  await fs.writeFile(configFile, `${JSON.stringify(raw)}\n`, { mode: 0o600 });
  const config = await loadTargetsConfig(configFile, { nowMs: base });
  await writeStateAtomic(stateFile, initialState(config, base), config);

  const provider = () => loadTargetsConfig(configFile, {
    nowMs,
    requireFreshness: false
  });
  const server = createGatewayServer(provider, stateFile, journalFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  nowMs = base + ACTIVATION_ATTESTATION_MAX_AGE_MS + 1000;
  const primary = await request(server, "/primary");
  assert.equal(primary.status, 301);
  assert.equal(primary.headers.location, "https://vip-gece.site/primary");

  const switched = commitSwitch(
    initialState(config, base),
    { type: "switch", from: "vip-gece-site", to: "vip-gece-online" },
    config,
    base + 1000
  );
  await writeStateAtomic(stateFile, switched, config);
  const standby = await request(server, "/standby");
  assert.equal(standby.status, 301);
  assert.equal(standby.headers.location, "https://vip-gece.online/standby");

  const future = rawConfig(true, {
    attestation: { observedAt: utcSecond(nowMs + 31 * 1000) }
  });
  await fs.writeFile(configFile, `${JSON.stringify(future)}\n`, { mode: 0o600 });
  assert.equal((await request(server, "/future")).status, 503);

  const invalid = structuredClone(raw);
  invalid.targets[1].activation_attestation.target.manifest_sha256 = "e".repeat(64);
  await fs.writeFile(configFile, `${JSON.stringify(invalid)}\n`, { mode: 0o600 });
  assert.equal((await request(server, "/invalid")).status, 503);
});

test("missing state remains fail-closed until the primary has a verified observation", async (t) => {
  const config = validateTargetsConfig(rawConfig(false));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-bootstrap-"));
  const stateFile = path.join(directory, "state.json");
  const lockFile = path.join(directory, "monitor.lock");
  const journalFile = path.join(directory, "pending.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const unhealthy = await runCycle({
    config,
    mode: "observe",
    stateFile,
    lockFile,
    journalFile,
    evaluateTarget: async () => ({ healthy: false, evidenceCount: 0, evidence: [] })
  });
  assert.equal(unhealthy.reason, "initial_primary_unverified");
  assert.equal(unhealthy.activeTargetId, null);
  await assert.rejects(fs.access(stateFile));

  const server = createGatewayServer(config, stateFile, journalFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal((await request(server, "/")).status, 503);

  const healthy = await runCycle({
    config,
    mode: "observe",
    stateFile,
    lockFile,
    journalFile,
    evaluateTarget: async (target) => ({
      healthy: target.id === config.primaryTargetId,
      evidenceCount: target.id === config.primaryTargetId ? 2 : 0,
      evidence: []
    })
  });
  assert.equal(healthy.reason, "initial_primary_verified");
  assert.equal((await request(server, "/")).status, 301);
});

test("monitor refuses to write state from a targets config changed mid-cycle", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-config-race-"));
  const configFile = path.join(directory, "targets.json");
  const stateFile = path.join(directory, "state.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(configFile, `${JSON.stringify(rawConfig(false))}\n`, { mode: 0o600 });
  let changed = false;

  await assert.rejects(
    runCycle({
      mode: "observe",
      targetsFile: configFile,
      stateFile,
      lockFile: path.join(directory, "monitor.lock"),
      journalFile: path.join(directory, "pending.json"),
      evaluateTarget: async () => {
        if (!changed) {
          changed = true;
          await fs.writeFile(configFile, `${JSON.stringify(rawConfig(true))}\n`, { mode: 0o600 });
        }
        return { healthy: true, evidenceCount: 2, evidence: [] };
      }
    }),
    (error) => error.code === "CONFIG_CHANGED"
  );
  await assert.rejects(fs.access(stateFile));
});

test("apply mode retains its journal when targets change during the updater", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-apply-config-race-"));
  const configFile = path.join(directory, "targets.json");
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  const initialRaw = rawConfig(true);
  await fs.writeFile(configFile, `${JSON.stringify(initialRaw)}\n`, { mode: 0o600 });
  const config = await loadTargetsConfig(configFile);
  const state = initialState(config);
  state.counters["vip-gece-site"].consecutive_failures = 2;
  state.counters["vip-gece-online"].consecutive_successes = 2;
  await writeStateAtomic(stateFile, state, config);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    runCycle({
      mode: "apply",
      targetsFile: configFile,
      stateFile,
      journalFile,
      lockFile: path.join(directory, "monitor.lock"),
      evaluateTarget: async (target) => ({
        healthy: target.id === "vip-gece-online",
        evidenceCount: target.id === "vip-gece-online" ? 2 : 0,
        evidence: []
      }),
      cloudflareUpdate: async () => {
        await fs.writeFile(configFile, `${JSON.stringify(rawConfig(false))}\n`, { mode: 0o600 });
      },
      ...cfOptions()
    }),
    (error) => error.code === "CONFIG_CHANGED"
  );
  await fs.access(journalFile);
  assert.equal((await readState(stateFile, config)).active_target_id, "vip-gece-site");
});

test("apply mode rejects an attestation renewal during the updater", async (t) => {
  const base = Date.now();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-attestation-change-"));
  const configFile = path.join(directory, "targets.json");
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  const initialRaw = rawConfig(true, {
    attestation: { observedAt: utcSecond(base) }
  });
  await fs.writeFile(configFile, `${JSON.stringify(initialRaw)}\n`, { mode: 0o600 });
  const config = await loadTargetsConfig(configFile);
  const state = initialState(config, base);
  state.counters["vip-gece-site"].consecutive_failures = 2;
  state.counters["vip-gece-online"].consecutive_successes = 2;
  await writeStateAtomic(stateFile, state, config);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    runCycle({
      mode: "apply",
      targetsFile: configFile,
      stateFile,
      journalFile,
      lockFile: path.join(directory, "monitor.lock"),
      nowMs: base,
      currentTimeMs: () => base,
      evaluateTarget: async (target) => ({
        healthy: target.id === "vip-gece-online",
        evidenceCount: target.id === "vip-gece-online" ? 2 : 0,
        evidence: []
      }),
      cloudflareUpdate: async () => {
        const renewed = rawConfig(true, {
          attestation: { observedAt: utcSecond(base + 1000) }
        });
        await fs.writeFile(configFile, `${JSON.stringify(renewed)}\n`, { mode: 0o600 });
      },
      ...cfOptions()
    }),
    (error) => error.code === "CONFIG_CHANGED"
  );
  await fs.access(journalFile);
  assert.equal((await readState(stateFile, config)).active_target_id, "vip-gece-site");
});

test("probe enforces exact HTTPS allowlist and blocks private DNS answers", async () => {
  const config = validateTargetsConfig(rawConfig());
  const check = config.targetById.get("vip-gece-site").evidence[0];

  await assert.rejects(
    probeEvidence(check, config.allowedEvidenceUrls, {
      resolver: async () => [{ address: "127.0.0.1", family: 4 }]
    }),
    /non-public/
  );
  await assert.rejects(
    probeEvidence(
      { ...check, url: "https://evil.example/" },
      config.allowedEvidenceUrls,
      { resolver: async () => [{ address: "93.184.216.34", family: 4 }] }
    ),
    /allowlist/
  );
  assert.equal(isPublicIp("10.0.0.1"), false);
  assert.equal(isPublicIp("169.254.169.254"), false);
  assert.equal(isPublicIp("93.184.216.34"), true);
});

test("probe applies a total DNS deadline", async () => {
  const config = validateTargetsConfig(rawConfig());
  const check = config.targetById.get("vip-gece-site").evidence[0];
  const startedAt = Date.now();
  await assert.rejects(
    probeEvidence(check, config.allowedEvidenceUrls, {
      resolver: () => new Promise(() => {}),
      timeoutMs: 20
    }),
    (error) => error.code === "PROBE_TIMEOUT"
  );
  assert.ok(Date.now() - startedAt < 250);
});

test("probe handles response errors and slow-drip responses without crashing or hanging", async () => {
  const config = validateTargetsConfig(rawConfig());
  const check = config.targetById.get("vip-gece-site").evidence[0];
  const resolver = async () => [{ address: "93.184.216.34", family: 4 }];

  function errorRequester(_url, _options, callback) {
    const requestEmitter = new EventEmitter();
    requestEmitter.destroyed = false;
    requestEmitter.setTimeout = () => {};
    requestEmitter.destroy = () => {
      requestEmitter.destroyed = true;
    };
    requestEmitter.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.complete = false;
      response.destroyed = false;
      response.destroy = () => {
        response.destroyed = true;
      };
      callback(response);
      setImmediate(() => response.emit("error", new Error("premature response failure")));
    };
    return requestEmitter;
  }

  await assert.rejects(
    probeEvidence(check, config.allowedEvidenceUrls, {
      resolver,
      requester: errorRequester,
      timeoutMs: 100
    }),
    (error) => error.code === "PROBE_RESPONSE_ERROR"
  );

  function slowRequester(_url, _options, callback) {
    const requestEmitter = new EventEmitter();
    requestEmitter.destroyed = false;
    requestEmitter.setTimeout = () => {};
    requestEmitter.destroy = () => {
      requestEmitter.destroyed = true;
    };
    requestEmitter.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.complete = false;
      response.destroyed = false;
      const interval = setInterval(() => response.emit("data", Buffer.from(".")), 5);
      response.destroy = () => {
        response.destroyed = true;
        clearInterval(interval);
      };
      callback(response);
    };
    return requestEmitter;
  }

  await assert.rejects(
    probeEvidence(check, config.allowedEvidenceUrls, {
      resolver,
      requester: slowRequester,
      timeoutMs: 25
    }),
    (error) => error.code === "PROBE_TIMEOUT"
  );
});

test("Türkiye snapshot validation binds identity, target set, payload hash, and receipt freshness", () => {
  const config = validateTargetsConfig(rawConfig(false));
  const valid = externalSnapshot(config);
  const options = {
    probeId: "tr-mac-01",
    configVersion: 1,
    nowMs: Date.parse("2026-07-24T20:01:00Z")
  };
  assert.equal(validateExternalProbeSnapshot(valid, config, options), valid);
  assert.equal(valid.payload_sha256, ingestPayloadHash({
    schema_version: valid.schema_version,
    config_version: valid.config_version,
    probe_id: valid.probe_id,
    nonce: valid.nonce,
    observed_at: valid.observed_at,
    observations: valid.observations
  }));

  const tampered = structuredClone(valid);
  tampered.observations[0].url = "https://evil.example/api/ready";
  assert.throws(
    () => validateExternalProbeSnapshot(tampered, config, options),
    (error) => error.code === "EXTERNAL_PROBE_INVALID"
  );

  const stale = externalSnapshot(config, {
    observedAt: "2026-07-24T19:40:00Z",
    receivedAt: "2026-07-24T19:42:00Z",
    nonce: "b".repeat(32)
  });
  assert.throws(
    () => validateExternalProbeSnapshot(stale, config, options),
    (error) => error.code === "EXTERNAL_PROBE_STALE"
  );
});

test("Türkiye snapshot reader pins owner and rejects writable files and symlinks", async (t) => {
  const config = validateTargetsConfig(rawConfig(false));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-snapshot-reader-"));
  const snapshotFile = path.join(directory, "latest.json");
  const symlinkFile = path.join(directory, "linked.json");
  const snapshot = externalSnapshot(config);
  const options = {
    probeId: "tr-mac-01",
    configVersion: 1,
    ownerUid: process.getuid(),
    nowMs: Date.parse("2026-07-24T20:01:00Z")
  };
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await fs.writeFile(snapshotFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o640 });
  assert.equal(
    (await readExternalProbeSnapshot(snapshotFile, config, options)).nonce,
    snapshot.nonce
  );

  await fs.chmod(snapshotFile, 0o660);
  await assert.rejects(
    readExternalProbeSnapshot(snapshotFile, config, options),
    (error) => error.code === "EXTERNAL_PROBE_INVALID"
  );
  await fs.chmod(snapshotFile, 0o640);
  await fs.symlink(snapshotFile, symlinkFile);
  await assert.rejects(
    readExternalProbeSnapshot(symlinkFile, config, options),
    (error) => error.code === "EXTERNAL_PROBE_INVALID"
  );
});

test("Cloudflare 403 is edge-only and cannot advance either target-health counter", async () => {
  const config = validateTargetsConfig(rawConfig(false));
  const forbiddenAtEdge = externalSnapshot(config, {
    byTarget: {
      "vip-gece-site": {
        http_status: 403,
        contract_ok: false,
        result_code: "edge_reachable_http_403"
      }
    }
  });
  const edgeOnly = await evaluateTargetsWithExternalProbe(config, forbiddenAtEdge, {
    localReadinessUrl: "http://127.0.0.1:3003/api/ready",
    localReadinessProbe: async () => ({ source: "local-origin", ok: true, status: 200 })
  });
  assert.equal(edgeOnly["vip-gece-site"].healthy, false);
  assert.equal(edgeOnly["vip-gece-site"].indeterminate, true);
  assert.equal(edgeOnly["vip-gece-site"].evidenceCount, 1);
  const unchanged = advanceState(initialState(config), config, edgeOnly);
  assert.equal(unchanged.reason, "external_evidence_indeterminate");
  assert.deepEqual(unchanged.state.counters["vip-gece-site"], {
    consecutive_failures: 0,
    consecutive_successes: 0
  });

  const ready = externalSnapshot(config, { nonce: "c".repeat(32) });
  const healthy = await evaluateTargetsWithExternalProbe(config, ready, {
    localReadinessUrl: "http://127.0.0.1:3003/api/ready",
    localReadinessProbe: async () => ({ source: "local-origin", ok: true, status: 200 })
  });
  assert.equal(healthy["vip-gece-site"].healthy, true);
  assert.equal(healthy["vip-gece-site"].indeterminate, false);
  assert.equal(healthy["vip-gece-site"].evidenceCount, 2);

  const invalidPublicContract = externalSnapshot(config, {
    nonce: "b".repeat(32),
    byTarget: {
      "vip-gece-site": {
        http_status: 200,
        contract_ok: false,
        result_code: "ready_contract_invalid"
      }
    }
  });
  const unhealthy = await evaluateTargetsWithExternalProbe(config, invalidPublicContract, {
    localReadinessUrl: "http://127.0.0.1:3003/api/ready",
    localReadinessProbe: async () => ({ source: "local-origin", ok: true, status: 200 })
  });
  assert.equal(unhealthy["vip-gece-site"].healthy, false);
  assert.equal(unhealthy["vip-gece-site"].evidenceCount, 1);
});

test("standby can share the single loopback result only while equal-content attestation is fresh", async () => {
  const nowMs = Date.parse("2026-07-25T10:00:00Z");
  const config = validateTargetsConfig(rawConfig(true, {
    attestation: { observedAt: "2026-07-25T10:00:00Z" }
  }), { nowMs });
  const snapshot = externalSnapshot(config, {
    observedAt: "2026-07-25T10:00:00Z"
  });
  let localCalls = 0;
  const options = {
    nowMs,
    localReadinessUrl: "http://127.0.0.1:3003/api/ready",
    localReadinessProbe: async () => {
      localCalls += 1;
      return { source: "local-origin", ok: true, status: 200 };
    }
  };

  const observations = await evaluateTargetsWithExternalProbe(config, snapshot, options);
  assert.equal(observations["vip-gece-site"].healthy, true);
  assert.equal(observations["vip-gece-online"].healthy, true);
  assert.equal(localCalls, 1);

  const stale = await evaluateTargetsWithExternalProbe(config, snapshot, {
    ...options,
    nowMs: nowMs + ACTIVATION_ATTESTATION_MAX_AGE_MS + 1
  });
  assert.equal(stale["vip-gece-site"].healthy, true);
  assert.equal(stale["vip-gece-online"].healthy, false);
  assert.equal(stale["vip-gece-online"].indeterminate, true);
  assert.equal(stale["vip-gece-online"].reason, "activation_attestation_stale");
  assert.equal(stale["vip-gece-online"].evidenceCount, 1);
  assert.equal(localCalls, 2);
});

test("observe mode keeps running while a stale standby lease is ineligible", async (t) => {
  const base = Date.parse("2026-07-25T10:00:00Z");
  const nowMs = base + ACTIVATION_ATTESTATION_MAX_AGE_MS + 1000;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-stale-observe-"));
  const configFile = path.join(directory, "targets.json");
  const stateFile = path.join(directory, "state.json");
  const raw = rawConfig(true, {
    attestation: { observedAt: utcSecond(base) }
  });
  await fs.writeFile(configFile, `${JSON.stringify(raw)}\n`, { mode: 0o600 });
  const freshConfig = validateTargetsConfig(raw, { nowMs: base });
  const state = initialState(freshConfig, base);
  state.counters["vip-gece-online"].consecutive_successes = 2;
  await writeStateAtomic(stateFile, state, freshConfig);
  const passiveConfig = validateTargetsConfig(raw, {
    nowMs,
    requireFreshness: false
  });
  const snapshot = externalSnapshot(passiveConfig, {
    observedAt: utcSecond(nowMs),
    receivedAt: utcSecond(nowMs)
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const result = await runCycle({
    mode: "observe",
    targetsFile: configFile,
    stateFile,
    journalFile: path.join(directory, "pending.json"),
    lockFile: path.join(directory, "monitor.lock"),
    externalProbeSnapshot: snapshot,
    externalProbeId: "tr-mac-01",
    externalProbeConfigVersion: 1,
    localReadinessUrl: "http://127.0.0.1:3003/api/ready",
    localReadinessProbe: async () => ({
      source: "local-origin",
      ok: true,
      status: 200
    }),
    nowMs,
    currentTimeMs: () => nowMs
  });

  assert.equal(result.activeTargetId, "vip-gece-site");
  assert.equal(result.decision, null);
  assert.equal(result.observations["vip-gece-online"].indeterminate, true);
  assert.equal(
    result.observations["vip-gece-online"].reason,
    "activation_attestation_stale"
  );
  const after = await readState(stateFile, passiveConfig);
  assert.equal(after.counters["vip-gece-site"].consecutive_successes, 1);
  assert.equal(after.counters["vip-gece-online"].consecutive_successes, 0);

  const switched = commitSwitch(
    after,
    { type: "switch", from: "vip-gece-site", to: "vip-gece-online" },
    passiveConfig,
    nowMs
  );
  await writeStateAtomic(stateFile, switched, passiveConfig);
  const nextMs = nowMs + 1000;
  const activeSnapshot = externalSnapshot(passiveConfig, {
    nonce: "b".repeat(32),
    observedAt: utcSecond(nextMs),
    receivedAt: utcSecond(nextMs)
  });
  const activeResult = await runCycle({
    mode: "observe",
    targetsFile: configFile,
    stateFile,
    journalFile: path.join(directory, "pending.json"),
    lockFile: path.join(directory, "monitor.lock"),
    externalProbeSnapshot: activeSnapshot,
    externalProbeId: "tr-mac-01",
    externalProbeConfigVersion: 1,
    localReadinessUrl: "http://127.0.0.1:3003/api/ready",
    localReadinessProbe: async () => ({
      source: "local-origin",
      ok: true,
      status: 200
    }),
    nowMs: nextMs,
    currentTimeMs: () => nextMs
  });
  assert.equal(activeResult.activeTargetId, "vip-gece-online");
  assert.equal(activeResult.decision, null);
  assert.equal(activeResult.reason, "active_external_evidence_indeterminate");
});

test("disabled targets never accumulate synthetic health counters", () => {
  const config = validateTargetsConfig(rawConfig(false));
  const state = initialState(config);
  state.counters["vip-gece-online"] = {
    consecutive_failures: FAILURE_THRESHOLD,
    consecutive_successes: SUCCESS_THRESHOLD
  };
  const result = advanceState(state, config, {
    "vip-gece-site": { healthy: true, evidenceCount: 2 },
    "vip-gece-online": { healthy: false, evidenceCount: 0 }
  });
  assert.deepEqual(result.state.counters["vip-gece-online"], {
    consecutive_failures: 0,
    consecutive_successes: 0
  });
});

test("an indeterminate active target can never trigger a switch from historical counters", async () => {
  const config = validateTargetsConfig(rawConfig());
  const snapshot = externalSnapshot(config, {
    byTarget: {
      "vip-gece-site": {
        http_status: 403,
        contract_ok: false,
        result_code: "edge_reachable_http_403"
      }
    }
  });
  const observations = await evaluateTargetsWithExternalProbe(config, snapshot, {
    localReadinessUrl: "http://127.0.0.1:3003/api/ready",
    localReadinessProbe: async () => ({ source: "local-origin", ok: true, status: 200 })
  });
  const state = initialState(config);
  state.counters["vip-gece-site"].consecutive_failures = 3;
  state.counters["vip-gece-online"].consecutive_successes = 2;

  const result = advanceState(state, config, observations);
  assert.equal(result.decision, null);
  assert.equal(result.reason, "active_external_evidence_indeterminate");
  assert.equal(result.state.counters["vip-gece-site"].consecutive_failures, 0);
  assert.equal(result.state.counters["vip-gece-online"].consecutive_successes, 3);
});

test("monitor consumes each fresh external nonce once and only distinct samples advance hysteresis", async (t) => {
  const base = Date.parse("2026-07-24T20:00:00Z");
  const config = validateTargetsConfig(rawConfig(true, {
    attestation: { observedAt: "2026-07-24T20:00:00Z" }
  }), { nowMs: base });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-external-probe-"));
  const stateFile = path.join(directory, "state.json");
  const common = {
    config,
    mode: "observe",
    stateFile,
    lockFile: path.join(directory, "monitor.lock"),
    journalFile: path.join(directory, "pending.json"),
    externalProbeId: "tr-mac-01",
    externalProbeConfigVersion: 1,
    localReadinessUrl: "http://127.0.0.1:3003/api/ready",
    localReadinessProbe: async () => ({ source: "local-origin", ok: true, status: 200 })
  };
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const bootstrap = externalSnapshot(config, {
    nonce: "1".repeat(32),
    observedAt: "2026-07-24T20:00:00Z"
  });
  const initialized = await runCycle({ ...common, externalProbeSnapshot: bootstrap, nowMs: base });
  assert.equal(initialized.reason, "initial_primary_verified");

  const firstFailure = externalSnapshot(config, {
    nonce: "2".repeat(32),
    observedAt: "2026-07-24T20:00:01Z",
    byTarget: {
      "vip-gece-site": {
        http_status: 0,
        contract_ok: false,
        result_code: "tls_or_transport_failed"
      }
    }
  });
  await runCycle({ ...common, externalProbeSnapshot: firstFailure, nowMs: base + 1000 });
  const afterFirstFailure = await readState(stateFile, config);
  assert.equal(afterFirstFailure.counters["vip-gece-site"].consecutive_failures, 1);
  assert.equal(afterFirstFailure.last_external_probe.nonce, "2".repeat(32));

  const replayed = await runCycle({
    ...common,
    externalProbeSnapshot: firstFailure,
    nowMs: base + 2000
  });
  assert.equal(replayed.reason, "external_probe_snapshot_already_consumed");
  assert.deepEqual(await readState(stateFile, config), afterFirstFailure);

  const outOfOrder = externalSnapshot(config, {
    nonce: "5".repeat(32),
    observedAt: "2026-07-24T20:00:00Z",
    receivedAt: "2026-07-24T20:00:01Z"
  });
  assert.throws(
    () => externalProbeDisposition(afterFirstFailure, outOfOrder, config),
    (error) => error.code === "EXTERNAL_PROBE_OUT_OF_ORDER"
  );

  const secondFailure = externalSnapshot(config, {
    nonce: "3".repeat(32),
    observedAt: "2026-07-24T20:00:02Z",
    byTarget: {
      "vip-gece-site": {
        http_status: 0,
        contract_ok: false,
        result_code: "tls_or_transport_failed"
      }
    }
  });
  const thirdFailure = externalSnapshot(config, {
    nonce: "4".repeat(32),
    observedAt: "2026-07-24T20:00:03Z",
    byTarget: {
      "vip-gece-site": {
        http_status: 0,
        contract_ok: false,
        result_code: "tls_or_transport_failed"
      }
    }
  });
  await runCycle({ ...common, externalProbeSnapshot: secondFailure, nowMs: base + 2000 });
  const threshold = await runCycle({
    ...common,
    externalProbeSnapshot: thirdFailure,
    nowMs: base + 3000
  });
  assert.equal(threshold.reason, "failover_thresholds_met");
  assert.deepEqual(threshold.decision, {
    type: "switch",
    from: "vip-gece-site",
    to: "vip-gece-online"
  });
  const thresholdState = await readState(stateFile, config);
  assert.equal(thresholdState.counters["vip-gece-site"].consecutive_failures, 3);

  const staleAfterThreshold = externalSnapshot(config, {
    nonce: "6".repeat(32),
    observedAt: "2026-07-24T20:00:04Z"
  });
  await assert.rejects(
    runCycle({
      ...common,
      externalProbeSnapshot: staleAfterThreshold,
      nowMs: base + 8 * 60 * 1000
    }),
    (error) => error.code === "EXTERNAL_PROBE_STALE"
  );
  assert.deepEqual(await readState(stateFile, config), thresholdState);

  const freshAfterGap = externalSnapshot(config, {
    nonce: "7".repeat(32),
    observedAt: "2026-07-24T20:08:01Z",
    receivedAt: "2026-07-24T20:08:01Z",
    byTarget: {
      "vip-gece-site": {
        http_status: 0,
        contract_ok: false,
        result_code: "tls_or_transport_failed"
      }
    }
  });
  const restarted = await runCycle({
    ...common,
    externalProbeSnapshot: freshAfterGap,
    nowMs: base + 8 * 60 * 1000 + 1000
  });
  assert.equal(restarted.decision, null);
  assert.equal(restarted.reason, "active_failure_threshold_not_met");
  const restartedState = await readState(stateFile, config);
  assert.equal(restartedState.counters["vip-gece-site"].consecutive_failures, 1);
  assert.equal(restartedState.counters["vip-gece-online"].consecutive_successes, 1);
});

test("three failures and three two-source successes are required for failover", () => {
  const config = validateTargetsConfig(rawConfig());
  const unhealthyPrimary = {
    "vip-gece-site": { healthy: false, evidenceCount: 0 },
    "vip-gece-online": { healthy: true, evidenceCount: 2 }
  };
  let state = initialState(config, 1000);
  let result;

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    result = advanceState(state, config, unhealthyPrimary, cycle * 300000);
    state = result.state;
    if (cycle < 3) assert.equal(result.decision, null);
  }
  assert.deepEqual(result.decision, {
    type: "switch",
    from: "vip-gece-site",
    to: "vip-gece-online"
  });

  const coolingDown = JSON.parse(JSON.stringify(state));
  coolingDown.last_switch_at = new Date(900000 - 30 * 60 * 1000).toISOString();
  const cooldownResult = advanceState(coolingDown, config, unhealthyPrimary, 900000);
  assert.equal(cooldownResult.decision, null);
  assert.equal(cooldownResult.reason, "switch_cooldown_active");

  const committed = commitSwitch(state, result.decision, config, 900000);
  const failbackAttempt = advanceState(committed, config, {
    "vip-gece-site": { healthy: true, evidenceCount: 2 },
    "vip-gece-online": { healthy: false, evidenceCount: 0 }
  }, 1200000);
  assert.equal(failbackAttempt.reason, "automatic_failback_disabled");

  const expired = advanceState(committed, config, {
    "vip-gece-site": { healthy: true, evidenceCount: 2 },
    "vip-gece-online": { healthy: false, evidenceCount: 0 }
  }, 900000 + MAX_FAILOVER_MS + 1);
  assert.equal(expired.reason, "max_failover_window_requires_manual_action");
});

test("lock release is nonce/inode-owned and live owners cannot be taken over as stale", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-lock-"));
  const lockFile = path.join(directory, "monitor.lock");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const release = await acquireFileLock(lockFile, { staleMs: 1 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    acquireFileLock(lockFile, { staleMs: 1, pidIsAlive: () => true }),
    (error) => error.code === "LOCKED"
  );

  const displaced = `${lockFile}.displaced`;
  await fs.rename(lockFile, displaced);
  const successor = {
    pid: process.pid,
    nonce: "d".repeat(32),
    created_at: new Date().toISOString()
  };
  await fs.writeFile(lockFile, `${JSON.stringify(successor)}\n`, { mode: 0o600 });
  await release();
  await fs.access(lockFile);

  await fs.unlink(lockFile);
  await fs.unlink(displaced);
  const stale = {
    pid: 999999,
    nonce: "e".repeat(32),
    created_at: new Date(Date.now() - 60000).toISOString()
  };
  await fs.writeFile(lockFile, `${JSON.stringify(stale)}\n`, { mode: 0o600 });
  const oldTime = new Date(Date.now() - 60000);
  await fs.utimes(lockFile, oldTime, oldTime);
  const contenders = await Promise.allSettled([
    acquireFileLock(lockFile, { staleMs: 1, pidIsAlive: () => false }),
    acquireFileLock(lockFile, { staleMs: 1, pidIsAlive: () => false })
  ]);
  const winners = contenders.filter((result) => result.status === "fulfilled");
  const losers = contenders.filter((result) => result.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, "LOCKED");
  await winners[0].value();
});

test("apply mode validates Cloudflare configuration but performs no mutation without a decision", async (t) => {
  const config = validateTargetsConfig(rawConfig());
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-cycle-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let cloudflareCalls = 0;

  const result = await runCycle({
    config,
    mode: "apply",
    stateFile: path.join(directory, "state.json"),
    lockFile: path.join(directory, "monitor.lock"),
    journalFile: path.join(directory, "pending.json"),
    evaluateTarget: async () => ({ healthy: false, evidenceCount: 0, evidence: [] }),
    cloudflareUpdate: async () => {
      cloudflareCalls += 1;
    },
    ...cfOptions()
  });

  assert.equal(result.reason, "initial_primary_unverified");
  assert.equal(cloudflareCalls, 0);
});

test("apply mode stays fail-closed until an operator explicitly arms verified evidence", async () => {
  const config = validateTargetsConfig(rawConfig());
  await assert.rejects(
    runCycle({
      config,
      mode: "apply",
      applyArmed: false
    }),
    (error) => error.code === "CONFIG_INVALID" && /not armed/.test(error.message)
  );
});

test("expired activation attestation refuses failover before Cloudflare PATCH", async (t) => {
  const base = Date.parse("2026-07-25T10:00:00Z");
  const config = validateTargetsConfig(rawConfig(true, {
    attestation: { observedAt: "2026-07-25T10:00:00Z" }
  }), { nowMs: base });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-attestation-"));
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  const state = initialState(config, base);
  state.counters["vip-gece-site"].consecutive_failures = 2;
  state.counters["vip-gece-online"].consecutive_successes = 2;
  await writeStateAtomic(stateFile, state, config);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let patchCalls = 0;

  await assert.rejects(
    runCycle({
      config,
      mode: "apply",
      nowMs: base + ACTIVATION_ATTESTATION_MAX_AGE_MS + 1,
      currentTimeMs: () => base + ACTIVATION_ATTESTATION_MAX_AGE_MS + 1,
      stateFile,
      journalFile,
      lockFile: path.join(directory, "monitor.lock"),
      evaluateTarget: async (target) => ({
        healthy: target.id === "vip-gece-online",
        evidenceCount: target.id === "vip-gece-online" ? 2 : 0,
        evidence: []
      }),
      cloudflareUpdate: async () => {
        patchCalls += 1;
      },
      ...cfOptions()
    }),
    (error) => error.code === "ACTIVATION_ATTESTATION_STALE" &&
      /stale/.test(error.message)
  );
  assert.equal(patchCalls, 0);
  await assert.rejects(fs.access(journalFile));
});

test("attestation expiry during a custom updater prevents commit and retains the journal", async (t) => {
  const base = Date.parse("2026-07-25T10:00:00Z");
  let clockMs = base;
  const config = validateTargetsConfig(rawConfig(true, {
    attestation: { observedAt: "2026-07-25T10:00:00Z" }
  }), { nowMs: base });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-attestation-race-"));
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  const state = initialState(config, base);
  state.counters["vip-gece-site"].consecutive_failures = 2;
  state.counters["vip-gece-online"].consecutive_successes = 2;
  await writeStateAtomic(stateFile, state, config);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    runCycle({
      config,
      mode: "apply",
      nowMs: base,
      currentTimeMs: () => clockMs,
      stateFile,
      journalFile,
      lockFile: path.join(directory, "monitor.lock"),
      evaluateTarget: async (target) => ({
        healthy: target.id === "vip-gece-online",
        evidenceCount: target.id === "vip-gece-online" ? 2 : 0,
        evidence: []
      }),
      cloudflareUpdate: async () => {
        clockMs = base + ACTIVATION_ATTESTATION_MAX_AGE_MS + 1000;
      },
      ...cfOptions()
    }),
    (error) => error.code === "ACTIVATION_ATTESTATION_STALE" &&
      /stale/.test(error.message)
  );
  await fs.access(journalFile);
  assert.equal((await readState(stateFile, config)).active_target_id, "vip-gece-site");

  const reconciled = await runCycle({
    config,
    mode: "observe",
    nowMs: clockMs,
    currentTimeMs: () => clockMs,
    stateFile,
    journalFile,
    lockFile: path.join(directory, "monitor.lock"),
    cloudflareInspect: async () => ({ currentOrigin: "https://vip-gece.online" }),
    ...cfOptions()
  });
  assert.equal(reconciled.reason, "pending_switch_committed");
  assert.equal((await readState(stateFile, config)).active_target_id, "vip-gece-online");
  await assert.rejects(fs.access(journalFile));
});

test("Cloudflare updater verifies exact zone, ref, host expression, current target and full result", async () => {
  const before = cfRule("https://vip-gece.site");
  const desired = cfRule("https://vip-gece.online");
  const calls = [];
  const fetchImpl = sequenceFetch([
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { id: CF_RULE_ID } },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(desired, "2") }
  ], calls);
  const guards = [];

  const result = await updateCloudflareRedirect(cfCoreOptions(fetchImpl, {
    expectedCurrentOrigin: "https://vip-gece.site",
    targetOrigin: "https://vip-gece.online",
    beforePatch: async () => guards.push("before"),
    afterUpdate: async () => guards.push("after")
  }));
  assert.equal(result.changed, true);
  assert.deepEqual(guards, ["before", "after"]);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.equal(
    calls.find((call) => call.method === "PATCH").body.action_parameters.from_value.target_url.expression,
    "concat(\"https://vip-gece.online\", http.request.uri.path)"
  );
});

test("Cloudflare updater performs no PATCH when the final freshness guard expires", async () => {
  const before = cfRule("https://vip-gece.site");
  const calls = [];
  const fetchImpl = sequenceFetch([
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") }
  ], calls);
  const stale = new Error("activation attestation is stale");
  stale.code = "ACTIVATION_ATTESTATION_STALE";

  await assert.rejects(
    updateCloudflareRedirect(cfCoreOptions(fetchImpl, {
      expectedCurrentOrigin: "https://vip-gece.site",
      targetOrigin: "https://vip-gece.online",
      beforePatch: async () => {
        throw stale;
      }
    })),
    (error) => error.code === "ACTIVATION_ATTESTATION_STALE"
  );
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
});

test("Cloudflare updater pins but does not PATCH a generated ref equal to the rule ID", async () => {
  const before = cfRule("https://vip-gece.site", { ref: CF_RULE_ID });
  const desired = cfRule("https://vip-gece.online", { ref: CF_RULE_ID });
  const calls = [];
  const fetchImpl = sequenceFetch([
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { id: CF_RULE_ID } },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(desired, "2") }
  ], calls);

  const result = await updateCloudflareRedirect(cfCoreOptions(fetchImpl, {
    expectedRuleRef: CF_RULE_ID,
    expectedCurrentOrigin: "https://vip-gece.site",
    targetOrigin: "https://vip-gece.online"
  }));
  assert.equal(result.changed, true);
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal("ref" in patch.body, false);
});

test("Cloudflare updater refuses an unrelated rule before PATCH", async () => {
  const unrelated = cfRule("https://vip-gece.site", {
    ref: "unrelated-rule",
    expression: "(http.host eq \"unrelated.example\")"
  });
  const calls = [];
  const fetchImpl = sequenceFetch([
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(unrelated) }
  ], calls);

  await assert.rejects(
    updateCloudflareRedirect(cfCoreOptions(fetchImpl, {
      expectedCurrentOrigin: "https://vip-gece.site",
      targetOrigin: "https://vip-gece.online"
    })),
    (error) => error.code === "CF_IDENTITY_MISMATCH"
  );
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
});

test("Cloudflare validation uses CAS-like rollback only while the desired rule is still current", async () => {
  const before = cfRule("https://vip-gece.site");
  const desired = cfRule("https://vip-gece.online");
  const calls = [];
  const fetchImpl = sequenceFetch([
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { id: CF_RULE_ID } },
    { result: { name: CF_ZONE_NAME } },
    { httpStatus: 503, success: false, result: null },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(desired, "2") },
    { result: { id: CF_RULE_ID } },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "3") }
  ], calls);

  await assert.rejects(
    updateCloudflareRedirect(cfCoreOptions(fetchImpl, {
      expectedCurrentOrigin: "https://vip-gece.site",
      targetOrigin: "https://vip-gece.online"
    })),
    (error) => error.code === "CF_UPDATE_ROLLED_BACK"
  );
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 2);
});

test("Cloudflare updater rolls back when post-update config validation fails", async () => {
  const before = cfRule("https://vip-gece.site");
  const desired = cfRule("https://vip-gece.online");
  const calls = [];
  const fetchImpl = sequenceFetch([
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { id: CF_RULE_ID } },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(desired, "2") },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(desired, "2") },
    { result: { id: CF_RULE_ID } },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "3") }
  ], calls);
  const changed = new Error("targets config changed during the monitor cycle");
  changed.code = "CONFIG_CHANGED";

  await assert.rejects(
    updateCloudflareRedirect(cfCoreOptions(fetchImpl, {
      expectedCurrentOrigin: "https://vip-gece.site",
      targetOrigin: "https://vip-gece.online",
      afterUpdate: async () => {
        throw changed;
      }
    })),
    (error) => error.code === "CONFIG_CHANGED"
  );
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 2);
});

test("Cloudflare rollback refuses to overwrite a concurrent operator edit", async () => {
  const before = cfRule("https://vip-gece.site");
  const operatorEdit = cfRule("https://vip-gece.online", {
    description: "operator changed this rule"
  });
  const calls = [];
  const fetchImpl = sequenceFetch([
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(before, "1") },
    { result: { id: CF_RULE_ID } },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(operatorEdit, "2") },
    { result: { name: CF_ZONE_NAME } },
    { result: cfRuleset(operatorEdit, "2") }
  ], calls);

  await assert.rejects(
    updateCloudflareRedirect(cfCoreOptions(fetchImpl, {
      expectedCurrentOrigin: "https://vip-gece.site",
      targetOrigin: "https://vip-gece.online"
    })),
    (error) => error.code === "CF_CONCURRENT_CHANGE"
  );
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
});

test("pending journal reconciles a remotely completed switch before any new probe", async (t) => {
  const config = validateTargetsConfig(rawConfig());
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-reconcile-"));
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  const lockFile = path.join(directory, "monitor.lock");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const before = initialState(config);
  const decision = { type: "switch", from: "vip-gece-site", to: "vip-gece-online" };
  const committed = commitSwitch(before, decision, config);
  await writeStateAtomic(stateFile, before, config);
  await writePendingJournalAtomic(
    journalFile,
    createPendingJournal(config, before, committed, decision),
    config
  );
  let probes = 0;
  const result = await runCycle({
    config,
    mode: "observe",
    stateFile,
    journalFile,
    lockFile,
    evaluateTarget: async () => {
      probes += 1;
      return { healthy: true, evidenceCount: 2, evidence: [] };
    },
    cloudflareInspect: async () => ({ currentOrigin: "https://vip-gece.online" }),
    ...cfOptions()
  });

  assert.equal(result.reason, "pending_switch_committed");
  assert.equal((await readState(stateFile, config)).active_target_id, "vip-gece-online");
  await assert.rejects(fs.access(journalFile));
  assert.equal(probes, 0);
});

test("confirmed Cloudflare rollback is reconciled immediately and clears the journal", async (t) => {
  const config = validateTargetsConfig(rawConfig());
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-rollback-cycle-"));
  const stateFile = path.join(directory, "state.json");
  const journalFile = path.join(directory, "pending.json");
  const lockFile = path.join(directory, "monitor.lock");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const observations = {
    "vip-gece-site": { healthy: false, evidenceCount: 0, evidence: [] },
    "vip-gece-online": { healthy: true, evidenceCount: 2, evidence: [] }
  };
  let state = initialState(config);
  state = advanceState(state, config, observations).state;
  state = advanceState(state, config, observations).state;
  await writeStateAtomic(stateFile, state, config);

  const result = await runCycle({
    config,
    mode: "apply",
    stateFile,
    journalFile,
    lockFile,
    evaluateTarget: async (target) => observations[target.id],
    cloudflareUpdate: async () => {
      const error = new Error("rollback confirmed");
      error.code = "CF_UPDATE_ROLLED_BACK";
      throw error;
    },
    cloudflareInspect: async () => ({ currentOrigin: "https://vip-gece.site" }),
    ...cfOptions()
  });

  assert.equal(result.reason, "pending_switch_not_applied_or_rolled_back");
  assert.equal((await readState(stateFile, config)).active_target_id, "vip-gece-site");
  await assert.rejects(fs.access(journalFile));
});

test("state and health writes are private and durable, and secret files must be mode 0600", async (t) => {
  const config = validateTargetsConfig(rawConfig());
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-files-"));
  const stateFile = path.join(directory, "state.json");
  const healthFile = path.join(directory, "health.json");
  const secretFile = path.join(directory, "cloudflare.token");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const state = initialState(config);
  await writeStateAtomic(stateFile, state, config);
  assert.deepEqual(await readState(stateFile, config), state);
  assert.equal((await fs.lstat(stateFile)).mode & 0o077, 0);

  const legacy = { ...state, version: 2 };
  delete legacy.last_external_probe;
  await fs.writeFile(stateFile, `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
  const migrated = await readState(stateFile, config, { allowConfigRebase: true });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.last_external_probe, null);

  await writeMonitorHealth(healthFile, "ok", {
    mode: "observe",
    activeTargetId: config.primaryTargetId,
    reason: "test"
  });
  assert.equal((await fs.lstat(healthFile)).mode & 0o077, 0);

  await fs.writeFile(secretFile, "test-token-that-is-long-enough\n", { mode: 0o644 });
  await assert.rejects(loadSecretFile(secretFile), /trusted/);
  await fs.chmod(secretFile, 0o600);
  assert.equal(await loadSecretFile(secretFile), "test-token-that-is-long-enough");
});

test("config rebase discards health counters and consumed probe history", async (t) => {
  const beforeConfig = validateTargetsConfig(rawConfig(false));
  const afterConfig = validateTargetsConfig(rawConfig(true));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-rebase-"));
  const stateFile = path.join(directory, "state.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const state = initialState(beforeConfig);
  state.counters["vip-gece-site"].consecutive_failures = 2;
  state.counters["vip-gece-online"].consecutive_successes = 2;
  state.last_external_probe = {
    probe_id: "tr-mac-01",
    config_version: 1,
    nonce: "d".repeat(32),
    observed_at: "2026-07-24T20:00:00Z",
    received_at: "2026-07-24T20:00:00Z",
    payload_sha256: "e".repeat(64)
  };
  await writeStateAtomic(stateFile, state, beforeConfig);

  const rebased = await readState(stateFile, afterConfig, {
    allowConfigRebase: true
  });
  assert.deepEqual(rebased.counters, {
    "vip-gece-site": { consecutive_failures: 0, consecutive_successes: 0 },
    "vip-gece-online": { consecutive_failures: 0, consecutive_successes: 0 }
  });
  assert.equal(rebased.last_external_probe, null);
  assert.equal(rebased.active_target_id, "vip-gece-site");
});

test("timestamp-only attestation renewal starts a new health generation", async (t) => {
  const base = Date.parse("2026-07-25T10:05:00Z");
  const beforeConfig = validateTargetsConfig(rawConfig(true, {
    attestation: { observedAt: "2026-07-25T10:00:00Z" }
  }), { nowMs: base });
  const afterConfig = validateTargetsConfig(rawConfig(true, {
    attestation: { observedAt: "2026-07-25T10:05:00Z" }
  }), { nowMs: base });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-gateway-attestation-renewal-"));
  const stateFile = path.join(directory, "state.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const state = initialState(beforeConfig, base);
  state.counters["vip-gece-site"].consecutive_failures = 2;
  state.counters["vip-gece-online"].consecutive_successes = 2;
  state.last_external_probe = {
    probe_id: "tr-mac-01",
    config_version: 1,
    nonce: "d".repeat(32),
    observed_at: "2026-07-25T10:04:00Z",
    received_at: "2026-07-25T10:04:00Z",
    payload_sha256: "e".repeat(64)
  };
  await writeStateAtomic(stateFile, state, beforeConfig);

  assert.notEqual(afterConfig.configHash, beforeConfig.configHash);
  const renewed = await readState(stateFile, afterConfig, { allowConfigRebase: true });
  assert.deepEqual(renewed.counters, {
    "vip-gece-site": { consecutive_failures: 0, consecutive_successes: 0 },
    "vip-gece-online": { consecutive_failures: 0, consecutive_successes: 0 }
  });
  assert.equal(renewed.last_external_probe, null);
});

test("persistent configuration and Cloudflare identity errors are fatal to monitor scheduling", () => {
  assert.equal(isPermanentMonitorError({ code: "CONFIG_INVALID" }), true);
  assert.equal(
    isPermanentMonitorError({ code: "ACTIVATION_ATTESTATION_STALE" }),
    false
  );
  assert.equal(isPermanentMonitorError({ code: "CF_IDENTITY_MISMATCH" }), true);
  assert.equal(isPermanentMonitorError({ code: "CF_CONCURRENT_CHANGE" }), true);
  assert.equal(isPermanentMonitorError({ code: "CF_API_ERROR" }), false);
  assert.equal(isPermanentMonitorError({ code: "LOCKED" }), false);
});

test("PM2 ecosystem enforces the dedicated vipgateway identity and token-file isolation", () => {
  const ecosystem = require("../ecosystem.config.cjs");
  assert.equal(ecosystem.apps.length, 2);
  for (const app of ecosystem.apps) {
    // The whole PM2 daemon is launched as vipgateway. Supplying uid/gid here
    // would make PM2 require a root daemon and weaken the isolation boundary.
    assert.equal("uid" in app, false);
    assert.equal("gid" in app, false);
    assert.equal(app.env.DOMAIN_GATEWAY_EXPECTED_OS_USER, "vipgateway");
    assert.equal(app.env.DOMAIN_GATEWAY_CONFIG_OWNER_UID, "0");
  }
  const monitor = ecosystem.apps.find((app) => app.name === "vip-gece-domain-monitor");
  assert.equal(monitor.env.DOMAIN_GATEWAY_MODE, "observe");
  assert.equal(monitor.env.DOMAIN_GATEWAY_APPLY_ARMED, "0");
  assert.equal(
    monitor.env.DOMAIN_GATEWAY_EXTERNAL_PROBE_SNAPSHOT_FILE,
    "/var/lib/vip-gece-domain-gateway/probes/tr-mac-01/latest.json"
  );
  assert.equal(monitor.env.DOMAIN_GATEWAY_EXTERNAL_PROBE_ID, "tr-mac-01");
  assert.equal(monitor.env.DOMAIN_GATEWAY_EXTERNAL_PROBE_CONFIG_VERSION, "1");
  assert.equal(
    monitor.env.DOMAIN_GATEWAY_LOCAL_READINESS_URL,
    "http://127.0.0.1:3003/api/ready"
  );
  assert.equal(typeof monitor.env.CLOUDFLARE_API_TOKEN, "undefined");
  assert.equal(
    monitor.env.CLOUDFLARE_API_TOKEN_FILE,
    "/etc/vip-gece-domain-gateway/cloudflare.token"
  );
});

test("Cloudflare API URLs remain fixed to the configured exact zone/ruleset/rule", () => {
  const zoneUrl = `${CLOUDFLARE_API_ROOT}/zones/${CF_ZONE_ID}`;
  const rulesetUrl = `${zoneUrl}/rulesets/${CF_RULESET_ID}`;
  const ruleUrl = `${rulesetUrl}/rules/${CF_RULE_ID}`;
  assert.match(zoneUrl, /^https:\/\/api\.cloudflare\.com\/client\/v4\/zones\//);
  assert.ok(ruleUrl.endsWith(`/rules/${CF_RULE_ID}`));
});
