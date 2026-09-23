#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly BACKUP_DIR="/var/backups/vip-gece"
readonly APP_ROOT="/var/www/vip-gece-site"
readonly IMAGE_ROOT="/var/lib/vip-gece/customer-profile-images"
readonly ORIGINAL_ROOT="/var/lib/vip-gece/customer-profile-originals"
readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
readonly DB_RUNTIME_DIR="/run/vip-gece-backup"

mkdir -p "$BACKUP_DIR"
readonly WORK_DIR="$(mktemp -d "${BACKUP_DIR}/.backup-${STAMP}.XXXXXX")"

cleanup() {
  rm -rf "$WORK_DIR"
  rm -f "$DB_RUNTIME_DIR/pg_service.conf" "$DB_RUNTIME_DIR/pgpass"
}
trap cleanup EXIT

tar --create --gzip --file "$WORK_DIR/app-${STAMP}.tar.gz" \
  --directory "$APP_ROOT/current" \
  --exclude='./node_modules' \
  --exclude='./.git' \
  .

tar --create --gzip --file "$WORK_DIR/images-${STAMP}.tar.gz" \
  --directory "$(dirname "$IMAGE_ROOT")" \
  "$(basename "$IMAGE_ROOT")"

# Originals and their upload journals are independent of public display images.
if [[ -d "$ORIGINAL_ROOT" ]]; then
  tar --create --gzip --file "$WORK_DIR/originals-${STAMP}.tar.gz" \
    --directory "$(dirname "$ORIGINAL_ROOT")" \
    "$(basename "$ORIGINAL_ROOT")"
fi

tar --create --gzip --file "$WORK_DIR/config-${STAMP}.tar.gz" \
  --absolute-names \
  "$APP_ROOT/.env" \
  "$APP_ROOT/ecosystem.config.cjs" \
  /etc/nginx/sites-available/vip-gece-ssl.conf \
  /etc/nginx/snippets/vip-gece-cloudflare-only.conf \
  /etc/nginx/snippets/vip-gece-route.conf \
  /etc/nginx/ssl/vip-gece.pem \
  /etc/nginx/ssl/vip-gece.key \
  /etc/ssh/sshd_config.d/99-vip-gece-hardening.conf \
  /etc/fail2ban/jail.local \
  /var/www/vip-gece-maintenance/index.html

# Kritik runtime kimlik/anahtar durumu (root-only yedek; 2026-09-23 eklendi).
tar --create --gzip --file "$WORK_DIR/secrets-${STAMP}.tar.gz" \
  --absolute-names \
  /var/lib/vip-gece/signing \
  /var/lib/vip-gece/customer-mobile-accounts.json \
  /var/lib/vip-gece/google-search-console-credential.json \
  /var/lib/vip-gece/indexnow-state.json

mkdir -p "$DB_RUNTIME_DIR"
BACKUP_APP_ROOT="$APP_ROOT" BACKUP_DB_RUNTIME_DIR="$DB_RUNTIME_DIR" node <<'NODE'
const fs = require("fs");
const path = require("path");

const appRoot = process.env.BACKUP_APP_ROOT;
const runtimeDir = process.env.BACKUP_DB_RUNTIME_DIR;
const dotenv = require(path.join(appRoot, "current/node_modules/dotenv"));
const env = dotenv.parse(fs.readFileSync(path.join(appRoot, ".env")));
const databaseUrl = new URL(env.DATABASE_URL);
const host = databaseUrl.hostname;
const port = databaseUrl.port || "5432";
const database = databaseUrl.pathname.replace(/^\//, "");
const user = decodeURIComponent(databaseUrl.username);
const password = decodeURIComponent(databaseUrl.password)
  .replace(/\\/g, "\\\\")
  .replace(/:/g, "\\:");

fs.writeFileSync(
  path.join(runtimeDir, "pg_service.conf"),
  `[vip_gece]\nhost=${host}\nport=${port}\ndbname=${database}\nuser=${user}\nsslmode=require\n`,
  { mode: 0o600 }
);
fs.writeFileSync(
  path.join(runtimeDir, "pgpass"),
  `${host}:${port}:${database}:${user}:${password}\n`,
  { mode: 0o600 }
);
NODE

PGSERVICEFILE="$DB_RUNTIME_DIR/pg_service.conf" \
PGPASSFILE="$DB_RUNTIME_DIR/pgpass" \
pg_dump --dbname="service=vip_gece" --format=custom --no-owner --no-privileges \
  --file="$WORK_DIR/database-${STAMP}.dump"

gzip --test "$WORK_DIR"/*.tar.gz
pg_restore --list "$WORK_DIR/database-${STAMP}.dump" >/dev/null
(
  cd "$WORK_DIR"
  sha256sum ./*.tar.gz ./*.dump > SHA256SUMS
)

for file in "$WORK_DIR"/*; do
  mv "$file" "$BACKUP_DIR/"
done

find "$BACKUP_DIR" -maxdepth 1 -type f -mtime +30 -delete
echo "VIP GECE backup completed: $STAMP"
