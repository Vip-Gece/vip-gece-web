# Offsite Şifreli Anahtar Yedeği — 2026-09-23

Amaç: imza anahtarlarının bulunduğu günlük `secrets-*.tar.gz` arşivinin
sunucu ve Mac dışında **üçüncü bir konumda**, şifreli olarak saklanması.

## Mimari (3-2-1 yaklaşımı)

| Kopya | Konum | Durum |
| --- | --- | --- |
| Kaynak + yerel yedek | Hetzner sunucu `/var/backups/vip-gece/` (root-only) | günlük 03:19 UTC |
| İkinci kopya | Mac `~/.codex/.secrets/` (600) | sürekli |
| **Offsite** | **iCloud Drive** → `VIP-Gece-Backups/` (age ile şifreli) | günlük 09:00 (launchd) |

- Şifreleme: `age 1.3.2` (X25519; `age -e -r <recipient>`), kimlik dosyası
  `~/.codex/.secrets/vip-gece-offsite-age-identity.txt` (600) ve sunucuda
  `/var/lib/vip-gece/signing/offsite-age-identity.txt` (600) kopyası.
- Saklama: en yeni **8** şifreli arşiv; eskiler otomatik silinir.
- Her arşivin yanında `.sha256` manifesti: şifreli sha, düz metin sha,
  kaynak yol (sır içermez).
- Otomasyon: `~/Library/LaunchAgents/ai.vipgece.offsite-backup.plist`
  (`ops/mac/ai.vipgece.offsite-backup.plist` şablonu), günlük 09:00;
  log: `~/Library/Logs/vip-gece-offsite-backup.log`.

## Komutlar

```bash
npm run offsite-backup                 # en güncel secrets arşivini şifreleyip iCloud'a yazar
npm run offsite-backup -- --refresh    # önce sunucuda yedek servisini tetikler
npm run offsite-backup -- --dry-run    # indirir+doğrular, yazmaz
npm run offsite-backup -- --keep=14    # saklama sayısı
```

## Geri yükleme

```bash
age -d -i ~/.codex/.secrets/vip-gece-offsite-age-identity.txt \
  "~/Library/Mobile Documents/com~apple~CloudDocs/VIP-Gece-Backups/<arsiv>.tar.gz.age" \
  > secrets.tar.gz
shasum -a 256 secrets.tar.gz   # manifestteki "plain sha256" ile karşılaştır
```

## Doğrulamalar (2026-09-23)

- İndirilen arşiv sha256'sı sunucu `SHA256SUMS` kaydıyla eşleşti.
- Şifre çözme round-trip: çözülen arşivin sha256'sı düz metin sha ile birebir.
- Sunucudaki kimlik dosyası Mac kopyasıyla birebir.
- Şifreli arşiv içinde yeni imza kimlikleri doğrulandı
  (`vip-gece-customer-release-20260923.jks`, config private key).

## Açık kullanıcı adımı

`age` kimlik dosyası şu an Mac + sunucuda. Felaket senaryosunda (iki makine
de kayıp) şifre çözülebilmesi için kimlik dosyasının sahibin **parola
yöneticisine** (macOS Passwords / 1Password vb.) kopyalanması gerekir.
Bu adım tamamlanana kadar kurtarma iki makineye bağımlıdır.

## Opsiyonel genişletme

Cloudflare R2 veya Hetzner Storage Box, dördüncü kopya olarak sonradan
eklenebilir; `scripts/offsite-secrets-backup.mjs` hedefi `--target` ile
değiştirilebilir yapıdadır (S3 yükleyici eklendiğinde aynı arşivler
kullanılabilir).
