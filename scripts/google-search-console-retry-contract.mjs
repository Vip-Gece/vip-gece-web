"use strict";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

process.env.SITE_URL = "https://vip-gece.site";
process.env.GOOGLE_SEARCH_CONSOLE_ENABLED = "true";
process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = "sc-domain:vip-gece.site";
process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON = JSON.stringify({
  type: "service_account",
  client_email: "gsc-contract@example.invalid",
  private_key: privateKey
});

let tokenRequests = 0;
let inspectionRequests = 0;
let mode = "retry-timeout";

global.fetch = async (url) => {
  const target = String(url);
  if (target === "https://oauth2.googleapis.com/token") {
    tokenRequests += 1;
    return new Response(JSON.stringify({ access_token: "contract-token", expires_in: 3600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  assert.equal(target, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect");
  inspectionRequests += 1;
  if (mode === "retry-timeout" && inspectionRequests === 1) {
    const error = new Error("contract timeout");
    error.name = "AbortError";
    throw error;
  }
  if (mode === "forbidden") {
    return new Response(JSON.stringify({ error: { message: "forbidden" } }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({
    inspectionResult: {
      indexStatusResult: {
        verdict: "NEUTRAL",
        indexingState: "INDEXING_ALLOWED",
        pageFetchState: "SUCCESSFUL"
      }
    }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const { inspectUrl } = require("../src/services/googleSearchConsoleService");
const recovered = await inspectUrl("/istanbul-escort", {
  inspectionAttempts: 2,
  inspectionRetryBaseDelayMs: 0
});

assert.equal(tokenRequests, 1);
assert.equal(inspectionRequests, 2);
assert.equal(recovered.ok, true);
assert.equal(recovered.inspection_attempts, 2);
assert.equal(recovered.verdict, "NEUTRAL");

mode = "forbidden";
inspectionRequests = 0;
await assert.rejects(
  inspectUrl("/sisli-escort", {
    inspectionAttempts: 4,
    inspectionRetryBaseDelayMs: 0
  }),
  (error) => {
    assert.equal(error.googleStatus, 403);
    assert.equal(error.inspectionAttempts, 1);
    return true;
  }
);
assert.equal(inspectionRequests, 1);

console.log("Google Search Console transient retry contract: ok");
