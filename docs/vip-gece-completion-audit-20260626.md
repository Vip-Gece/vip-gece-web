# VIP GECE Completion Audit

Bu dosya, eski yapılacaklar listesinden kalan kalıcı doğrulama yüzeylerini temiz ve güncel biçimde özetler.

## Kapsam

- Public site sayfaları, kategori/profil akışı, sitemap ve robots politikası.
- Admin, müşteri paneli ve private panel korumaları.
- Google Search Console, Analytics, IndexNow ve canlı SEO denetimleri.
- Paketleme, staging paketi, production proof ve dış marketing proof dosyaları.
- Supabase/Postgres bağlantıları ve profil görseli yönetimi.

## Aktif Doğrulama Komutları

```sh
npm run check
npm run env-contract
npm run contracts
npm run smoke
npm run package-staging
npm run verify-package
npm run verify-release-candidate
```

Güncel temiz paket SHA: `6a7d685116e27c6b777b39028bfab883c36118d46260b210d8483d067c93e74d`

## Dış Proof Kapıları

- Production deploy proof: `docs/external/production-deploy-vip-gece.md`
- Semrush veya eşdeğer SEO audit proof: `docs/external/semrush-vip-gece.md` veya `docs/external/seo-audit-vip-gece.md`
- Brand24 proof: `docs/external/brand24-vip-gece.md`
- Similarweb, Conductor, Channel99 ve Lead CRM karar/proof dosyaları.

`docs/external/_templates/` ve `docs/external/_drafts/` proof sayılmaz. Proof dosyaları boş, template kopyası veya placeholder'lı olamaz.

## Güncel Karar

Projede yalnızca gerçek profil fotoğrafları, profil galerisi ve image sitemap akışı korunur. Otomatik içerik veya otomatik görsel hazırlama katmanları kaynak ağaçta tutulmaz.

## Sonraki Canlı Kontroller

- Canlıda eksik profil fotoğrafları için Supabase/Postgres env ve storage path doğrulanacak.
- Cloudflare cache/DNS/firewall ayarları canlı domain üstünden kontrol edilecek.
- Google Search Console ve Analytics bağlantıları canlı credential ile doğrulanacak.
