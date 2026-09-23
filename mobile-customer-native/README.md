# VIP Gece Native Müşteri Uygulaması

Bu proje müşteri panelinin WebView olmayan Android istemcisidir.

- Giriş ekranında yalnız e-posta ve şifre bulunur.
- API origin'i uygulama tarafından seçilir; kullanıcı URL girmez.
- `vip-gece.site` bu müşteri uygulamasının tek yerleşik güvenli başlangıç
  origin'idir.
- `vip-gece.online` ikinci site olarak sıfırdan kurulacaktır; bu uygulamanın
  fallback origin'i değildir.
- `vip-gece.com` BTK engelli legacy domain olarak tutulur; `.site` taşıma veya
  fallback hattı değildir.
- Yeni origin listeleri yalnız APK içine gömülü RSA anahtarıyla doğrulanan
  imzalı yapılandırmadan kabul edilir.
- WorkManager imzalı domain yapılandırmasını ve imzalı APK manifestini saatte
  bir kontrol eder; uzaktan çalıştırılabilir kod veya servis yüklenmez.
- Zorunlu sürüm doğrulandığında eski sürümün paneli kilitlenir. Android 12+
  izin verdiğinde PackageInstaller arka planda günceller; cihaz sistem onayı
  isterse yalnız Android'in kurulum ekranı gösterilir.
- Destek oturumu müşteri ve destek görevlisi onayı olmadan aktifleşmez.
- Destek kapsamı uygulama tanılamasıdır; ADB, ters tünel, gizli kontrol,
  mikrofon, kamera ve dosya erişimi yoktur.
- Boş profil slotları sanaldır. Bir profil ancak kaydedildiğinde kotadan yer
  kullanır; eksik profil public siteye ve sitemap'e girmez.

Derleme:

```bash
cd mobile-customer-native/android
./gradlew :app:assembleDebug :app:assembleRelease --no-daemon
```
