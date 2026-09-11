# VIP GECE VPS Staging Deploy Proof - 2026-06-26

Bu belge production switch kaniti degildir. Amac, current runtime paketinin
gercek VPS uzerinde staging portunda calistigini ve strict SEO audit'ten
gectigini kaydetmektir.

## Paket

- SHA256: `0d7503f5a560a755b65212769afb6c8a5764028412c5977c5a34c57cb9895b26`
- Local paket: verified local runtime archive.
- Remote release: `/var/www/vip-gece-staging/releases/0d7503f5a560a755b65212769afb6c8a5764028412c5977c5a34c57cb9895b26`
- Remote current symlink: `/var/www/vip-gece-staging/current`
- Remote port: `3105`

2026-06-26 ikinci staging paketi:

- SHA256: `e5576ee82c60045522057d114b6d5d8f646254fc947ea55cb131e5dc30c20328`
- Local paket: verified local runtime archive.
- Remote release: `/var/www/vip-gece-staging/releases/e5576ee82c60045522057d114b6d5d8f646254fc947ea55cb131e5dc30c20328`
- Remote current symlink: `/var/www/vip-gece-staging/current`
- Remote port: `3105`

2026-06-26 final staging paketi:

- SHA256: `074e336c7ad4332721a55548d038049d64c8b1ddcead825f5dbed9ceeccb5bf5`
- Local paket: verified local runtime archive.
- Remote release: `/var/www/vip-gece-staging/releases/074e336c7ad4332721a55548d038049d64c8b1ddcead825f5dbed9ceeccb5bf5`
- Remote current symlink: `/var/www/vip-gece-staging/current`
- Remote port: `3105`

## Okunan Production Topolojisi

Okunur SSH kesfinde production hattinin su sekilde oldugu goruldu:

- Nginx site: `/etc/nginx/sites-enabled/ESKI_UYGULAMA_ADI_KALDIRILDI`
- Production domain: `vip-gece.com`, `www.vip-gece.com`
- Production proxy: `http://127.0.0.1:3000`
- Production app cwd: `/var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI`
- Production runtime user: `ESKI_KULLANICI_ADI_KALDIRILDI`
- Production runtime process: `node /var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI/server.modular.js`
- Production entry: `/var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI/server.modular.js`
- Production static root: `/var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI`

Production dosyalarina, Nginx config'e, runtime process'e veya port `3000`e yazma/restart yapilmadi.

## Staging Uygulama

VPS uzerinde yapilan staging islemi:

```sh
tar -xzf /tmp/vip-gece-runtime-0d7503f5a560a755b65212769afb6c8a5764028412c5977c5a34c57cb9895b26.tar.gz \
  -C /var/www/vip-gece-staging/releases/0d7503f5a560a755b65212769afb6c8a5764028412c5977c5a34c57cb9895b26 \
  --strip-components=1
cd /var/www/vip-gece-staging/releases/0d7503f5a560a755b65212769afb6c8a5764028412c5977c5a34c57cb9895b26
npm ci --omit=dev
ENV_CONTRACT_MODE=local PORT=3105 HOST=127.0.0.1 SITE_URL=http://127.0.0.1:3105 ENABLE_DEMO_PROFILES=true npm run env-contract
npm run check
```

Staging process `/var/www/vip-gece-staging/current` symlink'i uzerinden
`NODE_ENV=staging PORT=3105 HOST=127.0.0.1 SITE_URL=http://127.0.0.1:3105 ENABLE_DEMO_PROFILES=true npm start`
ile baslatildi.

2026-06-26 ikinci staging islemi:

```sh
tar -xzf /tmp/vip-gece-runtime-fixed-e5576ee8.tar.gz \
  -C /var/www/vip-gece-staging/releases/e5576ee82c60045522057d114b6d5d8f646254fc947ea55cb131e5dc30c20328 \
  --strip-components=1
cd /var/www/vip-gece-staging/releases/e5576ee82c60045522057d114b6d5d8f646254fc947ea55cb131e5dc30c20328
npm ci --omit=dev
ln -sfn /var/www/vip-gece-staging/releases/e5576ee82c60045522057d114b6d5d8f646254fc947ea55cb131e5dc30c20328 /var/www/vip-gece-staging/current
```

Bu ikinci paket, production anon Supabase yetki hatasinda `DATABASE_URL`
uzerinden public `profiles` okuyan fallback'i icerir. `pg@8.22.0`
production dependency olarak kuruldu.

## Sonuc

Health:

```json
{"status":"ok","service":"vip-gece","env":"staging"}
```

Strict staging SEO audit:

```text
site=http://127.0.0.1:3105
ok=true
routes_checked=8
ok / status=200 title=VIP Gece | İstanbul Bölgeleri ve Güncel VIP Profil Vitrini
ok /anasayfa status=200 title=VIP Gece | İstanbul Bölgeleri ve Güncel VIP Profil Vitrini
ok /ilanlar status=200 title=İlanlar | Güncel VIP Profil Hub'ı | VIP Gece
ok /kategoriler status=200 title=Kategoriler | İstanbul Escort Kategori Hub'ı | VIP Gece
ok /istanbul-escort status=200 title=İstanbul Escort | İlçelere Göre Güncel VIP Profil Dizini | VIP Gece
ok /sisli-escort status=200 title=Şişli Escort | Güncel VIP Profiller ve Bölge Dizini | VIP Gece
ok /vip-escort status=200 title=VIP Escort | İstanbul Geneli Güncel Profil Dizini | VIP Gece
ok /iletisim status=200 title=İletişim | VIP GECE
ok robots status=200 findings=none
ok sitemap status=200 urls=48 findings=none
```

2026-06-26 ikinci staging strict audit:

```text
site=http://127.0.0.1:3105
ok=true
routes_checked=8
ok robots status=200 findings=none
ok sitemap status=200 urls=48 findings=none
```

Staging public API:

```json
{"profiles":3,"first":"ada-vip"}
```

## Production Env Canary

Bu canary production switch kaniti degildir. Canli Nginx/runtime/port `3000`
degistirilmeden, yeni staging release production `.env` ile `127.0.0.1:3107`
uzerinde calistirildi.

Canary komutu ozetle:

```sh
sudo -n -u ESKI_KULLANICI_ADI_KALDIRILDI env \
  NODE_ENV=production \
  PORT=3107 \
  HOST=127.0.0.1 \
  SITE_URL=http://127.0.0.1:3107 \
  ENABLE_PROFILE_EXPIRY=false \
  ENABLE_DEMO_PROFILES=false \
  DOTENV_CONFIG_PATH=/var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI/.env \
  node -r dotenv/config server.modular.js
```

Canary health:

```json
{"status":"ok","service":"vip-gece","env":"staging"}
```

Canary strict SEO audit:

```text
site=http://127.0.0.1:3107
ok=true
routes_checked=8
ok robots status=200 findings=none
ok sitemap status=200 urls=58 findings=none
```

Canary profil paritesi:

```json
{"url":"http://127.0.0.1:3107/api/public/profiles","profiles":12,"first":"istanbul-ela-1779241002723"}
{"url":"http://127.0.0.1:3107/api/v1/public/profiles","profiles":12,"first":"istanbul-ela-1779241002723"}
{"url":"http://127.0.0.1:3000/api/public/profiles","profiles":12,"first":"ela"}
```

Onceki blokaj olan `profiles=0` durumu bu paketle kalkti. Yeni runtime,
production env canary'de eski production ile ayni profil sayisini dondurdu.

## Production Switch Sonucu

2026-06-26T06:01Z final production switch tamamlandi:

- Production root: `/var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI`
- Runtime process: `node /var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI/server.modular.js`
- Runtime owner: `ESKI_KULLANICI_ADI_KALDIRILDI`
- Rollback klasoru: `/var/www/ESKI_ROLLBACK_YOLU_KALDIRILDI-20260626T060123Z`
- Deployed SHA: `074e336c7ad4332721a55548d038049d64c8b1ddcead825f5dbed9ceeccb5bf5`
- Health: `{"status":"ok","service":"vip-gece","env":"production"}`
- API health: `{"status":"ok","api":"available","env":"production"}`
- Public profile count: `12`
- Proof: `docs/external/production-deploy-vip-gece.md`
- Post-switch live SEO: `npm run live-seo-audit -- --strict` sonucu `ok=true`, sitemap `58` URL.

Marketing baglanti kanitlari production deploy'den ayri dis kapilar olarak
acik kalir.

## Semt Alias Production Switch - 2026-06-26T21:23Z

2026-06-26T21:23Z semt alias paketi staging ve production hattindan
gecirildi:

- SHA256: `bf214eb90c5c6bb4722d8318b7c90dca62c3451f283e2035c9e24be27c4bc6c2`
- Local paket: verified local runtime archive.
- Remote release: `/var/www/vip-gece-staging/releases/bf214eb90c5c6bb4722d8318b7c90dca62c3451f283e2035c9e24be27c4bc6c2`
- Remote staging port: `3105`
- Production rollback: `/var/www/ESKI_ROLLBACK_YOLU_KALDIRILDI-20260626T212301Z`
- Production runtime: `node /var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI/server.modular.js`, owner `ESKI_KULLANICI_ADI_KALDIRILDI`, pid `1657254`

Staging dogrulamasi:

```text
site=http://127.0.0.1:3105
ok=true
routes_checked=8
ok robots status=200 findings=none
ok sitemap status=200 urls=236 findings=none
```

Production dogrulamasi:

```text
site=https://vip-gece.com
ok=true
routes_checked=8
ok robots status=200 findings=none
ok sitemap status=200 urls=246 findings=none
```

Canli semt smoke:

```text
https://vip-gece.com/taksim-escort     200 canonical=https://vip-gece.com/taksim-escort
https://vip-gece.com/nisantasi-escort  200 canonical=https://vip-gece.com/nisantasi-escort
https://vip-gece.com/beyoglu-escort    200 canonical=https://vip-gece.com/beyoglu-escort
```

## Public Copy Cleanup Production Switch - 2026-06-26T22:03Z

Kategoriler, ilanlar, landing sayfalari, detay fallback metinleri ve iletisim
yuzeyindeki public copy icinden ic ekip dili temizlendi. Kullaniciya gorunen
metinlerde `Landing`, `Hub`, `SEO Zinciri`, `mimari`, `omurga`, `ic link`,
`katman`, `koridor` ve `sinyal` gibi mimari/strateji terimleri birakilmadi.

- SHA256: `a628415d7cc0eaf0a79088d638893199f3eaca096ea0637e7f7a637e0b862220`
- Local paket: verified local runtime archive.
- Remote release: `/var/www/vip-gece-staging/releases/a628415d7cc0eaf0a79088d638893199f3eaca096ea0637e7f7a637e0b862220`
- Production rollback: `/var/www/ESKI_ROLLBACK_YOLU_KALDIRILDI-20260626T220317Z`
- Production runtime: PM2 `ESKI_UYGULAMA_ADI_KALDIRILDI`, owner `ESKI_KULLANICI_ADI_KALDIRILDI`, pid `1660595`
- Paket duzeltmesi: `404.html` runtime paketine eklendi ve verifier bunu zorunlu girdi olarak kontrol ediyor.

Dogulamalar:

```text
npm run check                              ok
npm run contracts                          ok
npm run verify-package                     ok package sha256 a628415d7cc0eaf0a79088d638893199f3eaca096ea0637e7f7a637e0b862220
VPS staging visible-copy grep              no matches
Production local visible-copy grep         no matches
Live domain visible-copy grep              no matches
http://127.0.0.1:3000 /profil/ada-vip     404
http://127.0.0.1:3000 /profil/profil-yok   404
```

Production strict SEO:

```text
site=https://vip-gece.com
ok=true
routes_checked=8
ok robots status=200 findings=none
ok sitemap status=200 urls=246 findings=none
```
