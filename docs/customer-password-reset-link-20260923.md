# Müşteri Şifre Yenileme Bağlantısı (2026-09-23)

Kişisel bilgi (e-posta/telefon) gerektirmeyen, tek kullanımlık şifre yenileme
akışı. Müşteri mobil hesapları (`customer-mobile-accounts`) için geçerlidir.

## Akış

1. Admin paneli (Müşteri Onboarding) → **"Şifre yenileme bağlantısı oluştur"**
   ya da CLI:
   `node scripts/issue-customer-mobile-password-reset-link.mjs --account=<id|email|label> [--ttl-minutes=60] [--out=<600-dosya>]`
2. Sistem `https://vip-gece.site/sifre-yenile#<token>` biçiminde bir bağlantı
   üretir. Token 32 bayt (43 karakter base64url); depoda yalnız SHA-256
   hash'i ve bitiş zamanı tutulur.
3. Müşteri bağlantıyı açar; sayfa başlığı ve maskeli e-postayı görür;
   yeni şifresini iki kez girip kaydeder.
4. Kayıt anında: yeni PBKDF2-SHA256 (210k iterasyon) hash yazılır,
   `must_change_password=false`, `session_version` artırılır (tüm eski
   müşteri oturumları kapanır), token kaydı silinir.
5. Bağlantı **tek kullanımlıktır**; ikinci deneme 404 döner.

## API

| Yöntem | Yol | Açıklama |
| --- | --- | --- |
| POST | `/api/v1/admin/customer-accounts/:id/password-reset-link` | (admin) link üretir; `ttl_minutes` opsiyonel |
| POST | `/api/customer/password-reset/start` | token doğrular; `label` + maskeli e-posta döner |
| POST | `/api/customer/password-reset` | `{token, new_password}` ile şifreyi günceller |

Public uçlar gateway koruması dışındadır (mobil uygulama yolu değil, web
sayfası yolu); güvenlik tek kullanımlık + süreli + hash'li token'da ve
`loginLimiter` (15 dk / 10 deneme) sınırındadır. `no-store` başlıkları
uygulanır; token URL fragment'ında taşınır (sunucu loglarına düşmez).

## Güvenlik özellikleri

- Token düz metin olarak **hiçbir yerde saklanmaz** (sha256 hex).
- Varsayılan TTL 60 dk; sınır 5–1440 dk (`CUSTOMER_PASSWORD_RESET_TTL_MINUTES`).
- Süre dolumu ve tekrar kullanım reddedilir; zayıf şifre (min 8) reddedilir.
- Şifre değişince eski oturumlar geçersiz (session_version).
- E-posta maskelenir (`m***@vipgece.com`); hesap yokluğu sızdırılmaz.
- Değerler sohbete/loga yazılmaz; CLI `--out` ile 600 izinli dosyaya yazar.

## Doğrulama (2026-09-23)

- `node --test scripts/customer-mobile-password-reset.test.cjs` → **8/8 pass**
  (üretim, doğrulama, süre dolumu, tek kullanım, oturum iptali, zayıf şifre,
  TTL sınırları, yapılandırma hatası).
- Uçtan uca yerel test (geçici store): sayfa 200 · start 200 · reset 200 ·
  tekrar kullanım 404 · yeni şifre girişi OK · eski şifre reddi.
- `npm run smoke` → **43/43 ok**; `npm run contracts` → **489/489 ok**
  (staging env ile; `SITE_URL=https://vip-gece.site`).
- `admin-role-contract` → **29/29 assertion**; `private-panels:contract` → ok.
- `npm run check` temiz; `secret-scan` temiz.
- Admin shell sürümü `20260923-reset1`'e yükseltildi (kontrat güncellendi).

## Notlar

- `scripts/profile-original-archive.test.cjs` bu makinede `sharp` native
  modülü yüklenemediği için kırılıyor (bu değişiklikten bağımsız, önceden
  var olan toolchain sorunu).
- Üretime alma ayrı onaylı dağıtımdır; dağıtım sonrası MRS Ajans için link
  panelden veya sunucuda CLI ile üretilir.
