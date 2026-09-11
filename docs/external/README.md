# VIP GECE External Proof Area

Bu klasor gercek dis kanitlar icindir.

`npm run full-goal-readiness` su dosyalari gercek proof olarak kabul eder:

- `semrush-vip-gece.md`
- `seo-audit-vip-gece.md`
- `production-deploy-vip-gece.md`
- `brand24-vip-gece.md`
- `similarweb-vip-gece.md`
- `conductor-vip-gece.md`
- `channel99-vip-gece.md`
- `lead-crm-vip-gece.md`

Bu dosyalari yalnizca gercek hesap, rapor veya karar kaniti oldugunda olustur.

Hazir sablonlar `docs/external/_templates/README.md` icindedir ve proof sayilmaz.
Calisilabilir taslaklari guvenli alanda uretmek icin:

```sh
npm run external-proof-intake -- --write-drafts
npm run external-proof-intake -- --markdown
```

Bu komut `docs/external/_drafts/` altina doldurulacak taslaklari yazar. `_drafts` altindaki dosyalar da proof sayilmaz; dolduktan sonra `npm run external-proof-intake -- --promote=<proof-id>` komutu ancak placeholder kalmadiysa gercek proof dosyasina tasir.

Secret, token, sifre, cookie veya kisisel credential yazma.

Proof dosyalari sadece dosya var diye gecmez; `npm run full-goal-readiness` zorunlu alanlarin dolu olmasini ve template placeholder seceneklerinin temizlenmesini kontrol eder.

Production ve marketing kapilarinda `VIP_GECE_*_READY=1` gibi boolean flagler tek basina yeterli degildir. Gercek proof bu klasordeki valid dosya veya `VIP_GECE_*_PROOF=/secure/path/...` override dosyasidir.

Secretsiz mevcut yuzey taramasi:

- `docs/external/external-surface-scan-20260626.md`

Yeniden uretmek icin:

```sh
node scripts/external-surface-scan.mjs --write --include-vps
```
