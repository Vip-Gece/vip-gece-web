# 0850 901 0757 şirket atfı ve Python hata korelasyonu

Araştırma tarihi: 14 Eylül 2026 (Europe/Istanbul)

## Yönetici özeti

- `0850 901 0757`, BTK kayıtlarında Peakcell İletişim Hizmetleri Limited Şirketi'ne tahsisli `8509010***` bloğundadır. Bu, blok işletmecisini doğrular; tekil numaranın güncel abonesini veya fiili arayanı doğrulamaz.
- Doğan Bilişim atfı yalnız kullanıcı şikayeti ve bayi dizinlerinden gelir. Peakcell ile Doğan Bilişim arasında sözleşme, ortaklık kaydı, resmi partner listesi veya ortak teknik uç bulunmadı.
- Görseldeki `python.exe` hatası telefon şirketlerine ait değildir. Sysmon ve Security 4688 kayıtları, hatanın bu araştırma sırasında Codex'in paketli Python 3.12 çalışma zamanının `pandas` içe aktarma/BTK XLS okuma denemesinde oluştuğunu kesin olarak gösterir.
- Hata veren iki Python işlemine ait Sysmon ağ veya DNS olayı bulunmadı. Ayrı ve daha sonraki bir sistem Python'u işlemi, `xlrd` paketini geçici dizine kurarken `pypi.org` ve `files.pythonhosted.org` adlarını çözümledi; bu olay hata veren PID'lerden bağımsızdır.

## Telefon numarası ve şirket zinciri

### Doğrulanmış blok atfı

BTK'nin 10 Eylül 2026 tarihli Numaralandırma Raporu, `8509010***` bloğunu Peakcell İletişim Hizmetleri Limited Şirketi'ne bağlıyor. BTK'nin 12 Eylül 2026 tarihli KBN.xls tablosunda aynı blok “Kullanılıyor” durumundadır.

- BTK Numaralandırma Raporu: https://www.btk.gov.tr/uploads/ntsfiles/NPR.pdf
- BTK KBN tablosu: https://www.btk.gov.tr/uploads/ntsfiles/KBN.xls
- B293 yönlendirme kodu: https://www.btk.gov.tr/uploads/pages/numara-tasinabilirligi-yonlendirme-kodlari/bxxx.pdf
- 850 numaraların ikincil tahsisi: https://www.btk.gov.tr/uploads/pages/slug/ny-degisiklik-yapilmasina-dair-yonetmelik-kamuoyu-gorusu.pdf

Bu nedenle doğru hüküm: “Numara Peakcell'e tahsisli bloktadır.” Yanlış/geniş hüküm: “Numarayı kesin olarak Peakcell kullanıyor.” Taşıma, ikincil tahsis ve caller-ID taklidi açık kaynaklardan dışlanamamıştır.

### Peakcell tüzel kişilik ve faaliyetler

ETBİS kaydı `peakcell.com.tr` alan adını Peakcell İletişim Hizmetleri Limited Şirketi'ne bağlar; KEP adresi `peakcell@hs01.kep.tr`, ETBİS kayıt tarihi 5 Mayıs 2024'tür.

- ETBİS: https://etbis.ticaret.gov.tr/tr/SiteSorgulamaSonuc?siteId=7c0ccb96-fc15-4d86-88ae-9a79a9e20425
- Güncel iletişim: https://peakcell.com.tr/iletisim/
- Eski iletişim içeriği: https://peakcell.com.tr/peakcell-ile-iletisim/

Güncel iletişim sayfası `0850 901 00 00`, `info@peakcell.com.tr` ve Narlıdere/İzmir adresi yayımlar. Eski resmi sayfa aynı telefon, MERSİS `0295048203700011`, İzmir Ticaret Odası sicil `239576`, KEP adresi ve Folkart Towers/Bayraklı adresi yayımlar. Adresler uyuşmadığından Folkart kaydı güncel merkez olarak kabul edilmemiştir.

Resmi hizmet portföyü:

- 0850 ve coğrafi numara tahsisi/taşıma
- sanal santral ve çağrı merkezi/dialer
- toplu, OTP ve flash SMS/API
- İYS entegrasyonu
- Windows/iOS/Android softphone
- WhatsApp Business, dijital faks, video konferans, sesli mesaj ve Peakdrive
- bayi/iş ortaklığı, uygulama ve arka uç entegrasyonu

Kaynaklar: https://peakcell.com.tr/0850-numara/ , https://peakcell.com.tr/sanal-santral/ , https://peakcell.com.tr/cagri-merkezi/ , https://peakcell.com.tr/toplu-sms/ , https://peakcell.com.tr/iys-entegrasyonu/ , https://peakcell.com.tr/whatsapp-business/ , https://peakcell.com.tr/is-ortakligi/

Kamuya açık, adı verilmiş müşteri/proje listesi bulunmamıştır. Görülenler ürün/hizmet ve genel bayi modelidir.

### Doğan Bilişim, Türk Telekom ve şikayet kümesi

Exact numarayı Doğan Bilişim'e bağlayan doğrudan açık kaynak, 26 Aralık 2025 tarihli tek bir Şikayetvar kullanıcı anlatısıdır. Bu kaynak resmi abone veya soruşturma kaydı değildir.

- Exact şikayet: https://www.sikayetvar.com/08509010757/turk-telekom-bayisinden-yanlis-bilgilendirme-sonucu-yuksek-cayma-bedeli-iptali-talebi
- Exact numara kümesi: https://www.sikayetvar.com/08509010757
- Aynı bloktaki `0850 901 0973` ve Doğan Bilişim iddiası: https://www.sikayetvar.com/turk-telekom/yanlis-bilgilendirme-sonrasi-hat-tasima-ve-cekim-sorunu-magduriyeti

Kullanıcı bildirimlerinde `0850 901 0757`, `0850 901 0634`, `0850 901 0782` ve ayrı bir kayıtta `0850 901 0973` geçer. Dördü de aynı Peakcell `8509010***` bloğundadır. Bu, ortak blok altyapısı için kanıttır; tek şirketin fiili kullanımını kanıtlamaz.

Üçüncü taraf bayi dizinleri Doğan Bilişim Telekomünikasyon'u Plenty Plaza, Çankaya/Ankara adresi ve `0312 419 59 69` ile Türk Telekom bayi kategorisinde listeler. Türk Telekom'un güncel resmi mağaza aramasında bağımsız doğrulama elde edilememiştir.

- https://yakinsube.com/sube/ankara/cankaya/turk-telekom-ofis-ve-magazalari/dogan-bilisim-telekomunikasyon
- https://www.kampanyago.com.tr/cankaya-telekom_bayileri-ilce-60.html
- https://www.tumisyeri.com/do%C4%9Fan-bili%C5%9Fim_2u-0312-419-59-69

Şikayetlerde geçen “İşim Ferah” gerçek bir TT Mobil kurumsal tarifesidir: https://kurumsal.turktelekom.com.tr/mobil/isim-ferah-tarifeleri-prime-business . Türk Telekom'un yayımladığı resmi dönüş numaraları `444 1 444`, `444 5 444` ve `444 0375`tir; hedef 0850 numara resmi listede yoktur: https://www.turktelekom.com.tr/destek/Sayfalar/iletisim.aspx

Peakcell ile Doğan Bilişim arasında doğrudan, doğrulanmış ortaklık bulunmamıştır. “BTK blok → Peakcell” ile “kullanıcı şikayeti → Doğan Bilişim” zincirleri birleştirilerek ortaklık sonucu çıkarılamaz.

### metaversepbx bağlantısı

Peakcell'in resmi sayfaları `metaversepbx.com` üzerinde Kütüphane, dijital servisler ve bakım/evrak sayfalarına bağlantı verir. Bu, resmi siteden çıkan operasyonel web bağlantısını doğrular; alan adı mülkiyetini doğrulamaz. Alan adı 14 Eylül 2026 pasif kontrolde DNS'te çözülmemiş ve RDAP kaydı dönmemiştir; Certificate Transparency geçmişi 2022–2023 döneminde sertifika kullanıldığını gösterir.

- Peakcell sayfası: https://peakcell.com.tr/peakcell-ile-iletisim/
- DNS: https://dns.google/resolve?name=metaversepbx.com&type=A
- RDAP: https://rdap.verisign.com/com/v1/domain/metaversepbx.com
- CT geçmişi: https://crt.sh/?q=metaversepbx.com

## Python hata atfı

### Kesin uygulama ve işlem zinciri

Yerel olay kayıtlarında iki hata vardır:

| Yerel saat | Python PID | Komut | Yerel çocuk süreç | WerFault | Popup |
|---|---:|---|---|---|---|
| 00:26:28 | 11780 | `import pandas`; BTK `btk-kbn.xls` dosyasını `pd.ExcelFile` ile açma | 00:26:41 `cmd.exe /c ver` | 00:26:47 | 00:26:53, System Event 26, Record 5142 |
| 00:32:36 | 12900 | `import pandas; print('ok')` | 00:33:03 `cmd.exe /c ver` | 00:33:12 | 00:33:20, System Event 26, Record 5143 |

Her iki zincir:

`Codex ana süreci (PID 11556) → codex-command-runner → paketli pwsh.exe → paketli python.exe → cmd.exe /c ver ve WerFault.exe`

Hata veren yürütülebilir:

`C:\Users\o-neo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`

SHA-256: `B7A12C3AF0B4DB44191EEC14EA095EBA731B7328917F570806183093D19DDCA2`

Bu dosya, ayrı `C:\Tools\Python313\python.exe` dosyası değildir. Sistem Python'unun gözlenen SHA-256 değeri `85B71D8C6EC1905935F74BE0C9869AAE198D00E98F39DF699EC66F9C5A84CECD`dir.

### Hata kodu ve neden sınırı

Microsoft MS-ERREF'e göre `0xC000070A`, `STATUS_THREADPOOL_HANDLE_EXCEPTION`dır. Bir thread-pool bekleme/handle istisnasıdır; `0xC000007B` veya `STATUS_PROCESS_IS_TERMINATING (0xC000010A)` değildir.

- Microsoft NTSTATUS: https://learn.microsoft.com/fr-fr/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55
- SetThreadpoolWait: https://learn.microsoft.com/en-us/windows/win32/api/threadpoolapiset/nf-threadpoolapiset-setthreadpoolwait

İkinci denemenin yalnız `import pandas` içermesi ve aynı hatayı üretmesi, tetikleyiciyi `.xls` dosyasından veya eksik `xlrd` paketinden önce pandas içe aktarma yoluna daraltır. Aynı paketli Python'un `--version` kontrolü için aynı pencerede WerFault/popup kaydı yoktur. Buna rağmen kesin kusurlu DLL veya fonksiyon söylenemez: Application 1000/1001, WER raporu/dump ve Sysmon Event 7 modül yükleme verisi yoktur.

`cmd.exe /c ver` çocuğu gözlemlenmiştir. Paketli CPython standart kitaplığındaki `platform.py`, Windows sürümü gerektiğinde bu komutu kullanır. Bu ilişki gözlenen çocuk süreci açıklar; istisnanın kesin kaynağının `platform.py` veya pandas olduğunu tek başına kanıtlamaz.

### Paket ve DLL bağımlılıkları

Paketli çalışma zamanı CPython 3.12 ailesidir (`python312.dll`, `cp312` uzantıları). Kurulu başlıca zincir:

`python.exe → python312.dll / VC runtime → pandas 3.0.1 → NumPy 2.3.5 + python-dateutil 2.9.0.post0 + tzdata 2026.3`

Kurulu native bileşenler arasında NumPy'nin `libscipy_openblas64_...dll` dosyası, `msvcp140...dll`, `vcruntime140.dll` ve `vcruntime140_1.dll` vardır. Bunlar kurulu bağımlılıklardır; Event 7/dump olmadığı için hata anında hangisinin yüklü/faulting modül olduğu doğrulanmamıştır.

Pandas 3.0.1 metadata'sı eski `.xls` desteği için `xlrd>=2.0.1`i isteğe bağlı Excel bağımlılığı olarak tanımlar. Paketli çalışma zamanında `xlrd` yoktur; `openpyxl 3.1.5` ve `xlsxwriter 3.2.9` vardır. Daha sonra ayrı `C:\Tools\Python313\python.exe`, `xlrd 2.0.2`yi `%TEMP%\codex_xlrd` altına kurmuş ve BTK XLS dosyası bu ayrı yolla okunmuştur.

## Giriş/çıkış uçları ve ortaklık karşılaştırması

| Varlık | Giriş uçları | Çıkış/bağlı uçlar | Ortak veya aynı olanlar |
|---|---|---|---|
| Peakcell | `peakcell.com.tr`, `0850 901 00 00`, `info@peakcell.com.tr`, KEP, destek/başvuru | 0850 tahsis, PBX/call-center, SMS/IYS, softphone, WhatsApp Business, bayi modeli, `metaversepbx.com` bağlantıları | Exact numara ve şikayetlerdeki 0634/0782/0973 ile aynı `0850 9010***` BTK bloğu |
| Exact numara kümesi | `0757`, `0634`, `0782`, `0973` | Kullanıcı iddialarında Türk Telekom/TT Mobil numara taşıma ve İşim Ferah satışı | Aynı BTK bloğu; aynı son abone veya kampanya kanıtlanmadı |
| Doğan Bilişim | Dizinlerde `0312 419 59 69`, Plenty Plaza adresi | Şikayetlerde telefonla TT Mobil geçiş/satış iddiası | Türk Telekom bayi kategorisiyle dizin/şikayet ortaklığı; Peakcell ile doğrudan ortak uç yok |
| Türk Telekom / TT Mobil | Resmi domainler ve `444 1 444`, `444 5 444`, `444 0375` | Numara taşıma, İşim Ferah, bayi/ofis/online başvuru | Şikayetlerde hedef marka/ürün; exact 0850 numara resmi TT numarası değil |
| Hata veren Codex Python | Üst süreç: Codex runner/pwsh; komut: pandas import ve yerel BTK XLS yolu | Yerel `cmd.exe /c ver`, `WerFault.exe`; hata popup'ı | Telefon/şirket domaini, IP'si, numarası veya süreciyle ortak uç yok |
| Ayrı sistem Python'u | Codex runner/pwsh; geçici `xlrd` kurulumu | DNS: `pypi.org`, `files.pythonhosted.org`; IP kümesi `151.101.0.223`, `.64.223`, `.128.223`, `.192.223` | İki Python paket alanı aynı Fastly IP kümesine çözüldü; hata veren PID'lerle veya telekom varlıklarıyla ortak değil |

Hata veren PID 11780 ve 12900 için Sysmon Event 3 (ağ), Event 22 (DNS) veya Event 11 (dosya oluşturma) eşleşmesi yoktur. Bu, incelenen günlüklerde kayıtlı dış uç olmadığını gösterir; paket yakalama yapılmadığı için “hiçbir şekilde ağ kullanmadı” şeklinde mutlak kanıt değildir.

## Kanıt sınırları

- Exact numaranın güncel abonesi için operatör kaydı veya yetkili BTK/e-Devlet taşınma sonucu gerekir; açık web bunu çözmez.
- Şikayet ve dizin kayıtları kullanıcı/üçüncü taraf beyanıdır; tüzel sahiplik kanıtı değildir.
- Caller-ID taklidi açık kaynaklardan dışlanamaz.
- Hata için üst süreç/PID/komut zinciri doğrulandı; faulting modül ve stack doğrulanmadı.
- Domain/DNS/IP bilgileri zamana bağlıdır; ortak CDN IP'si tek başına kurumsal ilişki kanıtı sayılmaz.

## Yerel kanıt dosyaları

- `system-event-26.xml`: iki popup olayı
- `security-process-network-events.xml`: Security 4688 süreç zinciri
- `sysmon-events.xml`: Sysmon 1/3/11/22 olayları ve ProcessGuid korelasyonu
- `admin-summary.txt`: yönetici toplama özeti, Python envanteri ve hashler
- `python-wer-reports.txt`: Python için WER raporu bulunmadığını gösteren boş çıktı
- `tools/forensics/parse-python-events.js`: PID/ProcessGuid korelasyon ayrıştırıcısı
