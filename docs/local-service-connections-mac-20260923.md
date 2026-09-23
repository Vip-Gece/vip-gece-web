# Yerel Makine Servis Bağlantıları — macOS (2026-09-23)

Yeni Mac (macOS 26.7, arm64, kullanıcı `o-neo`) üzerinde Cloudflare,
Supabase ve Hetzner bağlantılarının ayrı ayrı ve kalıcı kurulum kaydı.
Bu dosyada hiçbir gizli değer (token/key/şifre) bulunmaz; tüm kimlikler
proje `.env` dosyasından okunur.

## 1. Hetzner — SSH (kalıcı)

- Alias'lar: `vip-gece-hetzner` (kanonik) ve `vip-gece`
  (`scripts/external-surface-scan.mjs` varsayılanı).
- Hedef: `root@159.69.146.114`, port 22.
- Config: `~/.ssh/config` (600), `IdentitiesOnly yes`,
  `StrictHostKeyChecking yes`, `AddKeysToAgent yes`, `UseKeychain yes`
  (parola macOS Keychain'de saklanır), `ServerAliveInterval 30`.
- Host key: `~/.ssh/known_hosts`, parmak izi
  `SHA256:spvyRWXkiG9PuQyV2gVj0Qv0uIIb+oj7wE3yTefpu08` (repo
  `.ssh_known_hosts` ve `docs/forensic-handoff-checkpoint-20260911.md` ile
  birebir eşleşti).
- Anahtar: `~/.ssh/vip_gece_hetzner_ed25519` — eski makineden 2026-09-23'te
  içe aktarıldı (parolasız); public parmak izi
  `SHA256:sr2gRJ0E8LqnZ7vS4Wq/HyG2k6tWt0tLodsfAWQpWQI`. Aynı içe aktarmayla
  `id_ed25519` (parolalı; `neo-brain` / frp.gpu.ai:10029), `gpu_ai_ed25519`
  (parolalı) ve reddedilen eski `vip-gece-hetzner-20260911` anahtarı da
  `~/.ssh/` altına alındı.
- Ek host: `neo-brain` (`frp.gpu.ai:10029`, kullanıcı `root`) eski config'den
  geri yüklendi.
- Doğrulama: `ssh vip-gece-hetzner true` ve `ssh -G vip-gece-hetzner`.

Durum: TAMAMLANDI — 2026-09-23 canlı test: `ssh vip-gece-hetzner`
bağlantısı root olarak başarılı (host `O-NEO`, uptime 11 gün).

## 2. Cloudflare — API + CLI (kalıcı, token tabanlı)

- Kanonik kimlik: proje `.env` içindeki `CLOUDFLARE_API_TOKEN`
  (account-owned), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`.
- Canlı doğrulama (2026-09-23, read-only):
  - `account tokens/verify` → HTTP 200, `status=active`
  - `zones/{id}` → HTTP 200, zone `vip-gece.site`, `status=active`
  - `wrangler whoami` → Account API Token, hesap `O-NEO-CYBER`
  - `wrangler deploy --dry-run` (services/customer-gateway) → başarılı,
    uzak değişiklik yok.
- Kurulan araçlar: `wrangler` 4.136.3 (npm, kullanıcı scope:
  `~/.local/opt/node-v24`), `cloudflared` 2026.9.1 (Homebrew).
- Kalıcı kullanım: `vip-gece-run wrangler ...` (bkz. bölüm 5).

## 3. Supabase — API + DB (kalıcı)

- Kanonik kimlik: proje `.env`. Host: `rklydqhkhcydoijmlq.supabase.co`.
- Canlı doğrulama (2026-09-23, read-only):
  - `GET /auth/v1/health` → HTTP 200, GoTrue v2.197.0.
  - Storage bucket listesi (service_role) → HTTP 200; `images` (public),
    `customer-profile-images` (private).
  - Postgres (psql) → bağlı, PostgreSQL 17.6; `select count(*) from
    profiles` = 28, aktif = 15.
- Sunucudaki `DATABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` 2026-09-23'te
  yerel `.env`'e aktarıldı (değerler hiçbir çıktıya basılmadı; `.env` 600 ve
  gitignore).
- Önemli düzeltme: eski doğrudan host `db.rklydqhkhcydoijmlq.supabase.co`
  artık NXDOMAIN. Veritabanı Tokyo (ap-northeast-1) bölgesinde; yerel
  bağlantı Supabase pooler'a çevrildi:
  `aws-0-ap-northeast-1.pooler.supabase.com:5432` (session mode,
  `sslmode=require`). Sunucu uygulamasının açık bağlantısı da aynı Tokyo
  uç noktasına gidiyor.
- Yerel uygulama paritedi: `CUSTOMER_PROFILE_IMAGE_DIR=./public/media/profiles`
  altına sunucudaki 94 müşteri görseli (12M) salt-okunur `rsync` ile
  eşitlendi; `.gitignore`'a `public/media/` eklendi (müşteri verisi repoya
  girmez).
- Kurulan araçlar: `supabase` CLI 2.117.0 (Homebrew), `psql` 18.6
  (`/opt/homebrew/opt/libpq/bin/psql`, PATH'e eklendi).
- Not: `supabase login` kişisel erişim token'ı (PAT) ister; proje
  script'leri PAT kullanmaz (env tabanlı), bu yüzden hazır için gerekli
  değil. PAT verilirse CLI yönetim komutları da açılır.

## 4. Yerel uygulama doğrulaması (2026-09-23)

`node server.modular.js` (PORT 3000) ile:
- `GET /health` → 200; `GET /api/health` → 200
- `GET /api/v1/public/profiles` → 15 profil (iki sıralı istekte kararlı)
- `GET /` , `/vip-escort` , `/profil/turbanli-seyma-378f5aa4` → 200
- İlk profil görseli `/media/customer-profile/...` → 200 (189 KB)
- API hata kaydı: 0

Bilinen durum: Tokyo pooler'a mesafe nedeniyle ilk bağlantı 5 sn'lik
`connectionTimeoutMillis` sınırına takılabilir; ikinci denemede kararlı
çalışır. Üretim loglarında aynı gecikme (2-5 sn sorgular) zaten mevcut.

## 5. Kalıcı yardımcılar ve PATH

- `~/.local/bin/vip-gece-env` — `.env` içeriğini güvenli biçimde shell
  export satırlarına çevirir (`eval "$(vip-gece-env)"`); değer basmaz.
- `~/.local/bin/vip-gece-run <komut>` — komutu proje `.env` kimlikleriyle
  çalıştırır; gizli değeri ekrana yazmaz (örn.
  `vip-gece-run wrangler whoami`).
- `~/.zshrc` — node (`$HOME/.local/opt/node-v24/bin`) ve `psql`
  (`/opt/homebrew/opt/libpq/bin`) PATH'e eklendi.

## 6. Test sonuçları (özet)

| Servis | Yöntem | Sonuç |
| --- | --- | --- |
| Hetzner | SSH config + host key pin + kanonik anahtar | AUTHORIZED_REAL_ENV_VERIFIED (`O-NEO`, root) |
| Cloudflare | API token verify + zone read + wrangler | AUTHORIZED_REAL_ENV_VERIFIED |
| Cloudflare Worker | `wrangler deploy --dry-run` | AUTHORIZED_REAL_ENV_VERIFIED (uzak deploy yok) |
| Supabase API | GoTrue health + bucket listesi | AUTHORIZED_REAL_ENV_VERIFIED |
| Supabase DB | psql pooler + sayım sorguları | AUTHORIZED_REAL_ENV_VERIFIED |
| Yerel uygulama | boot + sayfa/API/görsel istekleri | AUTHORIZED_REAL_ENV_VERIFIED |

## 7. Üretim DATABASE_URL geçişi (2026-09-23, tamamlandı)

- Sorun: sunucudaki doğrudan host (`db.rklydqhkhcydoijmlq.supabase.co`) artık
  NXDOMAIN; yeniden başlatmada bağlantı kurulamama riski vardı.
- Ön test (preflight): sunucudan pooler'a CA doğrulamalı TLS ile bağlantı ve
  `select count(*)` → OK (28).
- Yedek: `/var/www/vip-gece-site/.env.bak-20260923T014105Z-pooler-url`
  (600, deploy sahipli).
- Değişiklik: `DATABASE_URL` →
  `aws-0-ap-northeast-1.pooler.supabase.com:5432` (atomik yazım, dosya
  sahipliği/izni korundu; MD5-benzeri sha256 öncesi/sonrası kayıtlı).
- Restart: `pm2 restart vip-gece-site --update-env` → yerel `/health` 200.
- Kanıt:
  - Yeni süreç (pid 414271) pooler IPv4 adresine bağlı: `54.64.190.72:5432`.
  - Canlı: `https://vip-gece.site/` HTTP/2 200, `/health` 200,
    `/api/v1/public/profiles` 200 (gerçek profil verisi).
  - Loglarda bağlantı hatası yok; periyodik süresi dolan profil güncellemesi
    pooler üzerinden çalıştı (2352ms — önceki doğrudan bağlantıyla aynı
    büyüklük, regresyon yok).
- Rollback: yedek dosyayı `.env` üzerine kopyala +
  `pm2 restart vip-gece-site --update-env` (denenmedi; gerek kalmadı).
- Yan bulgu (çözüldü): 20260912-passkey release'inden kalan
  `vip-recover-dead-profile-identities.js` (pid 192371) 9 gündür asılı
  duruyordu; bölüm 8'de kapatıldı.

## 8. Eski kalıntı temizliği ve görünürlük denetimi (2026-09-23)

- Asılı kalmış eski kurtarma süreci (pid 192369/192371, 9 gündür uyuyordu)
  kapatıldı. Script repo'daki `scripts/recover-dead-profile-identities.js` ile
  birebir aynıydı (`sha256 872b7b26e1c6215de921…`); `pageinspect` kurulmamış,
  kimlik 79-84 DB'de yok, profil sayıları değişmedi (28/15) ve süreç hiçbir
  kilit tutmuyordu. Eski IPv6 doğrudan DB bağlantısı da böylece kapandı.
- Sunucu `/tmp`: 15 eski kalıntı (script kopyaları, FIDO oturum ve runtime
  arşivleri) `/root/vip-gece-old-tmp-archive-20260923` (700) altına alındı;
  `/tmp` temiz. Kalıntılarda gizli değer taraması: bulgu yok.
- İçerik: DB'de emekli Supabase host (`hofblpqaxzhybozavtaz`) referansı 0;
  süresi geçmiş ama hâlâ aktif profil 0; aktif 15 profilin tamamı
  2026-07-21..29 tarihli.
- Canlı denetimler:
  - `live-image-audit`: 15 profil, 47/47 görsel HTTP 200, kırık 0.
  - `live-domain-seo-audit --strict`: 16 rota HTTP 200; robots OK;
    sitemap 254 URL; profiller 15/15 indexable. Tek uyarı: `/genc-escort`
    `noindex` — aktif hiçbir profilde "genç/genc" etiketi olmadığı için
    (landingContextService kuralı); eski kalıntı değil, veri kaynaklı.
- GSC: `docs/api-credential-registry.md` ve sunucu kontrolü ile teyit edildi;
  Google Search Console kimliği bu sunucuda/makinede kurulu değil. Sıralama ve
  görünürlük ölçümü için credential şart (MISSING_INPUT). Kurulum hazır:
  `scripts/install-gsc-credential.mjs` (sunucu) veya yerelde
  `GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON_PATH`; ardından
  `sync-gsc-search-demand` / `gsc-index-monitor` ile 7/28/90 günlük veri.

## 9. Kimlik rotasyonu (2026-09-23)

- **Hetzner SSH — tamamlandı (canlı):**
  - Yeni anahtar: `~/.ssh/vip_gece_hetzner_20260923_ed25519`
    (`SHA256:VtB+JyEvAN3NyCLjTGUF/IID64E5NlOX9+v7EyGGNXU`).
  - Sunucuda `/root/.ssh/authorized_keys` ve
    `/home/deploy/.ssh/authorized_keys` yalnız bu anahtarı içeriyor; eski
    anahtarlar (`vip-gece-hetzner-2026`, `vip-gece-hetzner-20260911`)
    kaldırıldı (yedek: aynı dizinde `.bak-20260923-rotasyon`).
  - Eski anahtarla bağlantı denemesi `Permission denied (publickey)`;
    yeni anahtarla alias testi OK (`O-NEO`).
  - Eski yerel anahtar dosyaları `~/.ssh/archive-20260923/` (700) altında.
- **Cloudflare — OAuth oturumu tamam:** `wrangler login` (OAuth) yapıldı;
  oturum `~/Library/Preferences/.wrangler/config/default.toml`; hesap
  `O-NEO-CYBER`. OAuth token'ı API token yönetemiyor (403), bu yüzden audit
  token rotasyonu dashboard gerektiriyor: yeni `vip-gece-audit-read-2026-09-23`
  (Zone:Read, Zone Settings:Read, Account:Read) oluştur → `.env`'e koy →
  eski `vip-gece-audit-read-2026-09-01-final` token'ını Revoke et.
- **Supabase — tam rotasyon tamamlandı (2026-09-23):**
  - Taze CLI erişim token'ı tarayıcı cihaz akışıyla alındı (otomasyonla);
    macOS Keychain'de `Supabase CLI` kaydı; `supabase projects list` OK.
  - Yeni secret key `vip_gece_server_20260923` (`sb_secret_…`) üretildi;
    sunucu + yerel `.env` service anahtarı buna çevrildi; PM2 restart sonrası
    sunucu tarafı storage kontrolü 200 (`images`, `customer-profile-images`).
  - Public anahtar legacy JWT'den publishable'a çevrildi; canlı `/config.js`
    artık `sb_publishable_…` sunuyor.
  - Legacy anahtarlar **devre dışı**:
    `PUT /v1/projects/{ref}/api-keys/legacy?enabled=false`; doğrulama:
    legacy anon/service_role 401, publishable/secret 200 (geri alınabilir).
  - DB şifresi `PATCH /v1/projects/{ref}/database/password` ile döndürüldü;
    sunucu + yerel `DATABASE_URL` güncellendi; yeni şifre psql ile doğrulandı,
    eski şifre `password authentication failed` ile reddedildi.
  - Sunucu `.env` yedekleri: `.env.bak-20260923T030810Z-service-key`,
    `.env.bak-20260923T030954Z-anon-publishable`,
    `.env.bak-20260923T031230Z-db-password` (600, deploy).
- **Google Search Console — tamamlandı (2026-09-23, canlı):**
  1. `gcloud` kuruldu; `gcloud auth login` (bkaytanci00@gmail.com) onayı alındı.
  2. Service account `vip-gece-gsc-reader-20260923`
     (`@vip-gece-android-20260914.iam.gserviceaccount.com`) oluşturuldu;
     JSON key: `~/.config/vip-gece/gsc-reader-20260923.json` (600).
  3. `searchconsole.googleapis.com` API'si projede etkinleştirildi.
  4. SA, mülke (`sc-domain:vip-gece.site`) **Tam** yetkiyle eklendi
     (görünürlük: Kullanıcılar = 2).
  5. Sunucuya kurulum: `/var/lib/vip-gece/google-search-console-credential.json`
     + `.env` (GOOGLE_SEARCH_CONSOLE_*), PM2 restart; yerel `.env`'e
     `GSC_CREDENTIAL_JSON_PATH` + site URL eklendi.

## 10. GSC görünürlük teşhisi ve aksiyonlar (2026-09-23)

- API ile alınan canlı veri: 90 günde **6 gösterim, 1 tık** (sorgu: marka
  terimi). Görünürlük fiilen sıfır.
- URL denetimi (API):
  - `/` → "Sunucu hatası (5xx)", son tarama **2026-09-02** (eski olay).
  - `/istanbul-escort`, `/vip-escort`, `/profil/irem-istanbul` →
    "Tarandı - şu anda dizine eklenmiş değil".
- Teknik sağlık doğrulaması: canonical `https://vip-gece.site/` doğru;
  origin Cloudflare allowlist güncel (22/22); IPv4+IPv6 ve Googlebot UA ile
  yanıt 200; robots/sitemap sağlıklı.
- Aksiyonlar:
  - `sitemap.xml` + `image-sitemap.xml` API ile yeniden gönderildi.
  - 4 kritik URL için "dizine eklenmesini iste" gönderildi (URL, öncelikli
    tarama sırasına alındı): `/`, `/istanbul-escort`, `/vip-escort`,
    `/profil/irem-istanbul`.
- İzleme: `gsc-index-monitor` / `gsc-daily-position-rotation` /
  `sync-gsc-search-demand` script'leri artık canlı kimlikle çalışır durumda.

## 11. Tam dizin denetimi + PSI + Semrush durumu (2026-09-23)

**GSC tam tarama** (`gsc-index-monitor --all`, 254 sitemap URL'si):
| Durum | Adet |
| --- | --- |
| Dizine eklendi | 1 (ana sayfa — bugün 04:10'da yeniden tarandı) |
| Tarandı, dizine eklenmedi | 207 |
| Sunucu hatası (5xx) | 35 |
| Google tarafından bilinmiyor | 8 |
| Keşfedildi, eklenmedi | 3 |

- 35 "5xx" URL'nin tamamı bugün Googlebot UA ile **200** döndü →
  durumlar eski taramalardan kalmış (canlı hata yok).
- 207 "tarandı eklenmedi" sayfaları `index, follow` ve 200; yani engel
  teknik değil, Google kalite/otorite değerlendirmesi.
- Aynı gün 10 kritik URL için "dizine eklenmesini iste" gönderildi:
  `/`, `/istanbul-escort`, `/vip-escort`, `/profil/irem-istanbul`,
  `/atasehir-escort`, `/beykoz-escort`, `/tuzla-escort`, `/turbanli-escort`,
  `/profil/betul-istanbul`, `/sisli-escort`.

**PageSpeed Insights (gerçek API, anahtarlı):**
- GCP'de `pagespeedonline.googleapis.com` açıldı ve kısıtlı API anahtarı
  üretildi (`PAGESPEED_API_KEY`, yerel `.env`; çift anahtar silindi).
- Ana sayfa: mobil **100/100/100/100**, masaüstü **100/100/100/100**;
  LCP 1.1s / 0.3s, CLS 0. Performans/dizinlenebilirlik engeli yok.

**Semrush: erişim yok (MISSING_INPUT).**
- Projede/makinede Semrush hesabı veya API anahtarı yok
  (`SEMRUSH_API_KEY` local/sunucu `.env`'de yok; credential registry'de
  Semrush satırı hiç eklenmemiş; tarayıcıda oturum yok).
- Semrush sorguları için API anahtarı (ücretli plan) ya da hesap girişi
  gerekir; sağlandığında Site Audit + Position Tracking verisi çekilebilir.
