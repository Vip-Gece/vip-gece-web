"use strict";

const runtimeUser = "vipgateway";
const stateDirectory = "/var/lib/vip-gece-domain-gateway";
const requestedMode = process.env.DOMAIN_GATEWAY_MODE === "apply" ? "apply" : "observe";
const applyArmed = process.env.DOMAIN_GATEWAY_APPLY_ARMED === "1" ? "1" : "0";
const externalProbeOwnerUid = process.env.DOMAIN_GATEWAY_EXTERNAL_PROBE_OWNER_UID;
const sharedEnv = {
  NODE_ENV: "production",
  DOMAIN_GATEWAY_EXPECTED_OS_USER: runtimeUser,
  DOMAIN_GATEWAY_CONFIG_OWNER_UID: "0",
  DOMAIN_GATEWAY_TARGETS_FILE: `${__dirname}/targets.json`,
  DOMAIN_GATEWAY_STATE_FILE: `${stateDirectory}/state.json`,
  DOMAIN_GATEWAY_JOURNAL_FILE: `${stateDirectory}/pending-switch.json`
};

module.exports = {
  apps: [
    {
      name: "vip-gece-domain-gateway",
      script: "./server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      min_uptime: "30s",
      max_restarts: 5,
      restart_delay: 5000,
      max_memory_restart: "128M",
      env: {
        ...sharedEnv
      }
    },
    {
      name: "vip-gece-domain-monitor",
      script: "./monitor.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      min_uptime: "30s",
      max_restarts: 5,
      restart_delay: 5000,
      max_memory_restart: "128M",
      env: {
        ...sharedEnv,
        DOMAIN_GATEWAY_MODE: requestedMode,
        DOMAIN_GATEWAY_APPLY_ARMED: applyArmed,
        DOMAIN_GATEWAY_LOCK_FILE: `${stateDirectory}/monitor.lock`,
        DOMAIN_GATEWAY_MONITOR_HEALTH_FILE: `${stateDirectory}/monitor-health.json`,
        DOMAIN_GATEWAY_EXTERNAL_PROBE_SNAPSHOT_FILE:
          `${stateDirectory}/probes/tr-mac-01/latest.json`,
        DOMAIN_GATEWAY_EXTERNAL_PROBE_ID: "tr-mac-01",
        DOMAIN_GATEWAY_EXTERNAL_PROBE_CONFIG_VERSION: "1",
        ...(externalProbeOwnerUid
          ? { DOMAIN_GATEWAY_EXTERNAL_PROBE_OWNER_UID: externalProbeOwnerUid }
          : {}),
        DOMAIN_GATEWAY_LOCAL_READINESS_URL: "http://127.0.0.1:3003/api/ready",
        CLOUDFLARE_API_TOKEN_FILE: "/etc/vip-gece-domain-gateway/cloudflare.token",
        CLOUDFLARE_ZONE_ID: "6cf7084baa8c98340aa415c4c470cb5b",
        CLOUDFLARE_REDIRECT_RULESET_ID: "587f807b93ea42b9837dd5859ebc3a08",
        CLOUDFLARE_REDIRECT_RULE_ID: "e9500f4e5d8f4d808417693b81d64a43",
        CLOUDFLARE_EXPECTED_ZONE_NAME: "vip-gece.com",
        CLOUDFLARE_EXPECTED_RULE_REF: "e9500f4e5d8f4d808417693b81d64a43",
        CLOUDFLARE_EXPECTED_RULE_EXPRESSION: "(http.host in {\"vip-gece.com\" \"www.vip-gece.com\"})"
      }
    }
  ]
};
