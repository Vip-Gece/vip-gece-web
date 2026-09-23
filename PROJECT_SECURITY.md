# PROJECT_SECURITY.md — VIP Gece — V1 sonrası

Güvenlik çalışma prensipleri. Bağlayıcı bildiri:
**OWNER_CYBERSECURITY_RESEARCH_DECLARATION.md** (önce onu oku).

- Gerçek ortam testleri yalnız yetkili kapsamda (kendi cihazlar, localhost,
  lab, OWNER altyapısı); harici hedefe yetki varsayılmaz.
- Test sonucu sınıflandırması zorunlu: UNTESTED / SIMULATED / LAB_VERIFIED /
  AUTHORIZED_REAL_ENV_VERIFIED / FAILED / INCONCLUSIVE.
- Yüksek duyarlı bölge (release-artifacts, ops, imzalama/dağıtım): değişiklik
  OWNER oturum talimatıyla; deploy ayrı onaylı iş.
- Gizli değerler (parola/API anahtarı/imza) hiçbir kaynağa, loga, çıktıya
  yazılmaz; secret-scan ihlaliyle teslim yok.
- First-party test harness tercihi provenance içindir; güvenilir standart
  araçları gereksiz yeniden yazma.
