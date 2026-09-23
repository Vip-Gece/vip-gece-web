# Müşteri Uygulaması i18n + Anahtar Rotasyonu — 2026-09-23

## 1. i18n (5 dil) — TAMAM

- Diller: **Türkçe (varsayılan), English, Русский, العربية, Oʻzbekcha**.
- Kaynaklar: `res/values*/strings.xml` (tr + values-en/ru/ar/uz); ~176 metin
  çevrildi (ana ekran, giriş, profil formu, görseller, analiz, destek,
  güncelleme akışı, bildirimler, tema/dil seçici).
- Dil seçici: Hesap bölümünde **Dil** düğmesi →
  `AppCompatDelegate.setApplicationLocales` (appcompat 1.7.1).
- `res/xml/locales_config.xml` + manifest `android:localeConfig` (API 33+
  sistem dili seçici) ve `android:supportsRtl="true"` (Arapça RTL).
- Sunucudan gelen içerik (profil adı/açıklaması) çevrilmez; UI çevrilir.
- Demo/debug ekranları ve teknik literal'ler kapsam dışıdır.
- Doğrulama: `assembleDebug`/`assembleRelease` başarılı, `lintDebug` **0 hata**.

## 2. Anahtar rotasyonu — TAMAM (yeni imza kimliği)

Eski `ab6c0ec1…` keystore ve config imza anahtarı kurtarılamadığı için
sıfırdan yeni kimlik üretildi:

| Öğe | Değer |
| --- | --- |
| APK release keystore | `~/.codex/.secrets/vip-gece-customer-release-20260923.jks` (PKCS12, RSA 4096, 10000 gün) |
| APK sertifikası (SHA-256) | `e44572980345db48361f1ce0d8fecfe1821ee815c1597c23fcac4f33d404beed` |
| Config imza anahtarı | `~/.codex/.secrets/vip-gece-customer-config-private.pem` (RSA 3072) + public uygulamaya gömüldü |
| Sunucu kopyası | `/var/lib/vip-gece/signing/` (günlük `secrets` yedeğine dahil) |
| Eski public key arşivi | `output/backups/ab6c-era/` |

- APK: **2.1.3 / versionCode 10**, sha256
  `ad09a8fc4c32fc447ce57f5432590ff4dd7cbcb05653b85f66083fc1240c497d`,
  1.280.838 bayt.
- İmzalı müşteri config: revizyon `20260923112514`, geçerlilik
  **2026-11-07** (`public/downloads/vip-gece-customer-config.json`).
- İmzalı güncelleme manifesti: 2.1.3, mandatory, yeni sertifika ve APK
  (`vip-gece-customer-latest.json` + `-2.1.3-10.apk`).
- **Firebase App Distribution:** release 2.1.3 yüklendi, notlar yazıldı,
  test kullanıcısı `bkaytanci00@gmail.com`.
- **Web deploy:** `/var/www/…/releases/20260923T1430Z-customer-213-bc9c1bf5`
  (paket sha `bc9c1bf5…`); rollback: `…20260923T1015Z-password-reset-v2-74b4f69e`.

### Etki (önemli)
`ab6c…` ile imzalı **mevcut kurulumlar** yeni config/manifesti
doğrulayamaz (gömülü public key eski). Bu cihazlar **yeni APK'yı bir kez
elle kurmalı** (Firebase daveti veya site indirmesi). Kurulumdan sonra
otomatik güncelleme yeni anahtarla çalışır.

## 3. Doğrulamalar

| Kontrol | Sonuç |
| --- | --- |
| `assembleRelease` (2.1.3/10) | BUILD SUCCESSFUL; cert `e4457298…` |
| `lintDebug` | 0 hata |
| Firebase upload | release 2.1.3 + test kullanıcısı |
| Canlı `/api/mobile/customer/update` | 2.1.3, cert `e4457298…`, mandatory |
| Canlı config | revizyon `20260923112514`, 2026-11-07'ye kadar |
| Canlı APK | HTTP 200, 1.280.838 bayt |
| `secret-scan` | temiz |
