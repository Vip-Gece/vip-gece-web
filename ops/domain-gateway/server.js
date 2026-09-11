"use strict";

const http = require("node:http");
const path = require("node:path");
const {
  assertRuntimeUser,
  buildRedirectLocation,
  loadTargetsConfig,
  readPendingJournal,
  readState
} = require("./core");

const HOST = "127.0.0.1";
const PORT = 3004;
const TARGETS_FILE = process.env.DOMAIN_GATEWAY_TARGETS_FILE || path.join(__dirname, "targets.json");
const STATE_FILE = process.env.DOMAIN_GATEWAY_STATE_FILE || path.join(__dirname, "state", "state.json");
const JOURNAL_FILE = process.env.DOMAIN_GATEWAY_JOURNAL_FILE || path.join(__dirname, "state", "pending-switch.json");

function configOwnerUid(value = process.env.DOMAIN_GATEWAY_CONFIG_OWNER_UID) {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(String(value))) {
    const error = new Error("DOMAIN_GATEWAY_CONFIG_OWNER_UID is invalid");
    error.code = "CONFIG_INVALID";
    throw error;
  }
  return Number(value);
}

function unavailable(response, status = 503, message = "Domain gateway temporarily unavailable\n") {
  response.writeHead(status, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "text/plain; charset=utf-8",
    "Retry-After": "60"
  });
  response.end(message);
}

function createGatewayServer(configOrProvider, stateFile = STATE_FILE, journalFile = JOURNAL_FILE) {
  const provider = typeof configOrProvider === "function"
    ? configOrProvider
    : async () => configOrProvider;
  const server = http.createServer(async (request, response) => {
    try {
      const config = await provider();
      const pendingBefore = await readPendingJournal(journalFile, config, { allowMissing: true });
      if (pendingBefore) {
        unavailable(response);
        return;
      }
      await readState(stateFile, config);
      const pendingDuring = await readPendingJournal(journalFile, config, { allowMissing: true });
      if (pendingDuring) {
        unavailable(response);
        return;
      }
      const state = await readState(stateFile, config);
      const pendingAfter = await readPendingJournal(journalFile, config, { allowMissing: true });
      if (pendingAfter) {
        unavailable(response);
        return;
      }
      const target = config.targetById.get(state.active_target_id);
      const location = target?.enabled ? buildRedirectLocation(target.origin, request.url) : "";
      if (!location) {
        unavailable(response, 400, "Invalid request target\n");
        return;
      }

      response.writeHead(301, {
        "Cache-Control": "public, max-age=300",
        Location: location
      });
      response.end();
    } catch {
      unavailable(response);
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}

async function start() {
  assertRuntimeUser();
  const ownerUid = configOwnerUid();
  const provider = () => loadTargetsConfig(TARGETS_FILE, {
    ownerUid,
    requireFreshness: false
  });
  await provider();
  const server = createGatewayServer(provider, STATE_FILE, JOURNAL_FILE);
  server.listen(PORT, HOST, () => {
    console.log(JSON.stringify({ event: "domain_gateway_listening", host: HOST, port: PORT }));
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(JSON.stringify({ event: "domain_gateway_start_failed", error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = {
  HOST,
  JOURNAL_FILE,
  PORT,
  configOwnerUid,
  createGatewayServer,
  start,
  unavailable
};
