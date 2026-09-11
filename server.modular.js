"use strict";

require("dotenv").config({
  path: process.env.DOTENV_CONFIG_PATH,
  override: true
});

const { PORT } = require("./src/config/env");
const { createApp } = require("./src/app");

const app = createApp();
const HOST = process.env.HOST || "127.0.0.1";

function runProfileExpiry() {
  if (process.env.ENABLE_PROFILE_EXPIRY !== "true") {
    return;
  }

  const { expireOldProfiles } = require("./src/data/profilesRepo");
  expireOldProfiles().catch((err) => {
    console.error("Expire profiles background error:", err);
  });
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Server çalışıyor: http://${HOST}:${PORT}`);
  setTimeout(runProfileExpiry, 1000);
  setInterval(runProfileExpiry, 1000 * 60 * 60);
});

server.on("error", (err) => {
  console.error("Server listen error:", err);
  process.exit(1);
});
