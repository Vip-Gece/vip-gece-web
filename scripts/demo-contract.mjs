import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getDemoProfiles, shouldUseDemoProfiles } = require("../src/data/demoProfiles.js");

const originalNodeEnv = process.env.NODE_ENV;
const originalEnableDemoProfiles = process.env.ENABLE_DEMO_PROFILES;
const failures = [];

function setEnv(nodeEnv, enableDemoProfiles) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;

  if (enableDemoProfiles === undefined) delete process.env.ENABLE_DEMO_PROFILES;
  else process.env.ENABLE_DEMO_PROFILES = enableDemoProfiles;
}

function pass(message) {
  console.log(`ok ${message}`);
}

function fail(message) {
  failures.push(message);
  console.log(`fail ${message}`);
}

function assert(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

try {
  setEnv("production", undefined);
  assert(shouldUseDemoProfiles() === false, "production mode keeps demo fallback closed by default");

  setEnv("production", "false");
  assert(shouldUseDemoProfiles() === false, "production mode keeps demo fallback closed when explicitly false");

  setEnv("production", "true");
  assert(shouldUseDemoProfiles() === false, "production mode cannot expose demo profiles");

  setEnv(undefined, undefined);
  assert(shouldUseDemoProfiles() === false, "local demo fallback stays closed by default");

  setEnv("development", "true");
  assert(shouldUseDemoProfiles() === true, "development demo fallback requires explicit opt-in");

  const profiles = getDemoProfiles();
  assert(Array.isArray(profiles) && profiles.some((profile) => profile.slug === "ada-vip"), "demo profiles include ada-vip slug");
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalEnableDemoProfiles === undefined) delete process.env.ENABLE_DEMO_PROFILES;
  else process.env.ENABLE_DEMO_PROFILES = originalEnableDemoProfiles;
}

if (failures.length) {
  process.exitCode = 1;
}
