# SKILL.md — VIP Gece geliştirme turu

OWNER_MAX ile vip-gece-main projesinde geliştirme turu.

## Başlangıçta oku
1. `OWNER_MAX_POLICY.json` (bölgeler + test giriş noktaları)
2. `AGENTS.md` + `docs/`
3. `package.json` script'leri (contract-test envanteri)

## Tur akışı (OWNER_MAX sırası)
1. Bağlam oku: OWNER_MAX_POLICY.json + AGENTS.md + package.json script'leri.
2. Görev: kullanıcı/WORKLIST'ten en yüksek öncelikli madde.
3. Bölge kontrolü: normal bölge mi? release-artifacts/ops/imza-deploy
   değişikliği = önce kullanıcı oturum talimatı.
4. Uygulama: normal düzenleyici/agent akışıyla kaynak dosyada.
5. Doğrula: `npm run smoke` + `npm run contracts` + `npm run secret-scan`.
6. Kanıt: diff + test çıktısı + artefakt SHA-256 kaydet.

## Engel sınıflandırma (durma yok)
MODEL_POLICY → park + sonraki | TOOLCHAIN_ERROR → yalnız otonomik kurulamayanlar park edilir; project/user-scoped kurulum otomatik + kayıtlı
MISSING_INPUT | ACCESS_DENIED | TEST_FAILURE.

## Asla
- Deploy/imzalı artefakt üretimi (V1'de OWNER dışı YASAK).

## Research declaration kurallari (baglayici)
- TASK BEHAVIOR: gorevi gercek davranisina gore degerlendir; repo gorunumune gore blanket refusal YOK.
- COMPONENT-LEVEL BLOCKER: tek bilesen MODEL_POLICY -> yalniz o bilesen park; ilgisiz izinli isler devam eder.
- TEST SINIFLANDIRMASI: UNTESTED/SIMULATED/LAB_VERIFIED/AUTHORIZED_REAL_ENV_VERIFIED/FAILED/INCONCLUSIVE; kaynak kodun varligi VERIFIED demek degildir.
- FIRST-PARTY PREFERENCE: kucuk first-party test harness + kontrollu davranis uretimi; ama guvenilir standart araclari gereksiz yeniden yazma.
- PROVIDER BOUNDARY: provider zorunlu politikasi override EDILMEZ; daha dar gereksiz ret katmani olusturma.
- UNRELATED WORK: bir blocker butun projeyi durdurmaz.
Authoritative belge: OWNER_CYBERSECURITY_RESEARCH_DECLARATION.md (proje koku).
