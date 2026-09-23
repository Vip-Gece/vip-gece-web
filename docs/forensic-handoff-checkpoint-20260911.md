# VIP GECE Forensic Handoff and Checkpoint - 2026-09-11

Bu dosya, aktif oturumdaki VIP GECE kurtarma/deploy calismasinin adli tarzda
devir notudur. Amac: ne yapildi, ne kanitlandi, nerede yanlis yorum riski var,
nerede kalindi ve bir sonraki kisi/oturum neyi hangi sirayla yapmali sorularina
tek yerden cevap vermek.

## 1. Kapsam

- Proje: `C:\Users\o-neo\Documents\Vip-Gece-Web-Gelistirme`
- Canli hedef: Hetzner sunucu `159.69.146.114`, isim `O-NEO.VIP-GECE`
- Kullanici onceligi: once site kurtarma/canliya alma, sonra Windows Defender
  ve Chrome dahil yerel adli inceleme.
- Bu devir notu yazilirken canliya yeni paket gecisi baslatilmadi. Once oturum
  gecmisi ve SSH durumu netlestirildi.

## 2. Kaynaklar ve Kanit Seviyesi

Bu rapor uc seviyeyi ayri tutar:

- Dogrudan kanit: bu oturumda komut sonucu, dosya icerigi, test cikisi veya SSH
  ayrintili baglanti kaydi ile gorulen bilgi.
- Oturum karari: kullanicinin bu oturumda verdigi karar veya is istegi.
- Bekleyen dogrulama: yapilmadan kesin sonuc verilmeyecek is.

Not: Bu ortamda mevcut aktif Codex/ChatGPT oturumunun ham transcript'ini dosya
gibi bastan sona okumaya yarayan ayri bir `read_thread` araci bulunamadi.
Bu nedenle rapor, bu goreve verilen oturum ozeti, yerel repo kanitlari ve
mevcut dosya/komut durumuna dayanir. Bu ayrim kasitlidir; kesin kanit olmayan
yerler kesin kanit gibi yazilmamistir.

## 3. Sabit Kullanici Kararlari

- `codex-sandbox.exe` kullanilmayacak.
- Site kurtarma/deploy isi, Defender/Chrome/Windows adli incelemesinden once
  gelir. Defender dosyalari kanit hedefidir; tek basina zararlilik kaniti
  sayilmayacak.
- Admin panelinde otomatik AI/gorsel uretimi olmayacak.
- Admin girisi icin hedef hesap `bkaytanci00@gmail.com` olacak.
- Admin girisinde kalici cookie/session saklama istenmiyor.
- Admin paneli ucuncu taraf script, worker, hook, tracking ve benzeri yuzeylere
  karsi sertlestirilecek.
- Sunucu SSH tarafinda FIDO/U2F zorunlulugu isteniyor, fakat bu canliya
  uygulanmadan once konsol veya ikinci acik oturum sart.
- Supabase/profil gorsel sorunu, Cloudflare, Google Search Console ve Analytics
  baglantilari canli dogrulamaya kadar acik is olarak kalir.

## 4. SSH Durumu - Kritik Duzeltme

Kullanici hakli olarak "kac saattir SSH baglisin, neden anahtar yok dedin" diye
itiraz etti. Kanitlara gore asil durum su:

### 4.1 Dogru SSH kaydi var

`C:\Users\o-neo\.ssh\config` icinde `vip-gece-hetzner` host kaydi bulunuyor:

```text
Host vip-gece-hetzner
    HostName 159.69.146.114
    User root
    IdentityFile ~/.ssh/vip_gece_hetzner_ed25519
    IdentitiesOnly yes
    StrictHostKeyChecking yes
```

Bu kayit, dogrudan `ssh root@159.69.146.114` yerine `ssh vip-gece-hetzner`
kullanilmasi gerektigini gosterir.

### 4.2 Dogru anahtar kabul edildi

Ayrintili SSH kaniti su akisi gosterdi:

```text
Offering public key: vip_gece_hetzner_ed25519
Server accepts key: vip_gece_hetzner_ed25519
Authenticated to 159.69.146.114 using "publickey".
```

Dogru public key parmak izi:

```text
SHA256:sr2gRJ0E8LqnZ7vS4Wq/HyG2k6tWt0tLodsfAWQpWQI
```

Sunucu host key parmak izi:

```text
SHA256:spvyRWXkiG9PuQyV2gVj0Qv0uIIb+oj7wE3yTefpu08
```

### 4.3 Yanlis negatifin nedeni

Onceki "SSH yok / dogrulanmis kayit yok" izlenimi su yuzden olusmus gorunuyor:

- Bir testte `vip-gece-hetzner` alias'i yerine IP'ye dogrudan baglanma denendi.
- Baska bir denemede sonradan olusturulmus farkli anahtar denendi.
- Sunucu bu farkli anahtari reddetti; bu normal.
- Bu red, asil kalici anahtarin silindigi anlamina gelmez.

Bu nedenle mevcut sonuca gore tekrar SSH anahtari eklemek gerekmiyor. Tekrar
eklemek, yetkili anahtar listesini gereksiz kalabaliklastirir ve adli izlemeyi
zorlastirir. Ancak canli sunucuda `authorized_keys` denetlenirken yukaridaki
`SHA256:sr2g...` parmak izi bulunamazsa, yalnizca bu dogru public key yeniden
eklenmelidir.

### 4.4 Yerel SSH dosya zamanlari

Yerel `.ssh` metadata kanitlari:

- `vip_gece_hetzner_ed25519`: olusturma zamani `2026-09-11 08:27:36`
- `vip_gece_hetzner_ed25519.pub`: olusturma zamani `2026-09-11 08:27:36`
- `.ssh\config`: guncelleme zamani `2026-09-11 13:13:35`
- `vip-gece-hetzner-20260911`: sonradan olusan ayrica bir anahtar,
  `2026-09-11 20:13:32`

Bu ikinci anahtar, asil calisan anahtar degil gibi duruyor.

### 4.5 Windows log durumu

Windows `OpenSSH/Operational` ve `OpenSSH/Admin` event log tarafinda kayit
sayisi `0` goruldu. Bu, "hicbir sey olmadi" kaniti degildir; sadece bu iki
kanalda kullanilabilir OpenSSH olay kaydi bulunmadigini gosterir.

## 5. Sunucu Erisim Checkpoint'i

Dogru alias ile sunucuya erisim kanitlandi:

```text
remote_ok
hostname: O-NEO
user: root
```

Canli symlink o anda su release'i gosteriyordu:

```text
/var/www/vip-gece-site/releases/20260911T1430Z-clean-f3aa9826-704da90e
```

`/var/www/vip-gece-site` dizini `deploy:deploy` sahipliginde goruldu.

Root kullanicisi altinda `pm2 status` bos gorundu. Bu tek basina uygulama
calismiyor demek degildir; PM2 daha once `deploy` kullanicisi veya systemd
servisi altinda calismis olabilir. Bekleyen dogrulama:

```text
sudo -u deploy PM2_HOME=/home/deploy/.pm2 pm2 status
systemctl status pm2-deploy
```

Bu iki kontrol yapilmadan "PM2 yok" veya "uygulama kapali" denmeyecek.

## 6. Yerel Kod Degisiklikleri - Ozet

### 6.1 Admin guvenligi

Yapilan ana sertlestirmeler:

- Admin Supabase auth kalici session saklamayacak sekilde ayarlandi:
  `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:true`.
- Admin paneli CDN uzerinden Supabase yuklemeyi birakti; lokal vendor dosya
  kullaniliyor.
- Admin PWA/service worker yuzeyi etkisiz hale getirildi.
- Admin CSP ve Permissions-Policy sertlestirildi:
  - `worker-src 'none'`
  - `manifest-src 'none'`
  - `frame-src 'none'`
  - admin icin no-store, no-referrer, noindex
- Admin icin Google/FIDO tabanli giris butonu eklendi.
- Eski sifreli giris sadece yedek yol olarak duruyor.

Onemli sinir: Bir web sitesi kendi admin sayfasindaki script/worker/frame ve
izinleri kisitlayabilir. Fakat Chrome eklentilerini, isletim sistemi seviyesini,
ag cihazini veya baska sekmelerde calisan izleme araclarini tek basina kontrol
edemez. Bunlar ayri Windows/Chrome adli inceleme konusudur.

### 6.2 Admin SEO ve Search izleme

Eklenen/degistirilen yuzeyler:

- `src/services/adminSeoControlService.js`
- `public/js/admin/seo-control.js`
- `src/routes/adminOpsRoutes.js`
- `vg-panel-91x.html`
- `admin.css`
- `public/js/admin/index.js`

Admin paneline canli SEO kontrol yuzeyi eklendi. Amac: profil, sitemap,
robots, kirik gorsel ve eski Supabase host izlerini admin icinden gorunur
yapmak.

### 6.3 SEO dili

Profil SEO dili "Profil Ilani" ekseninden "Escort Ilani" eksenine cekildi.
Etkilenen ana dosyalar:

- `src/utils/profileSeo.js`
- `src/services/render/detailRenderer.js`
- `public/js/detail/utils.js`
- `public/js/admin/profiles.js`
- `scripts/contracts.mjs`

### 6.4 AI/gorsel uretim yuzeyi

Eski otomatik icerik/gorsel uretim yuzeyleri temiz paket disinda birakildi.
Bu karar, kullanicinin "bu projede yapay zeka ya da gorsel uretimi olmayacak"
kararina baglidir. Profil gorselleri normal yukleme ve mevcut medya yonetimi
kapsaminda kalir.

## 7. Profil Gorselleri ve Supabase Bulgusu

Eksik gorseller icin on bulgu:

- Eski eksik profil gorsel referanslari eski Supabase host'una isaret ediyor:
  `hofblpqaxzhybozavtaz.supabase.co`
- Bu host mevcut durumda cozulmuyor.
- Onceki incelemede 12 profil icin 41 eski gorsel referansi goruldu.
- Bu eski gorsellerin kaynak byte'lari mevcut canli sunucuda veya mevcut
  Supabase storage tarafinda kanitlanmis sekilde bulunamadi.

Sonuc: Admin panel eski/kirik gorsel referanslarini gosterebilir, fakat kayip
orijinal fotograf byte'lari bulunmadan otomatik geri yukleme yapamaz.

## 8. Test ve Paket Kanitlari

Son dogrulanan komutlar:

```text
npm run admin-role-contract
sonuc: gecti, ok:true, 29 assertion

npm run secret-scan
sonuc: gecti, runtime source icinde secret-like deger bulunmadi

npm run contracts
sonuc: son run gecti, exit 0
```

`npm run contracts` icin onemli not:

- Ilk denemede `SITE_URL` local test adresine ayarlanmadan calistigi icin
  JSON-LD/robots/sitemap uyumsuzluklari verdi.
- Sonra local fetch tarafinda `ECONNRESET` gibi gecici baglanti kopmalari
  goruldu.
- `scripts/contracts.mjs` icindeki request yardimcisi gecici local fetch
  hatalarinda retry yapacak sekilde sertlestirildi.
- `SMOKE_BASE_URL`, `EXPECTED_SITE_URL`, `SITE_URL` ayni local adrese cekilince
  tam kontrat seti temiz gecti.

Paket kaniti:

```text
C:\Users\o-neo\Documents\patches\vip-gece-runtime-20260810-seo-index-automation.tar.gz
SHA256: 8289d5b29b2ecce3f19c88f12c77d5236250d1878580d91df4c80b577b9194aa
```

Paket dogrulama komutu daha once gecti. Ancak bu paketten sonra FIDO/U2F ops
dosyalari eklendiyse mevcut calisma agaci paketle birebir ayni olmayabilir.
Bu nedenle canli deploy oncesi paket yeniden uretilmeli ve yeniden
dogrulanmalidir.

## 9. FIDO/U2F SSH Sertlestirme Durumu

Eklenen ops dosyalari:

- `ops/hetzner/sshd-fido-u2f-hardening.conf`
- `ops/hetzner/pam-u2f-sshd.example`
- `ops/hetzner/sudo-fido-u2f.example`
- `ops/hetzner/install-ssh-fido-u2f-hardening.sh`
- `ops/hetzner/README.md`

Bu dosyalar hazirliktir. Canli sunucuda otomatik uygulanmadi.

Kilitlenme riski oldugu icin script bilerek emniyet kilidi ister:

```text
VIP_GECE_FIDO_APPLY=I_UNDERSTAND_LOCKOUT_RISK
```

FIDO SSH zorunlulugu ancak su sartlarda uygulanmali:

1. Hetzner console acik olacak.
2. Ikinci bir root SSH oturumu zaten acik olacak.
3. `libpam-u2f` ve `pamu2fcfg` kurulacak.
4. Donanim anahtari `/etc/security/u2f_keys` icine kaydedilecek.
5. SSH reload sonrasi yeni bir terminalden FIDO prompt dogrulanacak.
6. Eski oturum ancak yeni oturum calistigi kanitlandiktan sonra kapatilacak.

## 10. GitHub ve Repo Durumu

Kullanici eski GitHub izlerinin temizlenmesini ve temiz tek baslangic halinde
yuklenmesini istedi.

Mevcut durum:

- Repo icinde Git calisma agaci degisik.
- Birden fazla dosya degisti ve yeni dosyalar eklendi.
- Eski `.git` kaldirma/sifirlama konusu riskli ve dis baglanti/push ile
  iliskili oldugu icin bu checkpoint aninda ilerletilmedi.
- GitHub credential manager tarafinda ayri giris penceresi acildi; bu, ChatGPT
  GitHub eklentisinden farkli olarak Windows Git'in kendi kimlik deposudur.

Handoff karari:

- Temiz kaynak agaci kesinlesmeden GitHub'a force push yapilmayacak.
- GitHub'a yukleme icin once bu handoff'taki pending maddeler kapatilacak.
- Sonra temiz tek commit veya orphan root commit ile sifir gorunumlu yayin
  karari ayrica alinacak.

## 11. Bas Mimar Durumu

Kullanici bas mimarin kararinin takip edilmesini istedi. Bu ortamda sabitlenmis
ChatGPT oturumuna mesaj atmaya veya onun ham gecmisini okumaya yarayan
calisabilir bir thread araci bu turnde bulunamadi. Bu nedenle bu dosya, bas
mimara aktarilabilecek teknik/adli checkpoint olarak hazirlandi.

Bas mimara aktarilacak kisa ozet:

```text
VIP GECE repo temizleme, admin guvenlik sertlestirme, SEO kontrol paneli ve
SSH/FIDO hazirliklari yerelde ilerledi. Dogru SSH alias ve eski kalici anahtar
calisiyor; onceki "anahtar yok" izlenimi yanlis kimlik/yanlis baglanti testi
kaynakli. Canli deploy henuz bu checkpoint sonrasinda yapilmadi. Paket tekrar
uretilip dogrulandiktan sonra Hetzner'e yuklenmeli, deploy kullanicisi PM2
durumu kontrol edilmeli, sonra symlink/restart/health/SEO canli proof alinmali.
```

## 12. Bekleyen Isler - Sirali Checkpoint

Canliya gecmeden once:

1. `git status` incelenecek; ilgisiz/istenmeyen dosya var mi bakilacak.
2. `npm run admin-role-contract` tekrar calisacak.
3. `npm run secret-scan` tekrar calisacak.
4. Local dogrulama sunucusu dogru env ile acilacak.
5. `npm run contracts` tam ve temiz gececek.
6. Local sunucu kapatilacak.
7. `npm run package-staging` yeniden calisacak.
8. `npm run verify-package` yeniden calisacak.
9. Yeni paket SHA kaydedilecek.
10. Paket `vip-gece-hetzner` SSH alias'i ile sunucuya yuklenecek.
11. Sunucuda yeni release dizinine acilacak.
12. Mevcut `.env` secret yazdirilmadan korunacak/guncellenecek.
13. `ADMIN_EMAILS` icinde `bkaytanci00@gmail.com` oldugu dogrulanacak.
14. Deploy kullanicisi PM2/systemd durumu kontrol edilecek.
15. `current` symlink atomik olarak yeni release'e alinacak.
16. Uygulama restart edilecek.
17. `/api/ready` ve temel public sayfalar kontrol edilecek.
18. Admin panel no-store/CSP/no-worker politikasi canlida kontrol edilecek.
19. SEO live audit ve sitemap kontrolu yapilacak.
20. Supabase profil gorsel kaynagi ayrica incelenecek.
21. Cloudflare cache/DNS/SSL/WAF ayarlari dogrulanacak.
22. Google Search Console ve Analytics baglantilari canlida dogrulanacak.
23. GitHub temiz yayini ancak bu kontrollerden sonra yapilacak.
24. Site recovery kapandiktan sonra Defender/Chrome/Windows adli incelemeye
    gecilecek.

## 13. Su Anda Durma Nedeni

Kullanici son olarak once tum oturum gecmisinin okunmasini ve A'dan Z'ye
forensic handoff/checkpoint yazilmasini istedi. Bu nedenle deploy/push/SSH
yeniden anahtar ekleme gibi dis etkili adimlar durduruldu.

Bu noktada guvenli bir sonraki adim:

- Once bu dosya kullanici tarafindan okunur.
- Kullanici "devam et, paketi yeniden uret ve canliya al" derse paket yeniden
  uretilir, dogrulanir ve Hetzner'e uygulanir.
- Kullanici "once SSH yetkilerini tekrar denetle" derse sadece dogru alias ve
  dogru public key parmak iziyle read-only SSH denetimi yapilir.

