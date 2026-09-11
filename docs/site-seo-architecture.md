# VIP GECE Site SEO ve Bilgi Mimarisi

Tarih: 2026-06-21
Branch: `develop`
Durum: Kalici referans dokumani

2026-06-26 hedef netlestirme: ana arama niyeti gece hayati degil escort
hizmet/dizin niyetidir. Birinci hedef seti 40 parcadir: ana hub icin
`istanbul escort`, yerel katman icin de 39 Istanbul ilcesinin her biriyle
`{ilce} escort`. 2026-06-28 genisletmesiyle bu katmanin altina 188 semt
alias landing'i eklendi; toplam yerel SEO cluster sayisi 228 oldu. Profil
tipi/kategori landingi olan `esmer`, `sarisin`, `kumral`, `zayif`,
`balik-etli`, `kapali` gibi sluglar bu yerel cluster sayisina dahil degildir;
kategori taksonomisi icinden ayri yonetilir. `vip gece` tek
basina marka/mention takibi icin tutulabilir, ancak SEO landing niyeti olarak
`escort` eslik etmeden genis gece hayati kelimesi gibi kullanilmaz.

Tam hedef kelime listesi: `docs/seo-target-keywords-20260626.md`.

Basari metriği: 40 ana non-brand sorguda ilk 5 organik pozisyona girmek;
mumkun olan sorgularda agresif hedef ilk 1 pozisyondur. 188 semt sorgusu,
ilce otoritesini genisleten long-tail destek katmani olarak takip edilir.
`MRS Escort` gibi marka sorgulari reputation/mention takibi icin izlenebilir,
ancak ana SEO hedefi degildir.

## 1. Cekirdek Hedef

VIP GECE, mobil-oncelikli bir Istanbul dizin deneyimi olarak konumlanacak.
Ana hedef; ana sayfa, Istanbul geneli, 39 ilce, kategori ve profil detaylari
arasında net bir bilgi mimarisi kurup her landing page'i farkli bir arama
niyetine cevap verecek sekilde yapilandirmaktir.

Bu mimarinin kurallari:

- Mobil once gelir; desktop ayni sistemi daha ferah bir yogunlukta tasir.
- Her indexlenebilir sayfa tek bir ana niyete sahip olur.
- Ilce sayfalari birbirinin kopyasi olmaz.
- Ic linkleme, breadcrumb ve sitemap ayni taksonomiyi izler.
- Kategori ve bolge sayfalari kullaniciya gercek gecis saglar; bos "doorway"
  sayfalar uretilmez.
- Ana sayfa "brand + hizli gecis + secili listing" rolunu tasir; tum SEO yukunu
  tek basina tasimaz.

## 2. Sayfa Katmanlari

Site uc ana katmandan olusur:

1. Marka ve gecis katmani
   Ana sayfa, Istanbul merkezi ve ana kategori girisleri.
2. Dizin katmani
   Ilce landing'leri, kategori landing'leri ve bunlarin ilgili liste bloklari.
3. Donusum katmani
   Ilan hub, profil detaylari ve bunlardan ilce/kategoriye geri donen gecisler.

Bu sistemde kullanicinin akisi su sekilde tasarlanir:

- Genel giris: `/`
- Sehir veya niyet secimi: `/istanbul-escort`, `/:district-escort`,
  `/:category-escort`
- Listing inceleme: bolge veya kategori icerisindeki kartlar
- Detay inceleme: `/profil/:slug`

## 3. URL ve Taksonomi Mimarisi

### 3.1 Kanonik route ailesi

- `/`
  Ana sayfa
- `/istanbul-escort`
  Istanbul geneli city hub
- `/:district-escort`
  Ilce landing'leri
- `/:neighborhood-escort`
  Semt alias landing'leri; her biri bir parent ilceye baglidir
- `/:category-escort`
  Kategori landing'leri. `esmer-escort`, `sarisin-escort`, `kumral-escort`,
  `zayif-escort`, `balik-etli-escort`, `kapali-escort` gibi profil tipi
  sluglari burada yer alir; ilce veya semt gibi sayilmaz.
- `/profil/:slug`
  Profil detaylari
- `/ilanlar`
  Ilan hub sayfasi
- `/kategoriler`
  Tum kategoriler dizini
- `/iletisim`
  Iletisim / kurumsal sayfa

### 3.2 Indexlenecek URL kurali

Index tarafinda yalnizca su aileler acik tutulur:

- Ana sayfa
- Istanbul city hub
- 39 ilce landing'i
- 188 semt alias landing'i
- Gercekten doldurulmus kategori landing'leri
- Ilan hub sayfasi
- Aktif profil detaylari
- Gerekli kurumsal sayfalar

### 3.3 Indexlenmeyecek URL kurali

Asagidakiler kalici index hedefi olmamali:

- Filtre query'leri: `?sort=`, `?page=`, `?view=`
- Bos veya zayif kombinasyon sayfalari
- Sadece ayni listeyi baska baslikla gosteren varyasyonlar
- Yonetim paneli ve gecici preview rotalari

### 3.4 Kombinasyon sayfalari

`/fatih-escort` ve `/vip-escort` ana landing aileleridir.
`/fatih/vip` benzeri ilce + kategori kombinasyonlari ancak asagidaki durumda
ayri indexlenebilir sayfa olabilir:

- Yeterli aktif icerik varsa
- Gercekten farkli listeleme mantigi varsa
- Benzersiz intro, metadata, breadcrumb ve ic linkleri varsa

Aksi halde bu kombinasyonlar filtre durumu olarak kalmali, kanonik bir ana
landing'e geri baglanmali veya `noindex` olmalidir.

## 4. Sayfa Tipi Bazli Mimari

### 4.1 Ana sayfa `/`

Rol:
Marka vitrini, hizli gecis ve en guclu ic link dagitim noktasi.

Mobil blok sirasi:

1. Sakin topbar
2. Hero copy
3. Ana CTA'lar
4. Hero gorsel
5. Hizli kategori akisi
6. Hizli bolge akisi
7. VIP vitrin
8. Son eklenenler
9. Secili profiller
10. Bolgeler dizini
11. Kategoriler dizini
12. Hakkimizda
13. Internal link dizini

SEO gorevi:

- Brand + Istanbul geneli ana giris sorgularini tasimak
- 39 ilce ve ana kategorilere link authority dagitmak
- Featured profilleri one cikarmak

Schema:

- `WebSite`
- `CollectionPage`
- `ItemList` secili profiller
- `ItemList` ilce dizini

Ic link gorevi:

- Tum ilcelere cikis
- Ana kategorilere cikis
- En guclu profillere cikis
- Istanbul hub'a cikis

### 4.2 Istanbul city hub `/istanbul-escort`

Rol:
Sehir geneli ana dizin ve ilce landing'lerinin ust hub'i.

Olmasi gereken bloklar:

1. H1 ve kisa city intro
2. Istanbul genel secili profiller
3. 39 ilce grid veya sectioned chip map
4. Ana kategori girisleri
5. Son guncellenen profiller
6. SSS veya rehber bloklari
7. Internal links

SEO gorevi:

- Istanbul geneli ana sorgu niyetini tasimak
- Ilce sayfalarina authority aktarmak
- Ana sayfa ile ilce landing'leri arasinda orta katman olmak

Schema:

- `CollectionPage`
- `BreadcrumbList`
- `ItemList` district directory

### 4.3 Ilce landing'leri `/:district-escort`

Rol:
En degerli yerel landing katmani. Her ilce sayfasi farkli bir niyeti tasir.

Her ilce sayfasinda sabit blok sirası:

1. H1
2. Ilceye ozel 2-3 cumlelik intro
3. O ilcedeki secili / guncel profil grid'i
4. Hizli kategori gecisleri
5. Yakin ilceler
6. Son guncellenenler
7. Kisa rehber/SSS
8. Breadcrumb
9. Internal links

Ilce sayfalarinda benzersizlesecek alanlar:

- Intro copy
- Meta title / description
- H1 varyasyonu
- Yakin ilce listesi
- One cikarilan kartlarin sirasi
- FAQ bloklari
- Ic link anchor varyasyonlari

Ilce landing'lerinde bulunmamasi gerekenler:

- Kopya paragraflar
- Yalnizca ilce adinin degistigi sablon metin
- Bos kart bloklari
- O ilceyle ilgisiz anchor yiginlari

Schema:

- `CollectionPage`
- `BreadcrumbList`
- `ItemList`
- Gerekirse gorunur ve gercekse `FAQPage`

### 4.4 Kategori landing'leri `/:category-escort`

Rol:
Niyet bazli ana landing. Kullanici kategori odakli girdiginde bunu karsilar.

Blok sirası:

1. H1 + kategori intro
2. Kategoriye ait secili profiller
3. Onde gelen ilceler
4. Ilgili alt kategoriler veya yakin niyetler
5. Son guncellenenler
6. FAQ veya aciklayici rehber
7. Internal links

Kategori sayfasi kurallari:

- Yalnizca dolu ve aktif kategori sayfalari index acik kalir
- Her kategori sayfasi Istanbul ve guclu ilcelerle cift yonlu baglanir
- Kategori + ilce gecisleri anchor text ile dogal sekilde kurulur

Schema:

- `CollectionPage`
- `BreadcrumbList`
- `ItemList`

### 4.5 Profil detaylari `/profil/:slug`

Rol:
Donusum ve detay katmani.

Blok sirası:

1. H1 veya profil isim alani
2. Gorsel galeri
3. Ilce ve temel meta
4. Profil aciklamasi
5. Iletisim CTA
6. Ilgili bolge linki
7. Benzer profiller
8. Ilgili kategori linkleri

SEO gorevi:

- Uzun kuyruklu profil aramalarini tasimak
- Ilce ve kategori landing'lerine geri authority vermek

Schema:

- `WebPage`
- `BreadcrumbList`
- `ImageObject`
- `LocalBusiness` mevcut yapida kullaniliyor; eger markayi temsil edeceksek
  tutarli kalmali, profilin kendisini "business" gibi anlatmamali

### 4.6 Ilan hub `/ilanlar`

Rol:
Profil landing'leri ile ilce/kategori landing'leri arasinda ikinci bir toplu
gecis katmani kurar.

Blok sirası:

1. H1 + hub intro
2. One cikan ilan vitrini
3. Son guncellenen ilan akisi
4. Ilce chip cloud
5. Kategori chip cloud
6. Internal link ve aciklayici SEO paneli

SEO gorevi:

- "ilanlar" niyetli genel sorgular icin ikinci ana hub olmak
- Profil detaylarina toplu ic link vermek
- Ilce ve kategori landing'lerine geri gecis koridoru saglamak

Schema:

- `CollectionPage`
- `BreadcrumbList`
- `ItemList`

## 5. Metadata Kurallari

### 5.1 Title kalibi

- Ana sayfa:
  `VIP Gece | İstanbul Bölgeleri ve Güncel VIP Profil Vitrini`
- Istanbul hub:
  `İstanbul Escort | İlçelere Göre Güncel VIP Profil Dizini | VIP Gece`
- Ilce landing:
  `{İlçe} Escort | Güncel VIP Profiller ve Bölge Dizini | VIP Gece`
- Kategori landing:
  `{Kategori} | İstanbul Geneli Güncel Profil Dizini | VIP Gece`
- Profil detay:
  `{Ad} | {İlçe} Profil Detayı | VIP Gece`

### 5.2 Description kalibi

Her sayfa icin:

- 140-160 karakter bandi hedeflenir
- Tek bir niyet anlatilir
- Kopya aciklama kullanilmaz
- Ilce + fayda + deneyim ozeti birlikte verilir

### 5.3 H1 kurali

- Her index sayfada tek H1
- H1 ile title ayni olmak zorunda degil ama ayni niyeti tasimali
- H1 altindaki ilk paragraf sayfanin ozel amacini net anlatmali

## 6. Internal Linking Grafigi

### 6.1 Ana dagitim

- Ana sayfa -> Istanbul hub
- Ana sayfa -> 39 ilce
- Ana sayfa -> ana kategoriler
- Ana sayfa -> secili profil detaylari
- Ana sayfa -> ilanlar hub

### 6.2 Ilce duzeyi

- Ilce sayfasi -> Istanbul hub
- Ilce sayfasi -> kendi semt alias landing'leri
- Ilce sayfasi -> yakin ilceler
- Ilce sayfasi -> ilgili kategori landing'leri
- Ilce sayfasi -> aktif profil detaylari
- Ilce sayfasi -> ilanlar hub

### 6.2.1 Semt duzeyi

- Semt sayfasi -> parent ilce landing'i
- Semt sayfasi -> ayni ilcedeki kardes semt alias landing'leri
- Semt sayfasi -> Istanbul hub
- Semt sayfasi -> ilgili kategori landing'leri
- Semt sayfasi -> aktif profil detaylari

### 6.3 Kategori duzeyi

- Kategori sayfasi -> Istanbul hub
- Kategori sayfasi -> onde gelen ilceler
- Kategori sayfasi -> profil detaylari
- Kategori sayfasi -> ilanlar hub
- Kategori sayfasi -> yakin niyetli kategoriler

### 6.4 Profil duzeyi

- Profil -> ilce sayfasi
- Profil -> ilgili kategori sayfasi
- Profil -> benzer profiller
- Profil -> ana sayfa veya Istanbul hub
- Profil -> ilanlar hub

### 6.5 Anchor text kurali

Anchor'lar dogal varyasyonlarla kullanilir:

- `Fatih Escort`
- `Fatih bölgesi`
- `Fatih profilleri`
- `Fatih içindeki güncel profiller`

Ayni anchor kalibi her blokta mekanik olarak tekrar edilmez.

## 7. Schema Katmani

### 7.1 Site seviyesi

- `WebSite`
- `Organization`

### 7.2 Landing sayfalari

- `CollectionPage`
- `BreadcrumbList`
- `ItemList`

### 7.3 Detay sayfalari

- `WebPage`
- `BreadcrumbList`
- `ImageObject`

### 7.4 Sarti bagli schema

- `FAQPage`
  Yalnizca sayfada gorunur gercek soru-cevap bloklari varsa
- `LocalBusiness`
  Marka duzeyinde dikkatli ve tutarli kullanilmali

### 7.5 Kacinilacak schema hatalari

- Sayfada gorunmeyen veri eklemek
- Kendi kendine review / aggregateRating yazmak
- Tum sayfalara ayni schema'yi kopyalamak

## 8. Teknik SEO Gereksinimleri

### 8.1 Render ve indexleme

- Ana sayfa SSR kalmali
- Ilce ve kategori sayfalari da SSR veya en azindan tam HTML icerik ile cikmali
- Canonical her sayfada tek ve dogru olmali
- `allowIndexing` kontrolu merkezi kalmali

### 8.2 Sitemap

Mevcut `sitemap.xml` daha genisletilmeli.

Guncel hedef:

- Ana sayfa
- Istanbul hub
- 39 ilcenin tamami
- Tum aktif kategori landing'leri
- Ilanlar hub
- Aktif profil detaylari
- Gerekli statik sayfalar

Image sitemap aktif profil gorsellerini tasimaya devam etmeli.

### 8.3 Robots

- Admin ve yedek rotalari kapali kalir
- Public landing sayfalari acik kalir
- Gecici filtre sayfalari gerekiyorsa index disi kalir

### 8.4 Performans

- Hero ve ust viewport gorselleri oncelikli yuklenir
- Alt bolumlerde `content-visibility` benzeri hafifletme korunur
- Mobil LCP, CLS ve INP duzeyi kritik KPI olur

### 8.5 Gorsel SEO

- Her kart gorselinde anlamli `alt` metni
- Boyutlar sabit
- Lazy load sadece ilk viewport disinda
- WebP/optimize formatlar korunur

## 9. Icerik Farklilastirma Kurali

39 ilce sayfasini ayakta tutacak ana farklilastirma alanlari:

- Ilceye ozel intro
- Yakin ilceler bolumu
- O ilceye uygun profil sirasi
- Ilceye gore degisen FAQ
- Ilce bazli "son guncellenen" akisi
- Ilceye gore ic link onceligi

Bu katman kurulmadan sadece ayni listeyi 39 kez cikarirsak kopya-zayif sayfa
riski buyur.

## 10. Mobil-Oncelikli UX Kurallari

- Ilce landing'lerinde ilk ekranda H1, kisa aciklama ve ilk kartlar gorunmeli
- Kategori ve bolge gecisleri yatay kaydirma ile rahat kullanilmali
- Kart anatomisi tum landing'lerde sabit kalmali
- En yogun bilgi ilk iki viewport icinde toplanmali
- Desktop bu yapiyi sadece daha genis ve editoriyal bir dagilimla acmali

## 11. Bu Mimarinin Koda Donusme Sirasi

1. `renderCategoryHtml` katmanini ilce ve kategori bazli ayri sablonlara bol
2. Istanbul hub icin ayri template ve metadata sistemi ekle
3. 39 ilcenin tamamini sitemap icine al
4. Breadcrumb ve `ItemList` katmanini ilce/kategori landing'lerine genislet
5. Ilanlar hub icin ayri template ve profile-return akisi kur
6. Her landing icin benzersiz intro/FAQ veri kaynagi olustur
7. Profil detaylarinda ilgili ilce + kategori geri donus bloklarini guclendir
8. Search Console verisine gore title/description iterasyonu yap

## 12. Net Uygulama Karari

Bu proje icin ana yon:

- Tasarim dili: `Premium Directory`
- Dagitim modeli: mobil-oncelikli landing + dizin yapisi + ilan hub
- SEO modeli: home -> Istanbul hub -> ilce/kategori -> ilanlar hub -> profil
- Risk kontrolu: kopya landing ve doorway mantigindan kacinma

Bu dokuman, sonraki adimlarda route, template, schema, sitemap ve icerik
katmanlarinin hepsi icin ana referans olarak kullanilacaktir.

## 13. Teknik ve Icerik Oncelik Sirasi

Bu mimarinin arama tarafinda guclu kalmasi icin uygulanacak ust seviye sira
asagidaki gibi sabitlenir:

1. Render ve mobil kaliteyi koru
   Home, Istanbul hub, ilce, kategori, ilan hub ve profil sayfalari tam HTML
   ciksin; mobil ilk viewport, LCP, CLS ve INP butun landing ailesi icin ana
   KPI olarak izlensin.
2. Yalnizca dolu ve farkli sayfalari indexe ac
   Zayif veya ayni listenin farkli baslikla tekrarlandigi sayfalar index hedefi
   olmamali; ilce ve kategori landing'leri yeterli aktif kart, farkli intro ve
   gercek gecis bloklari tasidigi durumda acik kalmali.
3. Ilce bazli icerik farklilastirmasini veriyle besle
   Her ilce sayfasinda intro, yakin ilceler, FAQ, son guncellenen akisi ve one
   cikan kart sirasi farkli veri setiyle kurulmali; kopya paragraf kullanimi
   sifira yaklastirilmali.
4. Tazelik sinyallerini guclendir
   Son guncellenen bloklari, `lastmod` sitemap degerleri, aktif profil tarihleri
   ve ana hub akislari ayni veri kaynagina baglanmali; guncel icerik rotasyonu
   sabit bir yayin ritmine oturtulmali.
5. Ic link dagitimini merkezden yonet
   Ana sayfa, Istanbul hub, ilce, kategori, ilan hub ve profil sayfalari tek
   graf icinde kalmali; breadcrumb, chip rail, benzer profiller ve hub geri
   donusleri ayni taksonomiyi tekrar etmeli.
6. Schema ve metadata katmanini sayfa niyetiyle birebir tut
   Her landing tek H1, farkli title/description, gorunur `ItemList` verisi ve
   sayfada gercekten var olan FAQ/galeri bloklariyla eslenmeli; copy-paste
   schema veya gorunmeyen veri eklenmemeli.
7. Gorsel ve medya katmanini hafif ama anlamli tut
   Ilk viewport gorselleri oncelikli, alt kartlar lazy, tum gorseller boyutlu
   ve anlamli `alt` metinli kalmali; gereksiz agir media veya tekrar gorsel
   kombinasyonlari temizlenmeli.
8. Search Console ve log verisiyle iterasyon dongusu kur
   En cok gosterim alan landing'lerde title, description, intro ve ic link
   anchor varyasyonlari periyodik olarak gozden gecirilmeli; dusuk CTR veya
   zayif crawl alanlari aylik optimizasyon listesine alinmali.
