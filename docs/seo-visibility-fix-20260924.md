# SEO Görünürlük Düzeltmesi — 2026-09-24

## Owner kararı

Public landing katmanının tamamı indexlenebilir: **hiçbir public sayfa
`noindex` taşımaz** ve tamamı sitemap'e girer. `noindex` yalnızca özel
yüzeylerde kalır (panel, API, health, `/public/downloads/`).
Karar `docs/site-seo-architecture.md` içine işlendi.

## Yapılan düzeltmeler

| Alan | Önce | Sonra |
| --- | --- | --- |
| `landingContextService` index kapısı | Envanteri boş kategori landing'leri `noindex` | Tüm public landing'ler `index, follow` |
| Sitemap kapsamı | 254 URL (kategoriler hariç) | 261 URL (14 kategori landing'i dahil) |
| `listIndexableLandingSlugs` | Profile bağlı filtre | Envanterden bağımsız 241 landing (39 ilçe + 188 semt + 14 kategori) |
| `vip-gece-seo-sync` timer | Sunucuda hiç kurulu değil; servis `ubuntu` kullanıcısı ve yanlış `.env` koşuluyla çalışamaz durumda | `deploy` kullanıcısı, `DOTENV_CONFIG_PATH` doğru; günlük 04:15 UTC enable edildi |
| `vip-gece-indexnow` unit | 5 dakikada bir, doğrudan node | Sözleşmeye uygun saatlik `npm run indexnow-submit` |
| Sözleşmeler | `contracts.mjs` boş kategori `noindex` bekliyordu | Owner politikasına göre güncellendi; tüm SEO sözleşmeleri yeşil |

Canlı release: `20260924T0300Z-seo-index-live-4c48c085`
(rollback: `20260923T1430Z-customer-213-bc9c1bf5`).

## İlk GSC senkron sonucu (261 URL inspection)

| Google durumu | Adet |
| --- | --- |
| Gönderildi ve dizine eklendi | 1 |
| Tarandı — şu anda dizine eklenmiş değil | 213 |
| "Sunucu hatası (5xx)" (eski tarama) | 34 |
| Keşfedildi — dizine eklenmiş değil | 5 |
| URL Google tarafından bilinmiyor | 4 |
| "noindex" etiketi (eski tarama) | 4 |

- 34 "5xx" kaydının tamamı canlıda **200**; Google'ın son taramaları
  30 Ağu – 6 Eyl (eski release dönemi) → **bayat veri**, güncel hata değil.
- 4 "noindex" kaydı (otel/yabanci/kumral/balık-etli) Temmuz–Ağustos
  taramalarından; bu sayfalar artık indexlenebilir.
- Sitemap ve image-sitemap GSC'ye yeniden gönderildi (senkron raporunda
  `submitted_sitemaps` iki URL'i de içeriyor).
- Arama performansı (22 Ağu – 21 Eyl): **1 tıklama, 6 gösterim**.
- Demand snapshot üretildi: 3 landing'de gözlemlenen talep (72 saatte 122 satır).

## Sonuç ve sınır

`noindex` engeli kaldırıldı, sitemap genişledi, izleme otomasyonu artık
çalışıyor; ancak **213 URL'in "tarandı - dizine eklenmedi" durumu içerik
derinliği kaynaklıdır**. Google ince/benzer sayfaları indekslemeyi reddeder;
indeksleme süreleri haftalar alır. Trafik için asıl lever gerçek profil
envanteri ve içerik derinliğidir.

## Sıradaki adımlar

1. GSC UI'da öncelikli URL'ler için "Indexleme isteniyor" (API bunu
   desteklemiyor; `gsc-manual-index-queue` listeyi hazırlar).
2. Profil envanteri ve landing içerik derinliğini artırmak (213 URL).
3. Günlük `vip-gece-seo-sync` raporunu izlemek; bayat 5xx/noindex
   kayıtlarının taramalar yenilendikçe düşmesini beklemek.

## Not: `.com` property'si

Ekran görüntüsündeki 42 → 28 düşüş `sc-domain:vip-gece.com` property'sine
aittir. `.com` artık kanonik değil (adres değişikliği 14 Eyl'de iptal
edilmişti) ve Google `.com` URL'lerini düşürmeye devam edecektir; bu
beklenen davranıştır. Takip edilen property `sc-domain:vip-gece.site`'dir.
