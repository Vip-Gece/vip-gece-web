#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const INPUT_LIMIT_BYTES = 32 * 1024;
const CONFIG_LIMIT_BYTES = 64 * 1024;
const SPOOL_LIMIT_BYTES = 64 * 1024;
const INPUT_TIMEOUT_MS = 10 * 1000;
const MAX_AGE_MS = 120 * 1000;
const MAX_FUTURE_MS = 30 * 1000;
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const TARGET_URL_BY_ID = Object.freeze({
  'vip-gece-site': 'https://vip-gece.site/api/ready',
  'vip-gece-online': 'https://vip-gece.online/api/ready',
});

const REPORT_KEYS = [
  'schema_version',
  'config_version',
  'probe_id',
  'nonce',
  'observed_at',
  'observations',
];

const OBSERVATION_KEYS = [
  'target_id',
  'url',
  'http_status',
  'tls_verified',
  'hostname_verified',
  'redirect_followed',
  'expected_server',
  'server_header_match',
  'cf_ray_present',
  'contract_ok',
  'edge_reachable',
  'duration_ms',
  'result_code',
];

const STORED_KEYS = [...REPORT_KEYS, 'received_at', 'payload_sha256'];

class RejectError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RejectError';
    this.code = code;
  }
}

function reject(code) {
  throw new RejectError(code);
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function isIntegerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isSafeId(value) {
  return typeof value === 'string' &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function parseUtcSecond(value, code = 'timestamp_invalid') {
  if (typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    reject(code);
  }

  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value.replace('Z', '.000Z')) {
    reject(code);
  }

  return milliseconds;
}

function parseStrictJson(text, code) {
  try {
    return JSON.parse(text);
  } catch {
    reject(code);
  }
}

function validateTargetUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      parsed.pathname === '/api/ready' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      value === `https://${parsed.hostname}/api/ready`;
  } catch {
    return false;
  }
}

function assertSecureRegularFile(filePath, stats, ownerUid, codePrefix) {
  if (!stats.isFile()) {
    reject(`${codePrefix}_not_regular`);
  }
  if ((stats.mode & 0o022) !== 0) {
    reject(`${codePrefix}_mode_unsafe`);
  }
  if (ownerUid !== null && stats.uid !== ownerUid) {
    reject(`${codePrefix}_owner_invalid`);
  }
}

function secureReadFile(filePath, maximumBytes, ownerUid, codePrefix) {
  let linkStats;
  try {
    linkStats = fs.lstatSync(filePath);
  } catch {
    reject(`${codePrefix}_unavailable`);
  }
  if (linkStats.isSymbolicLink()) {
    reject(`${codePrefix}_symlink`);
  }

  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | NOFOLLOW);
    const stats = fs.fstatSync(descriptor);
    assertSecureRegularFile(filePath, stats, ownerUid, codePrefix);
    if (stats.size > maximumBytes) {
      reject(`${codePrefix}_too_large`);
    }
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length > maximumBytes) {
      reject(`${codePrefix}_too_large`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof RejectError) {
      throw error;
    }
    reject(`${codePrefix}_unavailable`);
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The fixed rejection path below never exposes the raw filesystem error.
      }
    }
  }
}

function validateConfig(config, expectedProbeId) {
  if (!hasExactKeys(config, [
    'schema_version',
    'config_version',
    'probe_id',
    'targets',
  ])) {
    reject('config_schema_invalid');
  }
  if (config.schema_version !== 1 ||
    !isIntegerInRange(config.config_version, 1, Number.MAX_SAFE_INTEGER) ||
    !isSafeId(config.probe_id) ||
    config.probe_id !== expectedProbeId ||
    !Array.isArray(config.targets) ||
    config.targets.length === 0) {
    reject('config_schema_invalid');
  }

  const ids = new Set();
  const urls = new Set();
  let enabledCount = 0;

  for (const target of config.targets) {
    if (!hasExactKeys(target, ['id', 'url', 'enabled', 'expected_server']) ||
      !isSafeId(target.id) ||
      !validateTargetUrl(target.url) ||
      TARGET_URL_BY_ID[target.id] !== target.url ||
      typeof target.enabled !== 'boolean' ||
      target.expected_server !== 'cloudflare' ||
      ids.has(target.id) ||
      urls.has(target.url)) {
      reject('config_schema_invalid');
    }
    ids.add(target.id);
    urls.add(target.url);
    if (target.enabled) {
      enabledCount += 1;
    }
  }

  if (enabledCount === 0) {
    reject('config_schema_invalid');
  }

  return config;
}

function expectedResultCode(observation, edgeReachable) {
  if (edgeReachable &&
    observation.http_status === 200 &&
    observation.contract_ok) {
    return 'edge_reachable_ready';
  }
  if (edgeReachable && observation.http_status === 403) {
    return 'edge_reachable_http_403';
  }
  if (edgeReachable && observation.http_status === 200) {
    return 'ready_contract_invalid';
  }
  if (!observation.tls_verified || !observation.hostname_verified) {
    return 'tls_or_transport_failed';
  }
  if (observation.redirect_followed ||
    !observation.server_header_match ||
    !observation.cf_ray_present) {
    return 'edge_identity_failed';
  }
  return 'http_status_unaccepted';
}

function validateObservationShape(observation, code = 'observation_invalid') {
  if (!hasExactKeys(observation, OBSERVATION_KEYS) ||
    !isSafeId(observation.target_id) ||
    typeof observation.url !== 'string' ||
    !isIntegerInRange(observation.http_status, 0, 599) ||
    typeof observation.tls_verified !== 'boolean' ||
    typeof observation.hostname_verified !== 'boolean' ||
    typeof observation.redirect_followed !== 'boolean' ||
    observation.expected_server !== 'cloudflare' ||
    typeof observation.server_header_match !== 'boolean' ||
    typeof observation.cf_ray_present !== 'boolean' ||
    typeof observation.contract_ok !== 'boolean' ||
    typeof observation.edge_reachable !== 'boolean' ||
    !isIntegerInRange(observation.duration_ms, 0, 60 * 1000) ||
    typeof observation.result_code !== 'string') {
    reject(code);
  }
  if (observation.hostname_verified && !observation.tls_verified) {
    reject(code);
  }
  if (observation.contract_ok && observation.http_status !== 200) {
    reject(code);
  }
}

function validateReport(report, config) {
  if (!hasExactKeys(report, REPORT_KEYS) ||
    report.schema_version !== 1 ||
    report.config_version !== config.config_version ||
    report.probe_id !== config.probe_id ||
    typeof report.nonce !== 'string' ||
    !/^[0-9a-f]{32}$/.test(report.nonce) ||
    !Array.isArray(report.observations)) {
    reject('report_schema_invalid');
  }

  parseUtcSecond(report.observed_at);

  const enabledTargets = config.targets.filter((target) => target.enabled);
  if (report.observations.length !== enabledTargets.length) {
    reject('target_set_invalid');
  }

  const byId = new Map(enabledTargets.map((target) => [target.id, target]));
  const seen = new Set();

  for (const observation of report.observations) {
    validateObservationShape(observation);
    const target = byId.get(observation.target_id);
    if (!target || seen.has(observation.target_id)) {
      reject('target_set_invalid');
    }
    if (observation.url !== target.url ||
      observation.expected_server !== target.expected_server) {
      reject('target_binding_invalid');
    }
    seen.add(observation.target_id);

    const edgeReachable = observation.tls_verified &&
      observation.hostname_verified &&
      !observation.redirect_followed &&
      (observation.http_status === 200 || observation.http_status === 403) &&
      observation.expected_server === 'cloudflare' &&
      observation.server_header_match &&
      observation.cf_ray_present;

    if (observation.edge_reachable !== edgeReachable) {
      reject('edge_evidence_inconsistent');
    }
    if (observation.result_code !==
      expectedResultCode(observation, edgeReachable)) {
      reject('result_code_inconsistent');
    }
  }

  return report;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function payloadHash(report) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(report)))
    .digest('hex');
}

function validateStoredSnapshot(snapshot) {
  if (!hasExactKeys(snapshot, STORED_KEYS) ||
    snapshot.schema_version !== 1 ||
    !isIntegerInRange(snapshot.config_version, 1, Number.MAX_SAFE_INTEGER) ||
    !isSafeId(snapshot.probe_id) ||
    typeof snapshot.nonce !== 'string' ||
    !/^[0-9a-f]{32}$/.test(snapshot.nonce) ||
    !Array.isArray(snapshot.observations) ||
    typeof snapshot.payload_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(snapshot.payload_sha256)) {
    reject('spool_schema_invalid');
  }
  parseUtcSecond(snapshot.observed_at, 'spool_schema_invalid');
  parseUtcSecond(snapshot.received_at, 'spool_schema_invalid');
  for (const observation of snapshot.observations) {
    validateObservationShape(observation, 'spool_schema_invalid');
  }
  return snapshot;
}

function loadExistingSnapshot(spoolPath) {
  try {
    const stats = fs.lstatSync(spoolPath);
    if (stats.isSymbolicLink()) {
      reject('spool_symlink');
    }
  } catch (error) {
    if (error instanceof RejectError) {
      throw error;
    }
    if (error && error.code === 'ENOENT') {
      return null;
    }
    reject('spool_unavailable');
  }
  const bytes = secureReadFile(
    spoolPath,
    SPOOL_LIMIT_BYTES,
    null,
    'spool',
  );
  return validateStoredSnapshot(
    parseStrictJson(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      'spool_schema_invalid',
    ),
  );
}

function assertSafeSpoolDirectory(spoolPath) {
  const directory = path.dirname(spoolPath);
  let stats;
  try {
    stats = fs.lstatSync(directory);
  } catch {
    reject('spool_directory_unavailable');
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    reject('spool_directory_invalid');
  }
  if ((stats.mode & 0o002) !== 0) {
    reject('spool_directory_mode_unsafe');
  }
  return directory;
}

function atomicWriteSnapshot(spoolPath, snapshot) {
  const directory = assertSafeSpoolDirectory(spoolPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(spoolPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  const bytes = Buffer.from(`${JSON.stringify(snapshot)}\n`, 'utf8');
  if (bytes.length > SPOOL_LIMIT_BYTES) {
    reject('spool_too_large');
  }

  let descriptor;
  let renamed = false;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        NOFOLLOW,
      0o640,
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fchmodSync(descriptor, 0o640);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    fs.renameSync(temporaryPath, spoolPath);
    renamed = true;

    const directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the fixed error surface.
      }
    }
    if (!renamed) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The file may not have been created.
      }
    }
    if (error instanceof RejectError) {
      throw error;
    }
    reject('spool_write_failed');
  }
}

function parseArguments(argv) {
  const options = {
    probeId: 'tr-mac-01',
    config: '/etc/vip-gece-domain-gateway/probe-targets.json',
    spool: '/var/lib/vip-gece-domain-gateway/probes/tr-mac-01/latest.json',
    configOwnerUid: 0,
  };
  const known = new Set([
    'probe-id',
    'config',
    'spool',
    'config-owner-uid',
  ]);
  const seen = new Set();

  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match || !known.has(match[1]) || seen.has(match[1])) {
      reject('arguments_invalid');
    }
    const [, name, value] = match;
    seen.add(name);
    if (name === 'probe-id') {
      options.probeId = value;
    } else if (name === 'config') {
      options.config = value;
    } else if (name === 'spool') {
      options.spool = value;
    } else if (name === 'config-owner-uid') {
      if (!/^\d+$/.test(value)) {
        reject('arguments_invalid');
      }
      options.configOwnerUid = Number(value);
    }
  }

  if (!isSafeId(options.probeId) ||
    !path.isAbsolute(options.config) ||
    !path.isAbsolute(options.spool) ||
    !Number.isSafeInteger(options.configOwnerUid) ||
    options.configOwnerUid < 0) {
    reject('arguments_invalid');
  }

  return options;
}

function readStdin() {
  return new Promise((resolve, rejectPromise) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectPromise(new RejectError('input_timeout'));
      }
    }, INPUT_TIMEOUT_MS);

    process.stdin.on('data', (chunk) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > INPUT_LIMIT_BYTES) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new RejectError('input_too_large'));
        process.stdin.pause();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      }
    });
    process.stdin.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(new RejectError('input_unavailable'));
      }
    });
    process.stdin.resume();
  });
}

function acquireLock(spoolPath) {
  const lockPath = `${spoolPath}.lock`;
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') {
      reject('ingest_busy');
    }

    let stats;
    try {
      stats = fs.lstatSync(lockPath);
    } catch {
      reject('ingest_busy');
    }
    if (!stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (stats.mode & 0o077) !== 0 ||
      Date.now() - stats.mtimeMs <= 30 * 1000) {
      reject('ingest_busy');
    }

    try {
      fs.rmdirSync(lockPath);
      fs.mkdirSync(lockPath, { mode: 0o700 });
    } catch {
      reject('ingest_busy');
    }
  }
  return () => {
    try {
      fs.rmdirSync(lockPath);
    } catch {
      // A stale lock is safer than deleting an unexpected filesystem object.
    }
  };
}

async function run() {
  if (process.env.SSH_ORIGINAL_COMMAND !== 'submit-v1') {
    reject('original_command_invalid');
  }

  const options = parseArguments(process.argv.slice(2));
  const configBytes = secureReadFile(
    options.config,
    CONFIG_LIMIT_BYTES,
    options.configOwnerUid,
    'config',
  );
  let configText;
  try {
    configText = new TextDecoder('utf-8', { fatal: true }).decode(configBytes);
  } catch {
    reject('config_encoding_invalid');
  }
  const config = validateConfig(
    parseStrictJson(configText, 'config_schema_invalid'),
    options.probeId,
  );

  const input = await readStdin();
  let inputText;
  try {
    inputText = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    reject('input_encoding_invalid');
  }
  const report = validateReport(
    parseStrictJson(inputText, 'report_json_invalid'),
    config,
  );
  const hash = payloadHash(report);

  assertSafeSpoolDirectory(options.spool);
  const releaseLock = acquireLock(options.spool);
  try {
    const existing = loadExistingSnapshot(options.spool);
    if (existing && existing.nonce === report.nonce) {
      if (existing.payload_sha256 === hash) {
        process.stdout.write('already_accepted\n');
        return;
      }
      reject('replay_conflict');
    }

    const observedMilliseconds = parseUtcSecond(report.observed_at);
    if (existing) {
      const previousObservedMilliseconds =
        parseUtcSecond(existing.observed_at, 'spool_schema_invalid');
      if (observedMilliseconds <= previousObservedMilliseconds) {
        reject('out_of_order');
      }
    }

    const now = Date.now();
    if (observedMilliseconds < now - MAX_AGE_MS) {
      reject('report_stale');
    }
    if (observedMilliseconds > now + MAX_FUTURE_MS) {
      reject('report_from_future');
    }

    const snapshot = {
      ...report,
      received_at: new Date(Math.floor(now / 1000) * 1000)
        .toISOString()
        .replace('.000Z', 'Z'),
      payload_sha256: hash,
    };
    atomicWriteSnapshot(options.spool, snapshot);
    process.stdout.write('accepted\n');
  } finally {
    releaseLock();
  }
}

async function main() {
  process.umask(0o027);
  try {
    await run();
  } catch (error) {
    const code = error instanceof RejectError &&
      /^[a-z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'internal_error';
    process.stderr.write(`rejected code=${code}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  OBSERVATION_KEYS,
  REPORT_KEYS,
  RejectError,
  canonicalize,
  expectedResultCode,
  hasExactKeys,
  payloadHash,
  validateConfig,
  validateReport,
};
