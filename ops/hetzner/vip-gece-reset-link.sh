#!/bin/bash
# VIP GECE — tek kullanimlik musteri sifre yenileme linki uretir (owner araci).
# Kurulum: /usr/local/bin/vip-gece-reset-link (600/755, root)
# Kullanim:  vip-gece-reset-link <email|kullanici-adi|etiket> [ttl_dakika]
# Guvenlik:  link icerigi stdout'a YAZILMAZ; 600 izinli dosyaya yazilir,
#            yalnizca dosya yolu ve gecerlilik bilgisi basilir.
set -euo pipefail

TARGET="${1:-}"
TTL="${2:-1440}"
if [ -z "$TARGET" ]; then
  echo "kullanim: vip-gece-reset-link <email|kullanici-adi|etiket> [ttl_dakika]"
  exit 1
fi

OUTDIR="/root/reset-links"
mkdir -p "$OUTDIR"
chmod 700 "$OUTDIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SAFE="$(printf '%s' "$TARGET" | tr -c 'A-Za-z0-9._@-' '_')"
TMP="/tmp/reset-link-${SAFE}-${STAMP}.txt"
OUT="${OUTDIR}/${SAFE}-${STAMP}.txt"

su - deploy -c "cd /var/www/vip-gece-site/current && NODE_ENV=production DOTENV_CONFIG_PATH=/var/www/vip-gece-site/.env node scripts/issue-customer-mobile-password-reset-link.mjs --account=\"${TARGET}\" --ttl-minutes=${TTL} --out=${TMP}"

mv "$TMP" "$OUT"
chmod 600 "$OUT"
echo "link_dosyasi=${OUT}"
echo "not: link tek kullanimlik ve surelidir; 600 izinli dosyadan guvenli kanaldan iletin."
