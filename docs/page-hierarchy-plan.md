# VIP GECE Sayfa Yonu ve Hiyerarsi Plani

Tarih: 2026-06-22
Branch: `develop`
Durum: Uygulanan ana yon

## 1. Secilen Ana Yon

Ana yon olarak `Premium Directory` secildi.

Bu yonun secilme nedeni:

- Mobilde yon bulmayi en hizli sekilde cozuyor.
- Ana sayfa, city hub, ilce landing, kategori landing ve profil katmanini
  ayni bilgi mimarisi icinde tutuyor.
- Premium gorunumu korurken, asiri editorial veya asiri feed benzeri
  daginikliga dusmuyor.
- SEO katmanlari icin en saglam iskeleti veriyor: hero, dizin, gecis,
  detail.

## 2. Degerlendirilen Diger Yonler

### Midnight Editorial

Guclu marka hissi veriyor, ancak dizin agirlikli yapida ilce ve kategori
  gecislerini gerektiginden fazla geri itiyor.

Karar:
Ikincil referans olarak tutulur. H1 ritmi, serif display ve daha kontrollu
bosluk kullanimi bu yonden alinabilir.

### Neon Minimal Feed

Mobil hiz icin iyi bir referans, ancak landing mimarisinde authority dagitimini
ve kalici dizin hissini zayiflatma riski var.

Karar:
Kart sikiligi, ritim ve mobil akis sadelemesi tarafinda referans olarak kalir.

## 3. Cekirdek Yapi Kurallari

- Her indexlenebilir sayfa tek ana niyete cevap verir.
- Ust viewport'ta once yon, sonra liste, sonra gecis gelir.
- Home sayfasi disinda profil linkleri ayni sekmede acilir.
- Home sayfasinda profil linkleri yeni sekmede acilir.
- En altta guven/ozellik bandi veya WhatsApp/chat kutusu kullanilmaz.
- Mobil tasarim birincildir; desktop ayni katmanlari daha ferah sekilde tasir.

## 4. Sayfa Tipi Bazli Hiyerarsi

### Ana sayfa `/`

Rol:
Marka vitrini ve ilk dagitim noktasi.

Sirasi:

1. Topbar
2. Hero copy
3. Hero gorsel
4. Hizli kategori paneli
5. Hizli bolge erisimi
6. VIP vitrin
7. Son eklenenler
8. Secili profiller
9. Bolge dizini
10. Kategori dizini
11. Kurumsal/aciklayici blok
12. SEO ic link alani

### Kategori hub `/kategoriler`

Rol:
Kategori landing'lerine inmeden once niyet secimi yaptiran merkezi kategori
dizini.

Sirasi:

1. Kategori hero
2. Kategori istatistikleri
3. Hizli hub gecisleri
4. Sehir ve ilce kopruleri
5. Kategori landing kartlari
6. Son guncellenen profiller
7. SEO ve ic link paneli

### Istanbul city hub `/istanbul-escort`

Rol:
Ilce landing'lerinin ust katmani.

Sirasi:

1. City hero
2. One cikan ilce ve kategori gecisleri
3. Secili city profilleri
4. Son guncellenen city akisi
5. FAQ ve SEO bloklari

### Ilce landing `/:district-escort`

Rol:
Yerel niyetin ana giris noktasi.

Sirasi:

1. Ilce hero
2. Kisa ozet ve kategori gecisi
3. Ilceye ait ana profil akisi
4. Yakin bolgeler
5. Son guncellenenler
6. FAQ ve SEO bloklari

### Kategori landing `/:category-escort`

Rol:
Kategori niyetinin landing noktasi.

Sirasi:

1. Kategori hero
2. Kategori gecisleri
3. One cikan bolgeler
4. Ana profil akisi
5. Taze akis
6. Hub gecisleri
7. FAQ ve SEO bloklari

### Ilan hub `/ilanlar`

Rol:
Genis profil akisini toplayan toplu vitrin katmani.

Sirasi:

1. Ilan hero
2. One cikan ilanlar
3. Son guncellenenler
4. Ilce ve kategori bulutlari
5. SEO paneli

### Profil detay `/profil/:slug`

Rol:
Detay ve donusum katmani.

Sirasi:

1. Breadcrumb
2. Gorsel galeri
3. Profil bilgisi ve iletisim
4. Hub gecisleri
5. Benzer ilanlar
6. Ilgili bolge ve kategori linkleri
7. SEO geri baglanti paneli

## 5. Mobil Oncelikli Kurallar

- Hero altindaki ilk liste bloklari asla uc katmanli karma dizin olmamalidir.
- Iki kolon ancak kart okunurlugu bozulmuyorsa kullanilir.
- Chip ve bulut yapilarinda yatay akis kontrollu kalir, sonsuz kaydirma hissi
  verilmez.
- Hero altindaki ikinci panel, ana hedefi tekrar etmeyen bir yardimci gecis
  paneli olur.
- En sik kullanilan gecisler ilk iki viewport icinde gorunur.

## 6. Uygulama Notu

Bu plan su anki ayri HTML yuzeyleri ile birebir uyumludur:

- `/` -> `index.html`
- `/kategoriler` -> `kategori.html`
- `/istanbul-escort` -> `istanbul.html`
- `/:district-escort` -> `bolge.html`
- `/:category-escort` -> `kategori-landing.html`
- `/ilanlar` -> `ilanlar.html`
- `/profil/:slug` -> `detay.html`
