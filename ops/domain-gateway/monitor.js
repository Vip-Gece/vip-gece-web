"use strict";

const path = require("node:path");
const {
  advanceState,
  assertRuntimeUser,
  assertStandbyActivationAttestation,
  commitSwitch,
  createPendingJournal,
  evaluateTarget,
  evaluateTargetsWithExternalProbe,
  externalProbeDisposition,
  initialState,
  inspectCloudflareRedirect,
  loadSecretFile,
  loadTargetsConfig,
  readExternalProbeSnapshot,
  readPendingJournal,
  readState,
  removeFileDurable,
  recordExternalProbe,
  updateCloudflareRedirect,
  validateExternalProbeSnapshot,
  validateCloudflareMetadata,
  withFileLock,
  writeJsonAtomic,
  writePendingJournalAtomic,
  writeStateAtomic
} = require("./core");

const LOOP_MS = 5 * 60 * 1000;
const TARGETS_FILE = process.env.DOMAIN_GATEWAY_TARGETS_FILE || path.join(__dirname, "targets.json");
const STATE_FILE = process.env.DOMAIN_GATEWAY_STATE_FILE || path.join(__dirname, "state", "state.json");
const LOCK_FILE = process.env.DOMAIN_GATEWAY_LOCK_FILE || path.join(__dirname, "state", "monitor.lock");
const JOURNAL_FILE = process.env.DOMAIN_GATEWAY_JOURNAL_FILE || path.join(__dirname, "state", "pending-switch.json");
const HEALTH_FILE = process.env.DOMAIN_GATEWAY_MONITOR_HEALTH_FILE ||
  path.join(__dirname, "state", "monitor-health.json");
const EXTERNAL_PROBE_SNAPSHOT_FILE = process.env.DOMAIN_GATEWAY_EXTERNAL_PROBE_SNAPSHOT_FILE ||
  "/var/lib/vip-gece-domain-gateway/probes/tr-mac-01/latest.json";
const EXTERNAL_PROBE_ID = process.env.DOMAIN_GATEWAY_EXTERNAL_PROBE_ID || "tr-mac-01";
const EXTERNAL_PROBE_CONFIG_VERSION = process.env.DOMAIN_GATEWAY_EXTERNAL_PROBE_CONFIG_VERSION || "1";
const LOCAL_READINESS_URL = process.env.DOMAIN_GATEWAY_LOCAL_READINESS_URL ||
  "http://127.0.0.1:3003/api/ready";
const ERROR_CODE_MAX_LENGTH = 128;
const ERROR_MESSAGE_MAX_LENGTH = 1024;

function configError(message) {
  const error = new Error(message);
  error.code = "CONFIG_INVALID";
  return error;
}

function numericUid(value, label) {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(String(value))) throw configError(`${label} is invalid`);
  return Number(value);
}

function positiveInteger(value, label) {
  if (!/^[1-9]\d*$/.test(String(value || ""))) throw configError(`${label} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw configError(`${label} is invalid`);
  return parsed;
}

function monitorMode(value = process.env.DOMAIN_GATEWAY_MODE) {
  return value === "apply" ? "apply" : "observe";
}

async function cloudflareRuntimeOptions(options = {}, behavior = {}) {
  const applyArmed = options.applyArmed === true ||
    (options.applyArmed === undefined && process.env.DOMAIN_GATEWAY_APPLY_ARMED === "1");
  if (behavior.requireArmed !== false && !applyArmed) {
    throw configError("apply mode is not armed; verified external evidence is required first");
  }
  if (!options.cloudflareToken && process.env.CLOUDFLARE_API_TOKEN) {
    throw configError("raw CLOUDFLARE_API_TOKEN environment values are forbidden; use a token file");
  }

  let token = options.cloudflareToken;
  if (!token) {
    const tokenFile = options.cloudflareTokenFile || process.env.CLOUDFLARE_API_TOKEN_FILE;
    token = await loadSecretFile(tokenFile, {
      ownerUid: numericUid(
        options.cloudflareTokenOwnerUid ?? process.env.CLOUDFLARE_TOKEN_OWNER_UID,
        "CLOUDFLARE_TOKEN_OWNER_UID"
      ),
      label: "Cloudflare API token"
    });
  }
  if (typeof token !== "string" || token.length < 20 || token.length > 4096 || /[\r\n]/.test(token)) {
    throw configError("Cloudflare API token is invalid");
  }

  const result = {
    fetchImpl: options.fetchImpl,
    token,
    zoneId: options.cloudflareZoneId || process.env.CLOUDFLARE_ZONE_ID,
    rulesetId: options.cloudflareRulesetId || process.env.CLOUDFLARE_REDIRECT_RULESET_ID,
    ruleId: options.cloudflareRuleId || process.env.CLOUDFLARE_REDIRECT_RULE_ID,
    expectedZoneName: options.cloudflareExpectedZoneName || process.env.CLOUDFLARE_EXPECTED_ZONE_NAME,
    expectedRuleRef: options.cloudflareExpectedRuleRef || process.env.CLOUDFLARE_EXPECTED_RULE_REF,
    expectedRuleExpression: options.cloudflareExpectedRuleExpression ||
      process.env.CLOUDFLARE_EXPECTED_RULE_EXPRESSION
  };
  validateCloudflareMetadata(result);
  return result;
}

async function evaluateAllTargets(config, options = {}) {
  const observations = {};
  const evaluator = options.evaluateTarget || evaluateTarget;
  for (const target of config.targets) {
    observations[target.id] = target.enabled
      ? await evaluator(target, config, options.probeOptions)
      : { healthy: false, evidenceCount: 0, evidence: [] };
  }
  return observations;
}

async function collectMonitoringEvidence(config, previous, options = {}, nowMs = Date.now()) {
  if (typeof options.evaluateTarget === "function") {
    return {
      observations: await evaluateAllTargets(config, options),
      snapshot: null,
      disposition: "legacy-test-injection"
    };
  }

  const snapshotOptions = {
    probeId: options.externalProbeId ?? EXTERNAL_PROBE_ID,
    configVersion: positiveInteger(
      options.externalProbeConfigVersion ?? EXTERNAL_PROBE_CONFIG_VERSION,
      "DOMAIN_GATEWAY_EXTERNAL_PROBE_CONFIG_VERSION"
    ),
    maxAgeMs: options.externalProbeMaxAgeMs,
    nowMs,
    ownerUid: numericUid(
      options.externalProbeOwnerUid ?? process.env.DOMAIN_GATEWAY_EXTERNAL_PROBE_OWNER_UID,
      "DOMAIN_GATEWAY_EXTERNAL_PROBE_OWNER_UID"
    )
  };
  const snapshot = options.externalProbeSnapshot
    ? validateExternalProbeSnapshot(options.externalProbeSnapshot, config, snapshotOptions)
    : await readExternalProbeSnapshot(
        options.externalProbeSnapshotFile ?? EXTERNAL_PROBE_SNAPSHOT_FILE,
        config,
        snapshotOptions
      );
  const disposition = previous
    ? externalProbeDisposition(previous, snapshot, config)
    : "new";
  if (disposition === "replay") {
    return { observations: {}, snapshot, disposition };
  }
  return {
    observations: await evaluateTargetsWithExternalProbe(config, snapshot, {
      localReadinessUrl: options.localReadinessUrl ?? LOCAL_READINESS_URL,
      localReadinessProbe: options.localReadinessProbe,
      localReadinessOptions: options.localReadinessOptions,
      nowMs
    }),
    snapshot,
    disposition
  };
}

function targetObservationIsHealthy(observation) {
  return observation?.healthy === true && observation.evidenceCount >= 2;
}

async function reconcilePendingJournal(options) {
  const {
    config,
    journal,
    previous,
    stateFile,
    journalFile,
    cloudflareOptions
  } = options;
  const fromTarget = config.targetById.get(journal.decision.from);
  const toTarget = config.targetById.get(journal.decision.to);
  if (!fromTarget?.enabled || !toTarget?.enabled) {
    const error = new Error("pending journal target is no longer enabled");
    error.code = "MANUAL_ACTION_REQUIRED";
    throw error;
  }

  const inspector = options.cloudflareInspect || inspectCloudflareRedirect;
  const remote = await inspector({
    ...cloudflareOptions,
    allowedCurrentOrigins: [fromTarget.origin, toTarget.origin]
  });
  if (
    previous &&
    previous.active_target_id !== journal.decision.from &&
    previous.active_target_id !== journal.decision.to
  ) {
    const error = new Error("local state does not match either pending journal endpoint");
    error.code = "MANUAL_ACTION_REQUIRED";
    throw error;
  }

  let reconciled;
  let reason;
  if (remote.currentOrigin === toTarget.origin) {
    reconciled = journal.committed_state;
    reason = "pending_switch_committed";
  } else if (remote.currentOrigin === fromTarget.origin) {
    reconciled = journal.before_state;
    reason = "pending_switch_not_applied_or_rolled_back";
  } else {
    const error = new Error("remote redirect is outside the pending journal endpoints");
    error.code = "MANUAL_ACTION_REQUIRED";
    throw error;
  }

  if (options.ensureConfigCurrent) await options.ensureConfigCurrent();
  await writeStateAtomic(stateFile, reconciled, config);
  await removeFileDurable(journalFile);
  return {
    mode: options.mode,
    activeTargetId: reconciled.active_target_id,
    decision: journal.decision,
    reason,
    observations: {}
  };
}

async function runCycle(options = {}) {
  const ownerUid = numericUid(
    options.configOwnerUid ?? process.env.DOMAIN_GATEWAY_CONFIG_OWNER_UID,
    "DOMAIN_GATEWAY_CONFIG_OWNER_UID"
  );
  const targetsFile = options.targetsFile || TARGETS_FILE;
  const loadConfig = () => options.config || loadTargetsConfig(targetsFile, {
    ownerUid,
    requireFreshness: false
  });
  const stateFile = options.stateFile || STATE_FILE;
  const lockFile = options.lockFile || LOCK_FILE;
  const journalFile = options.journalFile || JOURNAL_FILE;
  const mode = monitorMode(options.mode);
  const currentTimeMs = typeof options.currentTimeMs === "function"
    ? options.currentTimeMs
    : Date.now;
  const nowMs = options.nowMs ?? currentTimeMs();
  let cloudflareOptions = null;

  if (mode === "apply") {
    cloudflareOptions = await cloudflareRuntimeOptions(options);
  }

  return withFileLock(lockFile, async () => {
    const config = await loadConfig();
    const ensureConfigCurrent = async ({
      targetId = null,
      attestationObservedAt = null,
      atMs = currentTimeMs()
    } = {}) => {
      const current = await loadConfig();
      if (current.configHash !== config.configHash) {
        const error = new Error("targets config changed during the monitor cycle");
        error.code = "CONFIG_CHANGED";
        throw error;
      }
      if (targetId) {
        const attestation = assertStandbyActivationAttestation(current, targetId, { nowMs: atMs });
        if (attestationObservedAt && attestation?.observed_at !== attestationObservedAt) {
          const error = new Error("activation attestation changed during the monitor cycle");
          error.code = "CONFIG_CHANGED";
          throw error;
        }
      }
      return current;
    };
    const journal = await readPendingJournal(journalFile, config, { allowMissing: true });
    const previous = await readState(stateFile, config, {
      allowMissing: true,
      allowConfigRebase: true
    });

    if (journal) {
      cloudflareOptions ||= await cloudflareRuntimeOptions(options, { requireArmed: false });
      return reconcilePendingJournal({
        ...options,
        config,
        journal,
        previous,
        stateFile,
        journalFile,
        mode,
        cloudflareOptions,
        ensureConfigCurrent
      });
    }

    const evidence = await collectMonitoringEvidence(config, previous, options, nowMs);
    const { observations } = evidence;
    await ensureConfigCurrent();
    if (previous && evidence.disposition === "replay") {
      return {
        mode,
        activeTargetId: previous.active_target_id,
        decision: null,
        reason: "external_probe_snapshot_already_consumed",
        observations: {}
      };
    }
    if (!previous) {
      const primaryObservation = observations[config.primaryTargetId];
      if (!targetObservationIsHealthy(primaryObservation)) {
        return {
          mode,
          activeTargetId: null,
          decision: null,
          reason: "initial_primary_unverified",
          observations
        };
      }
      let verified = advanceState(initialState(config, nowMs), config, observations, nowMs).state;
      if (evidence.snapshot) {
        verified = recordExternalProbe(verified, evidence.snapshot, config);
      }
      await writeStateAtomic(stateFile, verified, config);
      return {
        mode,
        activeTargetId: verified.active_target_id,
        decision: null,
        reason: "initial_primary_verified",
        observations
      };
    }

    const advanced = advanceState(previous, config, observations, nowMs);
    if (evidence.snapshot) {
      advanced.state = recordExternalProbe(advanced.state, evidence.snapshot, config);
    }
    await writeStateAtomic(stateFile, advanced.state, config);

    if (!advanced.decision || mode !== "apply") {
      return {
        mode,
        activeTargetId: advanced.state.active_target_id,
        decision: advanced.decision,
        reason: advanced.reason,
        observations
      };
    }

    const fromTarget = config.targetById.get(advanced.decision.from);
    const toTarget = config.targetById.get(advanced.decision.to);
    const decisionTimeMs = currentTimeMs();
    const activationAttestation = assertStandbyActivationAttestation(
      config,
      toTarget.id,
      { nowMs: decisionTimeMs }
    );
    const committed = commitSwitch(
      advanced.state,
      advanced.decision,
      config,
      decisionTimeMs
    );
    const ensureTargetCurrent = () => ensureConfigCurrent({
      targetId: toTarget.id,
      attestationObservedAt: activationAttestation.observed_at
    });
    const journalDocument = createPendingJournal(
      config,
      advanced.state,
      committed,
      advanced.decision,
      decisionTimeMs
    );
    await writePendingJournalAtomic(journalFile, journalDocument, config);
    try {
      await ensureTargetCurrent();
    } catch (error) {
      await removeFileDurable(journalFile);
      throw error;
    }

    const updater = options.cloudflareUpdate || updateCloudflareRedirect;
    try {
      await updater({
        ...cloudflareOptions,
        expectedCurrentOrigin: fromTarget.origin,
        targetOrigin: toTarget.origin,
        beforePatch: ensureTargetCurrent,
        afterUpdate: ensureTargetCurrent
      });
    } catch (error) {
      if (error.code !== "CF_UPDATE_ROLLED_BACK") throw error;
      const reconciled = await reconcilePendingJournal({
        ...options,
        config,
        journal: journalDocument,
        previous: advanced.state,
        stateFile,
        journalFile,
        mode,
        cloudflareOptions,
        ensureConfigCurrent
      });
      return { ...reconciled, observations };
    }

    await ensureTargetCurrent();
    await writeStateAtomic(stateFile, committed, config);
    await removeFileDurable(journalFile);
    return {
      mode,
      activeTargetId: committed.active_target_id,
      decision: advanced.decision,
      reason: "failover_committed",
      observations
    };
  }, options.lockOptions);
}

function safeSummary(result) {
  return {
    event: "domain_gateway_monitor_cycle",
    mode: result.mode,
    active_target_id: result.activeTargetId,
    decision: result.decision,
    reason: result.reason,
    health: Object.fromEntries(Object.entries(result.observations || {}).map(([id, observation]) => [
      id,
      {
        healthy: observation.healthy,
        indeterminate: observation.indeterminate === true,
        evidence_count: observation.evidenceCount
      }
    ]))
  };
}

function isPermanentMonitorError(error) {
  return new Set([
    "CONFIG_INVALID",
    "STATE_INVALID",
    "JOURNAL_INVALID",
    "LOCK_INVALID",
    "CF_IDENTITY_MISMATCH",
    "CF_TARGET_MISMATCH",
    "CF_CONCURRENT_CHANGE",
    "CF_UPDATE_UNCERTAIN",
    "MANUAL_ACTION_REQUIRED"
  ]).has(error?.code);
}

function boundedErrorDetails(error) {
  const code = typeof error?.code === "string" && error.code
    ? error.code
    : "UNCLASSIFIED";
  const message = typeof error?.message === "string" && error.message
    ? error.message
    : "monitor cycle failed";
  return {
    code: code.slice(0, ERROR_CODE_MAX_LENGTH),
    message: message.slice(0, ERROR_MESSAGE_MAX_LENGTH)
  };
}

async function writeMonitorHealth(filePath, status, details = {}) {
  await writeJsonAtomic(filePath, {
    version: 1,
    status,
    mode: monitorMode(details.mode),
    active_target_id: details.activeTargetId || null,
    reason: details.reason || null,
    error_code: details.errorCode || null,
    updated_at: new Date().toISOString()
  }, {
    mode: 0o600,
    errorCode: "MONITOR_HEALTH_WRITE_FAILED",
    label: "monitor health"
  });
}

function schedule(options = {}) {
  const healthFile = options.healthFile || HEALTH_FILE;
  const setTimer = options.setTimer || setTimeout;
  const cycleRunner = options.cycleRunner || runCycle;
  const logger = options.logger || console;
  let lastErrorKey = null;
  const tick = async () => {
    try {
      const result = await cycleRunner(options);
      logger.log(JSON.stringify(safeSummary(result)));
      await writeMonitorHealth(healthFile, "ok", result);
      lastErrorKey = null;
    } catch (error) {
      const details = boundedErrorDetails(error);
      const errorKey = `${details.code}\n${details.message}`;
      if (errorKey !== lastErrorKey) {
        logger.error(JSON.stringify({
          event: "domain_gateway_monitor_failed",
          status: "degraded",
          code: details.code,
          error: details.message,
          operator_action_required: isPermanentMonitorError(error)
        }));
      }
      lastErrorKey = errorKey;
      await writeMonitorHealth(healthFile, "degraded", {
        mode: options.mode,
        reason: details.message,
        errorCode: details.code
      }).catch((healthError) => {
        const healthDetails = boundedErrorDetails(healthError);
        logger.error(JSON.stringify({
          event: "domain_gateway_monitor_health_write_failed",
          code: healthDetails.code
        }));
      });
    }
    setTimer(tick, LOOP_MS);
  };
  void tick();
}

if (require.main === module) {
  try {
    assertRuntimeUser();
    schedule();
  } catch (error) {
    console.error(JSON.stringify({
      event: "domain_gateway_monitor_start_failed",
      code: error.code || "UNCLASSIFIED",
      error: error.message
    }));
    process.exitCode = 78;
  }
}

module.exports = {
  HEALTH_FILE,
  JOURNAL_FILE,
  LOOP_MS,
  boundedErrorDetails,
  cloudflareRuntimeOptions,
  collectMonitoringEvidence,
  evaluateAllTargets,
  isPermanentMonitorError,
  monitorMode,
  reconcilePendingJournal,
  runCycle,
  safeSummary,
  schedule,
  writeMonitorHealth
};
