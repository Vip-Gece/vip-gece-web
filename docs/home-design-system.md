# VIP GECE Home Design System

Tarih: 2026-06-21
Branch: `develop`

## Renk Tokenlari

- `--home-color-text`: ana beyaz metin
- `--home-color-text-strong`: vurgu beyaz
- `--home-color-copy`: ana aciklama metni
- `--home-color-copy-soft`: ikincil aciklama ve meta
- `--home-color-gold`: kicker ve editorial vurgu
- `--home-color-accent`: ana pembe accent
- `--home-color-accent-strong`: CTA ic parlaklik
- `--home-color-accent-deep`: CTA baslangic tonu
- `--home-color-panel-border`: panel sinirlari
- `--home-color-surface`: ana kart/panel zemini
- `--home-color-surface-soft`: buton ve chip zemini
- `--home-color-surface-muted`: sakin menu zemini

## Tipografi Olcegi

- `--home-font-display`: baslik ve marka serif
- `--home-font-sans`: arayuz sans
- `--home-type-display`: masaustu hero
- `--home-type-display-mobile`: mobil hero
- `--home-type-title-xl`: featured kart basligi
- `--home-type-title-lg`: secili kart basligi
- `--home-type-title`: dizin kart basligi
- `--home-type-body-lg`: hero aciklama
- `--home-type-body`: standart govde
- `--home-type-nav`: menu/chip yazilari

## Spacing Sistemi

- `--home-space-1` = 4
- `--home-space-2` = 8
- `--home-space-3` = 12
- `--home-space-4` = 16
- `--home-space-5` = 18
- `--home-space-6` = 20
- `--home-space-7` = 22
- `--home-space-8` = 24
- `--home-space-9` = 28
- `--home-space-10` = 32

## Patternler

- `panel`: koyu gradient zemin, yumusak pembe border, tek shadow sistemi
- `menu`: sakin glass surface, aktif sekmede koyu accent fill
- `card`: ortak `surface + border + radius-card + hover lift`
- `chip`: kontrol edilebilir yatay akista kullanilan filtre/bolge etiketi
- `story`: mobilde daha kucuk ve arka planda kalan ritmik halka sistemi

## 2026-06-26 Kizil Sicak Neon Revizyonu

Kullanici eski MRS/logo kartli, kizil/sicak neon referansi ana hedefe cok yakin buldu. Bu nedenle ana sayfa gorsel yonu `Neon Minimal Feed` hedefini koruyarak daha sicak kirmizi-turuncu bir palette tasindi.

- `--home-color-accent`: kirmizi neon ana vurgu
- `--home-color-accent-strong`: turuncu sicak parilti
- `--home-color-accent-hot`: pembe/kizil neon gecis
- `--home-bg-page`: siyah/koyu bordo taban, kontrollu kirmizi ve turuncu radial enerji
- `hero brand fallback`: oval/kemer plaka yerine siyah dikdortgen logo karti, sicak neon border ve alt isik cizgisi
- `header`: mobil eski referanstaki uzun kirmizi-turuncu gradient cizgiyi tasiyan daha koyu vitrin zemini

## Page Map

### Masaustu

1. Topbar
2. Hero copy
3. Hero visual
4. Hızlı kategori paneli
5. Bölge chip bar
6. Son eklenenler + VIP vitrin ikili satır
7. Seçili profiller grid
8. Bölgeler + kategoriler dizin satırı
9. Hakkımızda
10. Internal links + footer

### Mobil

1. Logo
2. Sakin chip-menu
3. Hero copy
4. CTA satırı
5. Highlight kutuları
6. Hero görsel
7. Hızlı kategori yatay akışı
8. Bölge chip akışı
9. VIP vitrin
10. Son eklenenler
11. Seçili profiller iki kolon
12. Bölgeler yatay akışı
13. Kategoriler yatay akışı
14. Hakkımızda
15. Internal links
