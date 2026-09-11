"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LOOP_MS, schedule } = require("../monitor");

test("persistent cycle errors remain degraded and retry without exiting", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "domain-monitor-schedule-"));
  const healthFile = path.join(directory, "monitor-health.json");
  const timers = [];
  const errors = [];
  const previousExitCode = process.exitCode;
  let cycles = 0;
  let firstTimerScheduled;
  const firstTimer = new Promise((resolve) => {
    firstTimerScheduled = resolve;
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  schedule({
    healthFile,
    cycleRunner: async () => {
      cycles += 1;
      const error = new Error("persistent failure ".repeat(200));
      error.code = "CONFIG_INVALID";
      throw error;
    },
    logger: {
      log() {},
      error(line) {
        errors.push(JSON.parse(line));
      }
    },
    setTimer(callback, delay) {
      timers.push({ callback, delay });
      firstTimerScheduled();
    }
  });

  await firstTimer;
  assert.equal(cycles, 1);
  assert.equal(timers[0].delay, LOOP_MS);
  assert.equal(process.exitCode, previousExitCode);

  const firstHealth = JSON.parse(await fs.readFile(healthFile, "utf8"));
  assert.equal(firstHealth.status, "degraded");
  assert.equal(firstHealth.error_code, "CONFIG_INVALID");
  assert.ok(firstHealth.reason.length <= 1024);
  assert.ok(errors[0].error.length <= 1024);
  assert.equal(errors[0].operator_action_required, true);

  await timers[0].callback();
  assert.equal(cycles, 2);
  assert.equal(timers[1].delay, LOOP_MS);
  assert.equal(process.exitCode, previousExitCode);
  assert.equal(errors.length, 1);
  assert.equal(
    JSON.parse(await fs.readFile(healthFile, "utf8")).status,
    "degraded"
  );
});
