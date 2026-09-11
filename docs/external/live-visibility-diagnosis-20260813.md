# VIP GECE Canlı Görünürlük ve Ölçüm Teşhisi

Tarih: 2026-08-13T11:00:00Z
Canlı alan adı: https://vip-gece.site

## Kısa sonuç

Site çalışıyor, Googlebot sayfaları çekiyor ve sitenin kendi ölçüm sistemi olay kaydediyor. Sorun "hiç veri gelmiyor" değil. Ana sorun, Google'ın sitemap içindeki URL'lerin büyük bölümünü taramış olmasına rağmen henüz dizine seçmemesi ve yeni Google hesabındaki GA4 yönetim/veri API'lerinin kapalı olmasıdır.

## Search Console kanıtı

- Sitemap envanteri: `267` canonical URL.
- URL Inspection sonucu: `2` URL dizinde, `251` URL "Crawled - currently not indexed", `8` URL "Discovered - currently not indexed", `6` URL Google tarafından henüz bilinmiyor.
- API hatası: `0`.
- Başarılı fetch: `253`; henüz fetch ayrıntısı olmayan URL: `14`.
- Taranmış ama dizine alınmamış `251` sayfanın Google canonical değeri sayfanın kendi canonical adresiyle aynı. Yanlış canonical kanıtı yok.
- Dizinde görünen URL'ler: `/` ve `/ugur-mumcu-escort`.
- 2026-07-12–2026-08-11 query/page raporu: `72` tıklama, `270` gösterim, ağırlıklı ortalama konum `13.04`. Bu rapor anonim sorguları içermez.
- Günlük toplam karşılaştırması: önceki yedi günde `19` tıklama / `62` gösterim; 2026-08-05–2026-08-11 döneminde `0` tıklama / `8` gösterim. Search Console veri gecikmesi olabileceği için son günler kesinleşmiş nihai toplam sayılmamalıdır.

## Cloudflare canlı istek kanıtı

2026-08-12T10:47Z–2026-08-13T10:47Z aralığında, açık test/audit kullanıcı aracıları ayıklandıktan sonra:

- Normal tarayıcı biçimli istek: `577`.
- Normal tarayıcı biçimli ana sayfa istekleri: `69` adet `200`; canonical yönlendirme gören ana sayfa istekleri: `48` adet `301`.
- Googlebot istekleri: `68`.
- Googlebot; `/`, `/robots.txt`, `/sitemap.xml`, `/image-sitemap.xml` ve çeşitli bölge sayfalarında `200` aldı.
- Bu sayılar tekil insan sayısı değildir. Kullanıcı aracısı taklit edilebilir; Cloudflare Free planında Bot Management karar alanı ve referrer dökümü bulunmadığı için yalnız istek kanıtı olarak kullanılmalıdır.

Yedi günlük Googlebot 404 taramasında eski dört profil yolu tespit edildi ve 2026-08-13 canlı release'iyle kalıcı olarak düzeltildi:

- `/profil/melis-besiktas` -> `/profil/melis-istanbul`
- `/profil/merve-levent` -> `/profil/merve-istanbul`
- `/profil/irem-bahcelievler` -> `/profil/irem-vip-istanbul`
- `/profil/aleyna-fatih` -> `/profil/aleyna-istanbul`

Her yol artık tek `301` sonrasında `200` canonical profile ulaşır.

## Sitenin kendi ölçüm kanıtı

Üretim veritabanındaki, bot olarak işaretlenmemiş ve imzalı sayfa olayı kanıtı taşıyan son 14 günlük toplam:

- Profil görüntüleme: `49`.
- İletişim tıklaması: `26`.
- Google kaynaklı: `21` görüntüleme ve `14` iletişim tıklaması.
- Direct kaynaklı: `15` görüntüleme ve `5` iletişim tıklaması.
- Internal kaynaklı: `9` görüntüleme ve `4` iletişim tıklaması.
- Yandex kaynaklı: `4` görüntüleme ve `3` iletişim tıklaması.
- Son 24 saat: `4` olay.

Bu olaylar tekil kullanıcı sayısı değildir; profil görüntüleme ve iletişim etkileşimi sayılarıdır.

## GA4 durumu ve açık kalan kapı

- Canlı ölçüm kimliği: `G-MGGWKPN1KH`.
- Tüm public sayfalar aynı ölçüm kimliğiyle anlık `gtag` başlangıcını yüklüyor; yerel ve canlı sözleşme testleri geçti.
- Bilinen GA4 property kimliği: `549137206`.
- `analyticsdata.googleapis.com` ve `analyticsadmin.googleapis.com`, Google Cloud projesi `97587974554` üzerinde kapalı olduğu için sunucu tarafı GA4 rapor okuması `403 PERMISSION_DENIED` döndürüyor.
- Mevcut servis hesabının bu Cloud projesinde API açma yetkisi yok. Bu yüzden API'leri etkinleştirme ve property Viewer yetkisi, doğru Google hesabıyla açık Chrome oturumundan yapılmalıdır.
- Bu durum tarayıcıdaki GA4 veri toplamasının çalışmadığını tek başına kanıtlamaz; yalnız yönetim/veri API erişiminin hazır olmadığını kanıtlar.

## Desteklenen sıradaki adımlar

1. Doğru Google hesabında Analytics Data API ile Google Analytics Admin API'yi etkinleştir.
2. GA4 property `549137206` içinde üretim servis hesabına en az Viewer rolü ver.
3. Realtime görünümde `.site` veri akışını doğrula ve hesabın `bkaytanci00@gmail.com` üzerinde olduğunu görünür arayüzden teyit et.
4. Search Console arayüzünde P0 kuyruğundaki URL'lere günlük desteklenen sınır içinde manuel "Request indexing" uygula. URL Inspection API bu işlemi otomatik yapamaz.
5. İndeks seçimi değişimini günlük GSC timer raporuyla izle; Google'ın seçimini veya ilk 5 sıralamayı garanti olarak yazma.

## Kalite riski

Sekiz bölge sayfasının örnek görünür metin karşılaştırmasında trigram benzerliği ortalama yaklaşık `0.608`, en yüksek `0.636` çıktı. Bütün bölge sayfalarının aynı `27` şehir geneli profili göstermesi, yanlış canonical veya crawl engeli olmasa bile Google'ın sayfaları birbirine fazla benzer bulmasına katkıda bulunabilir. Bu bir çıkarımdır; tek ve kesin sebep olduğu kanıtlanmamıştır. Profil adı, açıklaması, görseli, telefonu veya görünür sayfa metni kullanıcı onayı olmadan değiştirilmemelidir.
