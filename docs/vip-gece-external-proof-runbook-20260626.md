# VIP GECE External Proof Runbook - 2026-09-11

Bu dosya, canlıya alma ve dış pazarlama/SEO kanıtlarının nasıl tutulacağını anlatır. Secret, token, şifre, cookie veya kişisel credential bu repoya yazılmaz.

## Temel Kural

- `docs/external/_templates/` altındaki dosyalar yalnızca şablondur; proof sayılmaz.
- `docs/external/_drafts/` altındaki dosyalar çalışma taslağıdır; proof sayılmaz.
- `docs/external/*.md` altına yalnızca gerçek hesap, rapor, karar veya canlı doğrulama kanıtı geldikten sonra dosya eklenir.
- Boolean env flag tek başına yeterli değildir; geçerli proof dosyası veya `VIP_GECE_*_PROOF=/secure/path/...` override gerekir.
- Proof dosyaları zorunlu alanları dolu, placeholder temizlenmiş ve secretsiz olmalıdır.

## Yardımcı Komutlar

Eksik dış kanıtları raporlamak:

```sh
npm run external-proof-intake -- --markdown
```

Güvenli çalışma taslaklarını üretmek:

```sh
npm run external-proof-intake -- --write-drafts
```

Doldurulan taslağı proof alanına taşımak:

```sh
npm run external-proof-intake -- --promote=semrush
npm run external-proof-intake -- --promote=seo-audit
```

Proof id'leri: `production`, `semrush`, `seo-audit`, `brand24`, `similarweb`, `conductor`, `channel99`, `lead-crm`.

## Gate 1 - Production Deploy

Güncel temiz paket SHA: `6a7d685116e27c6b777b39028bfab883c36118d46260b210d8483d067c93e74d`

Kanıt tamamlamak için canlı switch sonrası strict audit çalıştırılır:

```sh
npm run live-seo-audit -- --strict
npm run full-goal-readiness -- --strict
```

Minimum production proof:

- `docs/external/production-deploy-vip-gece.md` veya `VIP_GECE_PRODUCTION_PROOF` dosyası valid olmalı.
- `Production URL` değeri `https://vip-gece.site` olmalı.
- `Deployed package SHA` güncel paket SHA ile eşleşmeli.
- `Live SEO result` strict audit sonucunu `ok=true` olarak kaydetmeli.

## Gate 2 - Marketing SEO / Mention / Visibility

Gerçek hesap veya rapor kanıtı gelmeden bu gate kapanmaz.

| Başlık | Proof dosyası | Minimum kanıt |
| --- | --- | --- |
| Semrush veya eşdeğer SEO audit | `docs/external/semrush-vip-gece.md` veya `docs/external/seo-audit-vip-gece.md` | proje/domain, audit tarihi, araç/kaynak, rapor/export referansı, ana bulgular |
| Brand24 | `docs/external/brand24-vip-gece.md` | proje/keyword seti, monitoring tarihi, alert veya stream referansı |
| Similarweb | `docs/external/similarweb-vip-gece.md` | rakip domain seti, benchmark tarihi, rapor/export referansı veya açık karar notu |
| Conductor | `docs/external/conductor-vip-gece.md` | kullanıldıysa proje kanıtı, kullanılmadıysa tarihli karar notu |
| Channel99 | `docs/external/channel99-vip-gece.md` | kullanıldıysa attribution kanıtı, kullanılmadıysa tarihli karar notu |
| HighLevel/HubSpot | `docs/external/lead-crm-vip-gece.md` | seçilen CRM kararı veya hesap/proje kanıtı |

Repo dışında tutulan gerçek kanıt dosyaları için env path override kullanılabilir:

```sh
export VIP_GECE_SEMRUSH_PROOF=/secure/path/semrush-vip-gece.md
export VIP_GECE_SEO_AUDIT_PROOF=/secure/path/seo-audit-vip-gece.md
export VIP_GECE_BRAND24_PROOF=/secure/path/brand24-vip-gece.md
npm run full-goal-readiness -- --markdown
```

## Final Kapanış

Tüm prooflar gerçekten tamamlanınca:

```sh
npm run full-goal-readiness -- --strict
npm run list-completion-audit -- --strict
npm run verify-release-candidate
```

Beklenen final durum:

- `full_goal_ready=true`
- `full_goal_complete=true`
- production SHA = current package SHA
- production ve marketing gate'leri valid proof dosyalarıyla verified
