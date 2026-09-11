#!/usr/bin/env bash
set -Eeuo pipefail

if curl --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:3003/api/ready >/dev/null; then
  exit 0
fi

logger --tag vip-gece-healthcheck "Readiness failed; restarting PM2 service"
systemctl restart pm2-deploy.service
sleep 5
curl --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:3003/api/ready >/dev/null
