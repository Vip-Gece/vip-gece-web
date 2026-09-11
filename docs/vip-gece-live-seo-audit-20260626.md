# VIP GECE Live SEO Audit - 2026-06-26

Bu belge, eski listedeki canli domain / SEO teknik kontrol maddeleri icin
hesap gerektirmeyen route-level audit sonucunu kaydeder.

## Komut

```sh
npm run live-seo-audit
npm run live-seo-audit -- --site=http://127.0.0.1:3105
```

Script:

- route HTTP durumlarini izler
- title, description, canonical, Open Graph, Twitter meta, H1 ve JSON-LD kontrol eder
- `robots.txt` ve `sitemap.xml` yuzeyini denetler
- default modda rapor verir
- `--strict` ile kritik bulgularda non-zero cikis verir
- production'a yazmaz

## Local Current Kod Sonucu

Kaynak: `http://127.0.0.1:3105`

Sonuc: `ok=true`

Temiz gecen route seti:

- `/`
- `/anasayfa`
- `/ilanlar`
- `/kategoriler`
- `/istanbul-escort`
- `/sisli-escort`
- `/vip-escort`
- `/iletisim`

`robots.txt` ve `sitemap.xml` kontrolleri de temizdir. Sitemap local current
kodda 48 URL raporlar.

## VPS Staging Sonucu

Kaynak: `http://127.0.0.1:3105` (`ESKI_SUNUCU_ADI_KALDIRILDI`, `/var/www/vip-gece-staging/current`)

Sonuc: `ok=true`

Current paket VPS staging portunda health ve strict SEO audit'ten gecti.
Detay: `docs/vip-gece-vps-staging-deploy-20260626.md`.

2026-06-26 ikinci staging paketi:

- SHA256: `e5576ee82c60045522057d114b6d5d8f646254fc947ea55cb131e5dc30c20328`
- `http://127.0.0.1:3105` strict SEO: `ok=true`, sitemap `48` URL.
- Production env canary `http://127.0.0.1:3107` strict SEO: `ok=true`, sitemap `58` URL.
- Canary public profile API sonucu: `profiles=12`.
- Eski production `http://127.0.0.1:3000/api/public/profiles` sonucu: `profiles=12`.

## Canli Domain Sonucu - Switch Oncesi

Kaynak: `https://vip-gece.com`

Sonuc: `ok=false`

Canli domain mevcut durumda local current koddan geri gorunuyor:

- `/ilanlar` HTTP 404 ve JSON-LD eksik.
- `/kategoriler` description, Open Graph title/description ve Twitter title eksik.
- `/istanbul-escort`, `/sisli-escort`, `/vip-escort` Twitter title eksik.
- `/sisli-escort` ve `/vip-escort` description kisa.
- `/iletisim` Twitter title ve JSON-LD eksik.
- `robots.txt` temiz.
- `sitemap.xml` temiz ve 59 URL raporlar.

2026-06-26 son tekrar kontrolu:

```text
site=https://vip-gece.com
ok=false
routes_checked=8
ok / status=200 title=İstanbul Escort - VIP Escort - Escort | MRS ESCORT
ok /anasayfa status=200 title=İstanbul Escort - VIP Escort - Escort | MRS ESCORT
warn /ilanlar status=404 title=İstanbul Escort - VIP Escort - Escort | MRS ESCORT findings=HTTP 404; missing JSON-LD
warn /kategoriler status=200 title=İstanbul Escort VIP İlanları findings=missing description; missing Open Graph title/description; missing Twitter title
warn /istanbul-escort status=200 title=Istanbul Escort | VIP Gece Guncel VIP Profiller findings=missing Twitter title
warn /sisli-escort status=200 title=Şişli Escort | VIP Gece findings=description length 75; missing Twitter title
warn /vip-escort status=200 title=VIP Escort | VIP Gece findings=description length 63; missing Twitter title
warn /iletisim status=200 title=İletişim | MRS Escort findings=missing Twitter title; missing JSON-LD
ok robots status=200 findings=none
ok sitemap status=200 urls=59 findings=none
```

## Karar

Kod tarafinda local current SEO route yuzeyi temiz. Canli domain ise eski veya
farkli deploy durumunda oldugu icin ayni sonucu vermiyor. Yeni staging paketi
hazirlanip dogrulandi; fakat production deploy, VPS write, PM2/Nginx restart,
Cloudflare edit veya secret islemi yapilmadi.

## Canli Domain Sonucu - Switch Sonrasi

Kaynak: `https://vip-gece.com`

Sonuc: `ok=true`

2026-06-26T06:01Z final production switch sonrasi strict audit:

```text
site=https://vip-gece.com
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
ok sitemap status=200 urls=58 findings=none
```

Proof: `docs/external/production-deploy-vip-gece.md`.

Production runtime kaniti:

- Deployed SHA: `074e336c7ad4332721a55548d038049d64c8b1ddcead825f5dbed9ceeccb5bf5`
- Rollback: `/var/www/ESKI_ROLLBACK_YOLU_KALDIRILDI-20260626T060123Z`
- Health: `{"status":"ok","service":"vip-gece","env":"production"}`
- API profile count: `12`
