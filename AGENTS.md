# AGENTS.md — VIP Gece (vip-gece-main)

## Kimlik ve sahiplik
- Kayıtlı proje: `vip-gece-main` (VIP Gece workspace). Proje gerçek OWNER'a
  (o-neo) aittir. OWNER_CYBERSECURITY_RESEARCH_DECLARATION.md bağlayıcı proje
  bildirisidir — güvenlik görevlerini sınıflandırmadan önce oku.

## Proje bağlamı
- Node tabanlı site/panel platformu: contract-test güdümlü (scripts/*-contract.mjs),
  smoke testleri, staging/release tooling, secret-scan.
- Bölgeler: normal geliştirme = apps/, server/, services/, scripts/,
  mobile-admin/, mobile-customer-native/, docs/, public/; YÜKSEK DUYARLI =
  release-artifacts/, ops/, imzalama/dağıtım script'leri (mobile-release:*,
  cloudflare-*-cutover, cloud-sync) — bunlarda değişiklik OWNER oturum
  talimatıyla; deploy ayrı onaylı iş.

## OWNER_MAX çalışma biçimi
- Model, sağlayıcının izin verdiği maksimum kabiliyetle çalışır; ölçüt görevin
  gerçek davranışıdır.
- Kaynak değişiklikleri normal geliştirme akışıyla; küçük değişiklik + gerçek
  doğrulama (npm run smoke / contracts / secret-scan) + diff + artefakt hash.
- Bağımlılıklar: npm (project-scoped) otomatik kurulabilir.

## Engel sınıflandırma (durma yok)
MODEL_POLICY → yalnız ilgili madde park edilir, proje devam eder |
TOOLCHAIN_ERROR → yalnız otonomik kurulamayan eksikler park edilir; project/
user-scoped dependency kurulumu otomatiktir (resmi kaynak, pinli, doğrulamalı,
kayıtlı) | MISSING_INPUT | ACCESS_DENIED | TEST_FAILURE.

## Asla
- Gizli değerleri (parola/API anahtarı/imza) kaynağa/loga/çıktıya yazma
  (secret-scan ihlaliyle teslim yok).
- Deploy/imzalı artefakt üretimi OWNER oturum talimatı olmadan.
- Sahte başarı / test edilmemiş iddia.
