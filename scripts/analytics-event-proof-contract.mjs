import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

process.env.ANALYTICS_EVENT_PROOF_SECRET =
  "analytics-event-proof-contract-secret-20260728";

const require = createRequire(import.meta.url);
const {
  PROOF_TTL_SECONDS,
  createAnalyticsEventProof,
  mintAnalyticsEventProof,
  verifyAnalyticsEventProof
} = require("../src/services/analyticsEventProofService");
const { normalizeEvent } = require("../src/services/profileAnalyticsService");

const issuedAt = 1_800_000_000;
const eventId = "018f0d4a-7b4e-4d90-8f61-5ce4b1491f8b";
const otherEventId = "018f0d4a-7b4e-4d90-8f61-5ce4b1491f8c";
const viewProof = createAnalyticsEventProof("42", "profile_view", eventId, issuedAt);
assert.ok(viewProof);
assert.equal(
  verifyAnalyticsEventProof(viewProof, "42", "profile_view", eventId, issuedAt),
  true
);
assert.equal(
  verifyAnalyticsEventProof(viewProof, "43", "profile_view", eventId, issuedAt),
  false
);
assert.equal(
  verifyAnalyticsEventProof(viewProof, "42", "contact_click", eventId, issuedAt),
  false
);
assert.equal(
  verifyAnalyticsEventProof(viewProof, "42", "profile_view", otherEventId, issuedAt),
  false
);
assert.equal(
  verifyAnalyticsEventProof(
    viewProof,
    "42",
    "profile_view",
    eventId,
    issuedAt + PROOF_TTL_SECONDS + 1
  ),
  false
);
assert.equal(
  verifyAnalyticsEventProof(
    `${viewProof.slice(0, -1)}x`,
    "42",
    "profile_view",
    eventId,
    issuedAt
  ),
  false
);
const minted = mintAnalyticsEventProof("42", "contact_click", issuedAt);
assert.ok(minted);
assert.match(minted.event_id, /^[0-9a-f-]{36}$/);
assert.equal(minted.expires_at, issuedAt + PROOF_TTL_SECONDS);
assert.equal(
  verifyAnalyticsEventProof(
    minted.proof,
    "42",
    "contact_click",
    minted.event_id,
    issuedAt
  ),
  true
);
const demoMinted = mintAnalyticsEventProof("demo-ada", "profile_view", issuedAt);
assert.ok(demoMinted);
assert.equal(
  verifyAnalyticsEventProof(
    demoMinted.proof,
    "demo-ada",
    "profile_view",
    demoMinted.event_id,
    issuedAt
  ),
  true
);
assert.throws(
  () => normalizeEvent({
    event_type: "profile_view",
    profile_slug: "contract-profile",
    source: "direct",
    channel: "none",
    event_id: eventId
  }),
  (error) => error?.code === "INVALID_ANALYTICS_PROOF"
);
assert.throws(
  () => normalizeEvent({
    event_type: "profile_view",
    profile_slug: "contract-profile",
    source: "direct",
    channel: "none",
    proof: viewProof
  }),
  (error) => error?.code === "INVALID_ANALYTICS_EVENT"
);

const previousNodeEnv = process.env.NODE_ENV;
const previousProofSecret = process.env.ANALYTICS_EVENT_PROOF_SECRET;
const previousCustomerSecret = process.env.CUSTOMER_ACCESS_SESSION_SECRET;
process.env.NODE_ENV = "production";
delete process.env.ANALYTICS_EVENT_PROOF_SECRET;
process.env.CUSTOMER_ACCESS_SESSION_SECRET =
  "customer-session-secret-must-not-authorize-analytics-proof";
assert.throws(
  () => createAnalyticsEventProof("42", "profile_view", eventId, issuedAt),
  /ANALYTICS_EVENT_PROOF_SECRET/
);
if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previousNodeEnv;
process.env.ANALYTICS_EVENT_PROOF_SECRET = previousProofSecret;
if (previousCustomerSecret === undefined) delete process.env.CUSTOMER_ACCESS_SESSION_SECRET;
else process.env.CUSTOMER_ACCESS_SESSION_SECRET = previousCustomerSecret;

const rendererSource = await readFile(
  new URL("../src/services/render/detailRenderer.js", import.meta.url),
  "utf8"
);
const previewSource = await readFile(
  new URL("../src/routes/customerMobileRoutes.js", import.meta.url),
  "utf8"
);
const clientSource = await readFile(
  new URL("../public/js/detail/analytics.js", import.meta.url),
  "utf8"
);
const detailEntrySource = await readFile(
  new URL("../public/js/detail/index.js", import.meta.url),
  "utf8"
);
const serviceSource = await readFile(
  new URL("../src/services/profileAnalyticsService.js", import.meta.url),
  "utf8"
);
const publicRoutesSource = await readFile(
  new URL("../src/routes/publicRoutes.js", import.meta.url),
  "utf8"
);
const analyticsRoutesSource = await readFile(
  new URL("../src/routes/analyticsRoutes.js", import.meta.url),
  "utf8"
);
const proofServiceSource = await readFile(
  new URL("../src/services/analyticsEventProofService.js", import.meta.url),
  "utf8"
);

assert.doesNotMatch(rendererSource, /analytics-(?:view|contact)-proof/i);
assert.doesNotMatch(rendererSource, /createAnalyticsEventProof/);
assert.doesNotMatch(previewSource, /includeAnalyticsProofs:\s*true/);
assert.doesNotMatch(clientSource, /dataset\.analytics(?:View|Contact)Proof/);
assert.match(clientSource, /fetch\("\/api\/analytics\/event-proof"/);
assert.match(clientSource, /event_id:\s*proofPair\.event_id/);
assert.match(clientSource, /keepalive:\s*true/);
assert.match(detailEntrySource, /analytics\.js\?v=20260728-proof2/);
assert.match(
  serviceSource,
  /verifyAnalyticsEventProof\(event\.proof,\s*profile\.id,\s*event\.eventType,\s*event\.eventId\)/
);
assert.doesNotMatch(publicRoutesSource, /setProofBoundHtmlCache/);
assert.doesNotMatch(publicRoutesSource, /includeAnalyticsProofs:\s*true/);
assert.match(
  analyticsRoutesSource,
  /router\.post\("\/api\/analytics\/event-proof",\s*noStore,\s*mintLimiter/
);
assert.match(analyticsRoutesSource, /mintAnalyticsEventProof\(profile\.id,\s*eventType\)/);
assert.match(
  proofServiceSource,
  /configured === customerSessionSecret/
);
assert.match(proofServiceSource, /if \(process\.env\.NODE_ENV === "production"\) proofSecret\(\)/);

const equalityCheck = `
  process.env.NODE_ENV = "production";
  process.env.ANALYTICS_EVENT_PROOF_SECRET = "same-production-secret-value-123456789";
  process.env.CUSTOMER_ACCESS_SESSION_SECRET = "same-production-secret-value-123456789";
  require("./src/services/analyticsEventProofService");
`;
const { spawnSync } = await import("node:child_process");
const equalityResult = spawnSync(process.execPath, ["-e", equalityCheck], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8"
});
assert.notEqual(equalityResult.status, 0);
assert.match(
  `${equalityResult.stdout}\n${equalityResult.stderr}`,
  /must be independent/
);

console.log("analytics event proof contract: ok");
