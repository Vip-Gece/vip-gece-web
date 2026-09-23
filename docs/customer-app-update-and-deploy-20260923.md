# Web Dağıtımı + Android Uygulama Güncellemesi — 2026-09-23

## 1. Web dağıtımı (şifre yenileme özelliği dahil) — TAMAM

- Paket: `vip-gece-runtime-20260923b-seo-index-automation.tar.gz`
  sha256 `74b4f69ef830ef7d1a44e132c5b179b674cbf5ca299bbc68ac4940e8e3fc1d7e`
  (`npm run package-staging` + `verify-package-artifact` çalıştırıldı).
- Yeni release: `/var/www/vip-gece-site/releases/20260923T1015Z-password-reset-v2-74b4f69e`
  (önceki: `20260923T0945Z-password-reset-d3be4f6d`; ilk deploy'da CLI script'i
  ESM hatası verdiği için düzeltilip v2 dağıtıldı.)
- Trafik: `current` symlink atomik geçiş + PM2 restart (deploy kullanıcısı).
- Doğrulama:
  - `/health` 200, `/api/v1/public/profiles` 200
  - `/sifre-yenile` 200 (origin ve Cloudflare üzerinden)
  - `POST /api/customer/password-reset/start` geçersiz token →
    `{"ok":false,"code":"RESET_LINK_INVALID"}` 404
  - `admin.js?v=20260923-reset1` yayında
  - PM2 loglarında yeni hata yok
- Rollback hedefi: `releases/20260920T0401Z-customer-8983838a`
  (komut: symlink + `pm2 restart vip-gece-site --update-env`).
- **MRS Ajans** için tek kullanımlık şifre yenileme bağlantısı üretildi
  (60 dk): yerel `~/.config/vip-gece/mrs-password-reset-link.txt` (600).
  Link sohbete/loga yazılmadı; müşteriye güvenli kanaldan iletilecek.

## 2. Android müşteri uygulaması 2.1.2 (code 9) — BUILD + FIREBASE TAMAM

- Build: Temurin JDK 21 (`~/.local/opt/jdk-21.0.12.1+1`), macOS cmdline-tools
  + build-tools 35.0.0 (Windows kopyaları düzeltildi), Gradle 8.13,
  `:app:assembleRelease` (R8/minify) → `app-release.apk`.
  - APK sha256: `10ac24fa23a3e091822d27cdf2e09180e8b245f1f5eefbe5017f6814329b3ca7`
  - Sürüm: `2.1.2` / `versionCode 9`
  - İmza sertifikası (sunucu keystore'u): `c82f0f78fb2ee508a13008735cb90ccb27d365a5e0c9dafc2b2b5962a7075c06`
- Firebase App Distribution: release **2.1.2** yüklendi (binary upload +
  notlar PATCH + `testers:batchAdd`).
  - Proje: `vip-gece-android-20260914`, uygulama: `com.vipgece.customer`
  - Test kullanıcısı: `bkaytanci00@gmail.com`
  - Yükleme operasyonu: `.../operations/10ac24fa…` (tamamlandı, hata yok)
- Araçlar: `scripts/distribute-customer-apk-firebase.mjs` (yükleme + not +
  test kullanıcısı; token gcloud'dan, gizli değer yazılmaz).

## 3. OWNER girdisi gereken blokajlar (uygulama güncellemesinin gerçek kullanıcıya ulaşması)

Yayınlanmış **2.1.1 (code 8)** APK'sı `ab6c0ec142255cf687f83609d041fe964829e9b74d8e89e8af9d5b3543f7b5da`
sertifikasıyla imzalı. Bu anahtar bu makinede, sunucuda ve arşivlerde **yok**
(sunucudaki keystore `c82f0f78…` üretiyor). Sonuçlar:

1. **Yerinde güncelleme** (eski kurulumun üzerine) `c82f0f78…` imzalı yeni
   APK ile mümkün değil; cihazlar imza uyuşmazlığı nedeniyle kurulumu reddeder.
   → Eski `ab6c0ec1…` keystore'u geri yüklenmeli (eski makine yedeği).
2. **Uygulama içi zorunlu güncelleme** imzalı manifest gerektirir:
   `~/.codex/.secrets/vip-gece-customer-config-private.pem` bu makinede yok
   (sunucuda da yok). Bu olmadan `sign-customer-mobile-release.mjs` /
   `sign-customer-mobile-config.mjs` çalıştırılamaz.
3. Canlı müşteri config'inin süresi **2026-09-08'de dolmuş**; yenisi yine aynı
   özel anahtarla imzalanmalı. PM2 loglarındaki "müşteri yapılandırmasının
   süresi dolmuş" uyarısı bu yüzdendir.

Gerekli OWNER girdisi: (a) `vip-gece-customer-config-private.pem`,
(b) `ab6c0ec1…` sertifikasına ait keystore (veya rotasyon kararı).
Bunlar sağlanınca: APK eski anahtarla yeniden imzalanır/imzalanır, imzalı
manifest yayınlanır ve tüm kurulumlar yerinde güncellenir.

### 3.1 Sunucu SSH araması (2026-09-23) — anahtarlar sunucuda YOK

Tüm dosya sistemi tarandı (`/var/lib`, `/var/www`, `/home`, `/root`, `/opt`,
`/srv`, geçici scratch, tüm yedek arşivleri, `BEGIN PRIVATE KEY` içerik
aramaları, bash history):

- Sunucudaki tek keystore: `/var/lib/vip-gece/signing/vip-gece-customer-release.jks`
  → sertifika `c82f0f78…` (yayındaki 2.1.1'in `ab6c0ec1…` anahtarı değil).
- `vip-gece-customer-config-private.pem` hiçbir yerde yok.
- Günlük yedek seti (app/images/config) bu anahtarları **içermiyordu**;
  offsite yedek aracı (rclone/restic) da yok.

### 3.2 Yedekleme boşluğu kapatıldı (2026-09-23)

- `ops/hetzner/vip-gece-backup.sh` güncellendi ve sunucuya kuruldu
  (eski script: `/usr/local/sbin/vip-gece-backup.bak-20260923`).
- Yeni **`secrets-<stamp>.tar.gz`** (root-only, 600) artık şunları içeriyor:
  `/var/lib/vip-gece/signing` (keystore + properties),
  `customer-mobile-accounts.json`, `google-search-console-credential.json`,
  `indexnow-state.json`.
- Canlı test: `systemctl start vip-gece-backup.service` → başarılı;
  `secrets-20260923T074855Z.tar.gz` içeriği doğrulandı, `SHA256SUMS` güncel.
- Not: yedekler hâlâ yalnızca sunucu üzerinde (offsite kopya yok);
  offsite/şifreli kopya ayrı bir OWNER kararıdır.

## 4. Doğrulamalar

| Kontrol | Sonuç |
| --- | --- |
| Web paketi doğrulama | ok (sha eşleşti) |
| Canlı `/sifre-yenile` | 200 (Cloudflare dahil) |
| Eski/yanlış token | 404 RESET_LINK_INVALID |
| Android `assembleRelease` | BUILD SUCCESSFUL (56 sn) |
| APK imza doğrulama | apksigner OK (sunucu keystore sertifikası) |
| Firebase upload | done=true, hata yok; release 2.1.2 |
| `secret-scan` | temiz |
