// ======================================================
// SITE CONFIG
// Bu dosya sitenin görünen yazılarını ve SEO ayarlarını tutar.
// İleride public bundle veya HTML dosyaları değişse bile
// senin buraya yazdığın içerikler korunur.
// ======================================================

window.SITE_CONFIG = {
  // ====================================================
  // 1) GENEL SITE BILGILERI
  // ====================================================

  siteName: "VIP GECE",
  // Sitenin ana adı.
  // Nerede görünür?
  // - Ana sayfa üst başlık
  // - Detay sayfası üst başlık
  // - Tarayıcı sekmesi
  // - Google başlığı için temel kaynak

  siteSlogan: "Premium ilan vitrini",
  // Ana başlığın altında görünen kısa açıklama.
  // Örnek kullanım:
  // - "BURAYI SEN DOLDUR"
  // - "BURAYI SEN DOLDUR"

  siteDomain: "https://vip-gece.site",
  // Yeni domain adresin.
  // Örnek:
  // "https://example.com"
  // Sonunda / koyma.


  // ====================================================
  // 2) ANA SAYFA SEO AYARLARI
  // ====================================================

  homeTitle: "İstanbul VIP Escort Profilleri | VIP Gece",
  // Google’da ana sayfa için görünmesini istediğin başlık.
  // Tarayıcı sekmesinde de görünür.

  homeDescription: "İstanbul'daki güncel VIP escort profil ilanlarını doğrulanmış konum ve dolu kategori bağlantılarıyla sunar.",
  // Google’da ana sayfa açıklaması olarak görünmesini istediğin metin.
  // Çok uzun yapma. 120-160 karakter iyi olur.

  homeKeywordsText: "VIP Gece, İstanbul'daki güncel escort profil ilanlarını fotoğrafları ve temel bilgileriyle listeler. Yalnız gerçek profil bulunan konum ve dolu kategori sayfaları bağlantılanır; iletişim seçenekleri ilgili profil sayfasında gösterilir.",
  // Ana sayfada Google’ın okuyacağı açıklama metni.
  // Bu metin site içinde SEO bölümünde kullanılabilir.
  // Buraya sitenin ne olduğunu doğal cümlelerle anlat.


  // ====================================================
  // 3) ANA SAYFA BÖLÜM BAŞLIKLARI
  // ====================================================

  featuredTitle: "VIP Vitrin",
  // Ana sayfada üstteki büyük/öne çıkan kutuların başlığı.
  // Önceki sistemde VIP başlık gibi çalışır.

  normalTitle: "VIP Profiller",
  // Ana sayfadaki ana profil vitrininin başlığı.

  emptyBoxText: "Profil yakında",
  // Boş kutularda görünecek yazı.
  // Örnek:
  // "BURAYI SEN DOLDUR"


  // ====================================================
  // 4) DETAY SAYFASI SEO VE BAŞLIK
  // ====================================================

  detailPageTitle: "VIP GECE İLAN DETAYI",
  // Detay sayfasının genel başlığı.
  // Örnek:
  // "BURAYI SEN DOLDUR"

  detailTitleSuffix: "VIP GECE",
  // Detay sayfasında tarayıcı başlığına eklenecek son yazı.
  // Sistem şöyle kullanacak:
  // "Profil İsmi | BURAYI SEN DOLDUR"

  detailDescriptionPrefix: "VIP GECE premium ilan vitrini içinde seçili profilleri inceleyebilir ve hızlı iletişim seçeneklerine ulaşabilirsiniz.",
  // Detay sayfasında otomatik SEO açıklamasının başlangıcı.
  // Örnek sistem cümlesi:
  // "[İsim], BURAYI SEN DOLDUR içinde yer alan profillerden biridir."

  hiddenSeoEnabled: false,
  // SEO metinleri gizli DOM öğelerinde tutulmaz; kullanıcıya açık ilan içeriği olarak sunulur.


  // ====================================================
  // 5) FORM / ADMIN PANEL YAZILARI
  // ====================================================

  adminPanelTitle: "Yönetim Paneli",
  // Admin panel üst başlığı.

  adminLoginTitle: "Giriş",
  // Admin giriş ekranı başlığı.

  adminFormTitle: "ESCORT EKLE / DÜZENLE",
  // Admin panelde yeni kayıt ekleme/düzenleme formunun başlığı.

  adminListTitle: "ESCORT LİSTESİ",
  // Admin panelde kayıt listesinin başlığı.

  saveButtonText: "Kaydet",
  // Kaydet butonu yazısı.

  cancelButtonText: "İptal",
  // İptal butonu yazısı.

  deleteButtonText: "Sil",
  // Sil butonu yazısı.

  editButtonText: "Düzenle",
  // Düzenle butonu yazısı.


  // ====================================================
  // 6) PROFIL ALAN ADLARI
  // Bu alanlar sitede form label ve detay sayfasında görünür.
  // ====================================================

  fieldNameLabel: "İsim",
  // Admin panelde isim alanı.

  fieldAgeLabel: "Yaş",
  // Admin panelde yaş alanı ve detay sayfasındaki yaş etiketi.

  fieldHeightLabel: "Boy",
  // Admin panelde boy alanı ve detay sayfasındaki boy etiketi.

  fieldWeightLabel: "Kilo",
  // Admin panelde kilo alanı ve detay sayfasındaki kilo etiketi.

  fieldDescriptionLabel: "Açıklama",
  // Admin panelde açıklama alanı ve detay sayfasındaki açıklama bölümü.

  fieldPhoneLabel: "Telefon",
  // Telefon alanı.

  fieldWhatsappLabel: "WhatsApp",
  // WhatsApp alanı.

  fieldTelegramLabel: "Telegram",
  // Telegram alanı.


  // ====================================================
  // 7) PLACEHOLDER YAZILARI
  // Form kutularının içinde silik görünen örnek yazılar.
  // ====================================================

  placeholderName: "İSİM",
  // İsim inputunun içinde görünür.

  placeholderAge: "YAŞ",
  // Yaş inputunun içinde görünür.

  placeholderHeight: "BOY",
  // Boy inputunun içinde görünür.

  placeholderWeight: "KİLO",
  // Kilo inputunun içinde görünür.

  placeholderDescription: "ESCORT İLANININ AÇIKLAMASI",
  // Açıklama alanının içinde görünür.

  placeholderPhone: "ARA",
  // Telefon inputunun içinde görünür.

  placeholderWhatsapp: "WHATSAPP",
  // WhatsApp inputunun içinde görünür.

  placeholderTelegram: "TELEGRAM",
  // Telegram inputunun içinde görünür.


  // ====================================================
  // 8) İLETİŞİM SAYFASI
  // ====================================================

  contactTitle: "İletişim",
  // İletişim sayfası üst başlığı.

  contactDescription: "Bize ulaşmak için aşağıdaki bağlantıları kullanabilirsin",
  // İletişim sayfasında üst başlık altında görünen açıklama.

  contactSeoTitle: "VIP GECE | İLETİŞİM",
  // Google’da iletişim sayfası için görünmesini istediğin başlık.

  contactSeoDescription: "VIP GECE iletişim kanalları ve ilan vitrini başvuru bilgileri.",
  // Google’da iletişim sayfası için görünmesini istediğin açıklama.

  contactEmptyText: "İletişim bilgileri yakında eklenecek",
  // Aktif iletişim kanalı yoksa görünecek yazı.


  // ====================================================
  // 9) GÖRSEL / BOŞ GÖRSEL
  // ====================================================

  fallbackImageText: "GÖRSEL YOK",
  // Görsel yoksa otomatik placeholder görselinde görünecek yazı.


  // ====================================================
  // 10) GOOGLE / INDEX AYARLARI
  // ====================================================

  allowIndexing: true,
  // Uyumluluk için korunur; HTML sayfaları her zaman index/follow üretilir.
  // Noindex anahtarı bilinçli olarak devre dışıdır.

  googleVerificationCode: "",
  // Google Search Console HTML tag kodundaki content değeri.
  // Örnek:
  // <meta name="google-site-verification" content="ABC123">
  // Buraya sadece ABC123 kısmını yaz.


  // ====================================================
  // 11) TEKNIK AYARLAR
  // ====================================================

  featuredCount: 12,
  // Üst bölümde kaç kutu olacak.

  normalCount: 50,
  // Normal bölümde kaç kutu olacak.

  gridCount: 5,
  // Normal kutular yan yana kaçlı dizilecek.

  useSlugUrls: true,

// ====================================================
// 12) SİSTEM (BEN EKLEDİM - DOKUNMA 😄)
// ====================================================

supabaseUrl: "",
supabaseAnonKey: "",

contactMessage: "Merhaba 👋 VIP GECE'de “{profile}” profilini gördüm. Uygunluk ve detayları öğrenebilir miyim?\n\n🔖 VIP GECE Referansı: {reference}"
};
