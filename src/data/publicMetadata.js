"use strict";

const { safeSlug } = require("../utils/text");

const DISTRICT_NAMES = [
  "Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy", "Başakşehir", "Bayrampaşa", "Beşiktaş",
  "Beykoz", "Beylikdüzü", "Beyoğlu", "Büyükçekmece", "Çatalca", "Çekmeköy", "Esenler", "Esenyurt", "Eyüpsultan", "Fatih",
  "Gaziosmanpaşa", "Güngören", "Kadıköy", "Kağıthane", "Kartal", "Küçükçekmece", "Maltepe", "Pendik", "Sancaktepe", "Sarıyer",
  "Silivri", "Sultanbeyli", "Sultangazi", "Şile", "Şişli", "Tuzla", "Ümraniye", "Üsküdar", "Zeytinburnu"
];

const EUROPEAN_DISTRICTS = [
  "Arnavutköy", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy", "Başakşehir", "Bayrampaşa", "Beşiktaş", "Beylikdüzü", "Beyoğlu",
  "Büyükçekmece", "Çatalca", "Esenler", "Esenyurt", "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kağıthane", "Küçükçekmece",
  "Sarıyer", "Silivri", "Sultangazi", "Şişli", "Zeytinburnu"
];

const ASIAN_DISTRICTS = [
  "Adalar", "Ataşehir", "Beykoz", "Çekmeköy", "Kadıköy", "Kartal", "Maltepe", "Pendik", "Sancaktepe", "Sultanbeyli",
  "Şile", "Tuzla", "Ümraniye", "Üsküdar"
];

const DISTRICT_SIDE_LABELS = {
  europe: "Avrupa Yakası",
  asia: "Anadolu Yakası"
};

const DISTRICT_NEIGHBORS = {
  "Adalar": ["Kadıköy", "Maltepe", "Kartal"],
  "Arnavutköy": ["Başakşehir", "Eyüpsultan", "Küçükçekmece"],
  "Ataşehir": ["Ümraniye", "Kadıköy", "Üsküdar"],
  "Avcılar": ["Beylikdüzü", "Küçükçekmece", "Esenyurt"],
  "Bağcılar": ["Bahçelievler", "Güngören", "Başakşehir"],
  "Bahçelievler": ["Bakırköy", "Bağcılar", "Güngören"],
  "Bakırköy": ["Bahçelievler", "Zeytinburnu", "Küçükçekmece"],
  "Başakşehir": ["Arnavutköy", "Bağcılar", "Sultangazi"],
  "Bayrampaşa": ["Eyüpsultan", "Gaziosmanpaşa", "Zeytinburnu"],
  "Beşiktaş": ["Şişli", "Beyoğlu", "Sarıyer"],
  "Beykoz": ["Üsküdar", "Çekmeköy", "Şile"],
  "Beylikdüzü": ["Avcılar", "Büyükçekmece", "Esenyurt"],
  "Beyoğlu": ["Beşiktaş", "Şişli", "Fatih"],
  "Büyükçekmece": ["Beylikdüzü", "Esenyurt", "Çatalca"],
  "Çatalca": ["Büyükçekmece", "Silivri", "Arnavutköy"],
  "Çekmeköy": ["Ümraniye", "Sancaktepe", "Beykoz"],
  "Esenler": ["Bayrampaşa", "Güngören", "Başakşehir"],
  "Esenyurt": ["Avcılar", "Beylikdüzü", "Büyükçekmece"],
  "Eyüpsultan": ["Bayrampaşa", "Gaziosmanpaşa", "Kağıthane"],
  "Fatih": ["Beyoğlu", "Zeytinburnu", "Eyüpsultan"],
  "Gaziosmanpaşa": ["Eyüpsultan", "Bayrampaşa", "Sultangazi"],
  "Güngören": ["Bağcılar", "Bahçelievler", "Esenler"],
  "Kadıköy": ["Üsküdar", "Ataşehir", "Maltepe"],
  "Kağıthane": ["Şişli", "Eyüpsultan", "Sarıyer"],
  "Kartal": ["Maltepe", "Pendik", "Sultanbeyli"],
  "Küçükçekmece": ["Avcılar", "Başakşehir", "Bahçelievler"],
  "Maltepe": ["Kadıköy", "Kartal", "Ataşehir"],
  "Pendik": ["Kartal", "Tuzla", "Sultanbeyli"],
  "Sancaktepe": ["Çekmeköy", "Sultanbeyli", "Ümraniye"],
  "Sarıyer": ["Beşiktaş", "Kağıthane", "Şişli"],
  "Silivri": ["Çatalca", "Büyükçekmece", "Esenyurt"],
  "Sultanbeyli": ["Sancaktepe", "Pendik", "Kartal"],
  "Sultangazi": ["Gaziosmanpaşa", "Eyüpsultan", "Başakşehir"],
  "Şile": ["Beykoz", "Çekmeköy", "Ümraniye"],
  "Şişli": ["Beşiktaş", "Beyoğlu", "Kağıthane"],
  "Tuzla": ["Pendik", "Kartal", "Sultanbeyli"],
  "Ümraniye": ["Ataşehir", "Çekmeköy", "Üsküdar"],
  "Üsküdar": ["Kadıköy", "Ümraniye", "Ataşehir"],
  "Zeytinburnu": ["Fatih", "Bakırköy", "Bayrampaşa"]
};

const LANDING_ALIAS_GROUPS = [
  { parent_district: "Adalar", aliases: ["Büyükada", "Heybeliada", "Burgazada", "Kınalıada"] },
  { parent_district: "Arnavutköy", aliases: ["Hadımköy", "Bolluca", "Boğazköy", "Haraççı"] },
  { parent_district: "Ataşehir", aliases: ["İçerenköy", "Kayışdağı", "Küçükbakkalköy", "Barbaros"] },
  { parent_district: "Avcılar", aliases: ["Ambarlı", "Firuzköy", "Gümüşpala", "Denizköşkler"] },
  { parent_district: "Bağcılar", aliases: ["Güneşli", "Mahmutbey", "Kirazlı", "Yüzyıl"] },
  { parent_district: "Bahçelievler", aliases: ["Şirinevler", "Yenibosna", "Kocasinan", "Soğanlı"] },
  { parent_district: "Bakırköy", aliases: ["Ataköy", "Yeşilköy", "Florya", "Yeşilyurt"] },
  { parent_district: "Başakşehir", aliases: ["Kayaşehir", "Bahçeşehir", "İkitelli", "Altınşehir"] },
  { parent_district: "Bayrampaşa", aliases: ["Yıldırım", "Muratpaşa", "Altıntepsi", "Kocatepe"] },
  { parent_district: "Beşiktaş", aliases: ["Levent", "Etiler", "Ortaköy", "Bebek", "Balmumcu", "Akaretler"] },
  { parent_district: "Beykoz", aliases: ["Kavacık", "Paşabahçe", "Çubuklu", "Anadolu Hisarı", "Riva"] },
  { parent_district: "Beylikdüzü", aliases: ["Gürpınar", "Yakuplu", "Kavaklı", "Adnan Kahveci", "Beykent"] },
  { parent_district: "Beyoğlu", aliases: ["Taksim", "Karaköy", "Galata", "İstiklal", "Asmalımescit", "Cihangir"] },
  { parent_district: "Büyükçekmece", aliases: ["Mimaroba", "Kumburgaz", "Celaliye", "Kamiloba", "Alkent"] },
  { parent_district: "Çatalca", aliases: ["Binkılıç", "Ferhatpaşa", "Subaşı", "Ovayenice", "İnceğiz"] },
  { parent_district: "Çekmeköy", aliases: ["Taşdelen", "Alemdağ", "Ömerli", "Madenler"] },
  { parent_district: "Esenler", aliases: ["Davutpaşa", "Atışalanı", "Havaalanı", "Menderes", "Turgut Reis"] },
  { parent_district: "Esenyurt", aliases: ["Kıraç", "Mehterçeşme", "Saadetdere", "Akçaburgaz"] },
  { parent_district: "Eyüpsultan", aliases: ["Göktürk", "Kemerburgaz", "Alibeyköy", "Rami", "Yeşilpınar"] },
  { parent_district: "Fatih", aliases: ["Aksaray", "Laleli", "Eminönü", "Sultanahmet", "Fındıkzade", "Çapa"] },
  { parent_district: "Gaziosmanpaşa", aliases: ["Küçükköy", "Karayolları", "Mevlana", "Yıldıztabya", "Pazariçi"] },
  { parent_district: "Güngören", aliases: ["Merter", "Haznedar", "Güneştepe", "Gençosman"] },
  { parent_district: "Kadıköy", aliases: ["Moda", "Suadiye", "Bostancı", "Caddebostan", "Fenerbahçe", "Kozyatağı"] },
  { parent_district: "Kağıthane", aliases: ["Çağlayan", "Gültepe", "Seyrantepe", "Nurtepe", "Sanayi"] },
  { parent_district: "Kartal", aliases: ["Dragos", "Yakacık", "Soğanlık", "Uğur Mumcu", "Cevizli"] },
  { parent_district: "Küçükçekmece", aliases: ["Sefaköy", "Halkalı", "Atakent", "Kanarya", "Cennet"] },
  { parent_district: "Maltepe", aliases: ["Küçükyalı", "Altayçeşme", "Bağlarbaşı", "Zümrütevler", "Gülsuyu"] },
  { parent_district: "Pendik", aliases: ["Kurtköy", "Kaynarca", "Güzelyalı", "Çamçeşme", "Yenişehir"] },
  { parent_district: "Sancaktepe", aliases: ["Samandıra", "Sarıgazi", "Yenidoğan", "Abdurrahmangazi", "Veysel Karani"] },
  { parent_district: "Sarıyer", aliases: ["Maslak", "Tarabya", "İstinye", "Zekeriyaköy", "Emirgan", "Yeniköy"] },
  { parent_district: "Silivri", aliases: ["Selimpaşa", "Gümüşyaka", "Değirmenköy", "Çanta"] },
  { parent_district: "Sultanbeyli", aliases: ["Battalgazi", "Mehmet Akif", "Necip Fazıl", "Adil"] },
  { parent_district: "Sultangazi", aliases: ["Cebeci", "Gazi", "Habibler", "Sultançiftliği", "Zübeyde Hanım"] },
  { parent_district: "Şile", aliases: ["Ağva", "Kumbaba", "Ağlayankaya", "Ulupelit", "Yeşilvadi"] },
  { parent_district: "Şişli", aliases: ["Nişantaşı", "Mecidiyeköy", "Osmanbey", "Bomonti", "Feriköy", "Harbiye"] },
  { parent_district: "Tuzla", aliases: ["İçmeler", "Aydınlı", "Orhanlı", "Tepeören", "Şifa"] },
  { parent_district: "Ümraniye", aliases: ["Dudullu", "Çakmak", "Ihlamurkuyu", "Şerifali", "Esenevler"] },
  { parent_district: "Üsküdar", aliases: ["Acıbadem", "Altunizade", "Çengelköy", "Beylerbeyi", "Kuzguncuk", "Kandilli"] },
  { parent_district: "Zeytinburnu", aliases: ["Merkezefendi", "Kazlıçeşme", "Çırpıcı", "Veliefendi", "Sümer"] }
];

const DISTRICT_EDITORIAL_NOTES = {
  "Adalar": {
    focus: "ada hattinda daha sakin ve secili vitrin ritmi",
    transit: "iskele baglantilari ve Anadolu Yakasi baglantilari"
  },
  "Arnavutköy": {
    focus: "kuzey-bati aksinda genis ilan secimi",
    transit: "Basaksehir ve Kucukcekmece baglantilari"
  },
  "Ataşehir": {
    focus: "is merkezleriyle guclenen Anadolu Yakasi akisi",
    transit: "Umraniye ve Kadikoy baglantilari"
  },
  "Avcılar": {
    focus: "bati yakasinda hizli profil secimi",
    transit: "Beylikduzu ve Esenyurt baglantilari"
  },
  "Bağcılar": {
    focus: "ic bolgede yogun ilce baglantilari",
    transit: "Bahcelievler ve Gungoren baglantisi"
  },
  "Bahçelievler": {
    focus: "merkezi bati aksinda dengeli vitrin akisi",
    transit: "Bakirkoy ve Bagcilar baglantilari"
  },
  "Bakırköy": {
    focus: "sahil ve merkez dengesini birlestiren vitrin akisi",
    transit: "Zeytinburnu ve Kucukcekmece baglantilari"
  },
  "Başakşehir": {
    focus: "yeni yerlesim aksinda genis profil dagilimi",
    transit: "Arnavutkoy ve Sultangazi baglantilari"
  },
  "Bayrampaşa": {
    focus: "merkez-bati baglantisinde hizli yonlenme",
    transit: "Eyupsultan ve Gaziosmanpasa baglantisi"
  },
  "Beşiktaş": {
    focus: "merkezi ve premium yogunluklu akis",
    transit: "Sisli ve Beyoglu baglantilari"
  },
  "Beykoz": {
    focus: "kuzey Anadolu hattinda daha secili ilan akisi",
    transit: "Uskudar ve Cekmekoy baglantilari"
  },
  "Beylikdüzü": {
    focus: "bati ucunda duzenli vitrin akisi",
    transit: "Avcilar ve Buyukcekmece baglantilari"
  },
  "Beyoğlu": {
    focus: "merkezde hizli karar verdiren profil ritmi",
    transit: "Besiktas ve Fatih baglantilari"
  },
  "Büyükçekmece": {
    focus: "genis bati hattinda ferah liste dagilimi",
    transit: "Beylikduzu ve Catalca baglantilari"
  },
  "Çatalca": {
    focus: "cevre ilcelerle genisleyen dis hat akisi",
    transit: "Silivri ve Arnavutkoy baglantilari"
  },
  "Çekmeköy": {
    focus: "orman ve ic Anadolu Yakasi aksinda rahat profil secimi",
    transit: "Sancaktepe ve Beykoz baglantilari"
  },
  "Esenler": {
    focus: "merkezi baglanti hattinda kisa karar akisi",
    transit: "Bayrampasa ve Basaksehir baglantilari"
  },
  "Esenyurt": {
    focus: "yuksek kart hacmini duzenleyen bati akisi",
    transit: "Avcilar ve Beylikduzu baglantilari"
  },
  "Eyüpsultan": {
    focus: "genis kuzey-merkez hattinda rahat baglanti",
    transit: "Gaziosmanpasa ve Kagithane baglantisi"
  },
  "Fatih": {
    focus: "tarihi merkezde hedefi hizli netlestiren akis",
    transit: "Beyoglu ve Zeytinburnu baglantilari"
  },
  "Gaziosmanpaşa": {
    focus: "merkez-bati sinirinda hizli filtreleme",
    transit: "Eyupsultan ve Sultangazi baglantilari"
  },
  "Güngören": {
    focus: "ic bolgede kompakt vitrin ritmi",
    transit: "Bagcilar ve Esenler baglantilari"
  },
  "Kadıköy": {
    focus: "sahil ve merkez karmasini toplayan akis",
    transit: "Uskudar ve Maltepe baglantilari"
  },
  "Kağıthane": {
    focus: "is ve yasam aksini birlestiren merkez baglantisi",
    transit: "Sisli ve Eyupsultan baglantisi"
  },
  "Kartal": {
    focus: "dogu sahil hattinda secili profil akisi",
    transit: "Maltepe ve Pendik baglantilari"
  },
  "Küçükçekmece": {
    focus: "gol cevresi ve bati baglantisini birlestiren akis",
    transit: "Avcilar ve Basaksehir baglantilari"
  },
  "Maltepe": {
    focus: "sahil bandinda dengeli mobil vitrin ritmi",
    transit: "Kadikoy ve Kartal baglantilari"
  },
  "Pendik": {
    focus: "dogu ucunda genis ama kontrollu profil secimi",
    transit: "Kartal ve Tuzla baglantilari"
  },
  "Sancaktepe": {
    focus: "ic Anadolu Yakasinda dagilan profil akisi",
    transit: "Cekmekoy ve Umraniye baglantilari"
  },
  "Sarıyer": {
    focus: "kuzey sahil ve merkez dengesini birlestiren akis",
    transit: "Besiktas ve Sisli baglantilari"
  },
  "Silivri": {
    focus: "dis bati hattinda daha sakin ve ferah ilan secimi",
    transit: "Catalca ve Buyukcekmece baglantilari"
  },
  "Sultanbeyli": {
    focus: "dogu ic hatta hizli erisim",
    transit: "Pendik ve Sancaktepe baglantilari"
  },
  "Sultangazi": {
    focus: "bati-kuzey aksinda yogun baglantilari sadeleyen akis",
    transit: "Gaziosmanpasa ve Basaksehir baglantisi"
  },
  "Şile": {
    focus: "kuzeydogu hattinda daha seyrek ama secili liste ritmi",
    transit: "Beykoz ve Cekmekoy baglantilari"
  },
  "Şişli": {
    focus: "merkezi karar noktasinda hizli kart onceligi",
    transit: "Besiktas ve Kagithane baglantilari"
  },
  "Tuzla": {
    focus: "dogu sahil ucunda net filtrelenmis akis",
    transit: "Pendik ve Kartal baglantilari"
  },
  "Ümraniye": {
    focus: "Anadolu Yakasi merkezinde yogun ama duzenli profil secimi",
    transit: "Atasehir ve Uskudar baglantilari"
  },
  "Üsküdar": {
    focus: "Bogaz ve Anadolu merkezi arasinda dengeli baglanti",
    transit: "Kadikoy ve Umraniye baglantilari"
  },
  "Zeytinburnu": {
    focus: "sahil-merkez esiginde kisa karar akisi",
    transit: "Fatih ve Bakirkoy baglantilari"
  }
};

const CATEGORY_DEFS = [
  {
    key: "istanbul",
    name: "İstanbul Escort",
    slug: "istanbul-escort",
    keywords: ["istanbul"],
    is_city_hub: true,
    focus: "sehir geneli ana giris ve ilce dagitim noktasi",
    discovery: "39 ilce ve ana kategori baglantilari",
    assist: "Istanbul geneli uzerinden daha yerel bolgelere hizli baglanti"
  },
  {
    key: "vip",
    name: "VIP Escort",
    slug: "vip-escort",
    keywords: ["vip"],
    focus: "one cikan vitrinler ve premium kart secimi",
    discovery: "guclu ilceler uzerinden hizli karar akisi",
    assist: "VIP secimini destekleyen bolge ve profil baglantilari"
  },
  {
    key: "anal",
    name: "Anal Escort",
    slug: "anal-escort",
    keywords: ["anal"],
    focus: "daha spesifik kategori aramasini tek profil akisinda toplama",
    discovery: "ilgili ilce kartlariyla aramayi hizli daraltma",
    assist: "kategori aramasini bozmadan yerel bolgeye baglanti"
  },
  {
    key: "otel",
    name: "Otel Escort",
    slug: "otel-escort",
    keywords: ["otel", "hotel"],
    focus: "konaklama odakli arama icin secili profil akisi",
    discovery: "otel talebiyle uyusan bolgeleri onde tutma",
    assist: "ilgili ilce ve profil detaylarina kontrollu baglanti"
  },
  {
    key: "yabanci",
    name: "Yabancı Escort",
    slug: "yabanci-escort",
    keywords: ["yabanci", "foreign"],
    focus: "yabanci profil arayan kullaniciya tek yuzeyde net filtreleme",
    discovery: "guclu bolgelerle daha hizli kategori daraltmasi",
    assist: "Istanbul geneli ve ilce sayfalarina cift yonlu donus"
  },
  {
    key: "turbanli",
    name: "Türbanlı Escort",
    slug: "turbanli-escort",
    keywords: ["turbanli", "tesettur"],
    focus: "daha ozel kategori aramasini sakin ama net bir profil duzeniyle karsilama",
    discovery: "uygun bolgeler uzerinden hizli yonlenme",
    assist: "kategori ile bolge arasinda rahat baglanti"
  },
  {
    key: "gfe",
    name: "GFE Escort",
    slug: "gfe-escort",
    keywords: ["gfe"],
    focus: "yakinlik ve deneyim odakli aramayi daha secili bir akisla toplama",
    discovery: "guclu ilceleri one cekerek daha hizli profil secimi",
    assist: "ilgili kategori ve bolge sayfalari arasinda rahat geri donus"
  },
  {
    key: "esmer",
    name: "Esmer Escort",
    slug: "esmer-escort",
    keywords: ["esmer", "brunette", "koyu sac", "koyu saç"],
    focus: "esmer profil arayan kullaniciya daha hedefli ve okunur kart akisi",
    discovery: "esmer profillerin one ciktigi bolgelerle aramayi hizli daraltma",
    assist: "esmer kategori tercihini ilce ve profil detaylariyla baglama"
  },
  {
    key: "sarisin",
    name: "Sarışın Escort",
    slug: "sarisin-escort",
    keywords: ["sarışın", "sarisin", "sari sac", "sarı saç", "blonde", "blond"],
    focus: "sarisin profil arayan kullaniciyi dogrudan ilgili kart akisina indirme",
    discovery: "sarisin profillerin yogunlastigi bolgelerle listeyi hizli daraltma",
    assist: "sac rengi kategori tercihini ilce ve profil detaylariyla baglama"
  },
  {
    key: "kumral",
    name: "Kumral Escort",
    slug: "kumral-escort",
    keywords: ["kumral", "brown hair", "brunette", "acik kahve sac", "kahverengi sac"],
    focus: "kumral profil aramasini sade ve karsilastirilabilir kart duzeninde toplama",
    discovery: "kumral profiller icin one cikan bolge baglantilarini kullanma",
    assist: "profil tipi, kategori ve bolge sayfalari arasinda dengeli erisim"
  },
  {
    key: "zayif",
    name: "Zayıf Escort",
    slug: "zayif-escort",
    keywords: ["zayıf", "zayif", "slim", "fit", "ince"],
    focus: "zayif ve fit profil aramasini ilk kartlardan itibaren netlestirme",
    discovery: "vucut tipi tercihine uyan bolgelerle aramayi hizli daraltma",
    assist: "vucut tipi kategori tercihini ilgili profil ve ilce baglantilariyle destekleme"
  },
  {
    key: "balik-etli",
    name: "Balık Etli Escort",
    slug: "balik-etli-escort",
    keywords: ["balık etli", "balik etli", "curvy", "dolgun", "plus size"],
    focus: "balik etli profil arayan kullaniciya daha dogrudan ve okunur liste sunma",
    discovery: "dolgun profil tercihinde one cikan bolgeleri kategori akisi icinde tasima",
    assist: "vucut tipi tercihini profil detaylari ve yakin bolgelerle baglama"
  },
  {
    key: "kapali",
    name: "Kapalı Escort",
    slug: "kapali-escort",
    keywords: ["kapalı", "kapali", "tesettur", "tesettür", "turbanli", "türbanlı"],
    focus: "kapali profil aramasini kategori icinde daha sakin ve net karsilama",
    discovery: "stil odakli aramalarda uygun bolge baglantilarini one cikarma",
    assist: "kapali ve turbanli kategori tercihlerini birbirine ve yerel sayfalara baglama"
  },
  {
    key: "genc",
    name: "Genç Escort",
    slug: "genc-escort",
    keywords: ["genc", "young"],
    focus: "yas odakli kategori tercihini ilk kartlarda netlestirme",
    discovery: "ilgili bolgeler uzerinden hizli liste daraltma",
    assist: "profil, ilce ve kategori arasinda ritmik baglanti"
  }
];

function districtRows() {
  return DISTRICT_NAMES.map((name) => {
    const aliases = aliasNamesForDistrictName(name).slice(0, 4);
    const aliasText = aliases.length ? `${aliases.join(", ")} semtleri, ` : "";
    const side = districtSide(name);
    const sideLabel = districtSideLabel(side);

    return {
      ...(DISTRICT_EDITORIAL_NOTES[name] || {}),
      name,
      slug: `${safeSlug(name)}-escort`,
      city: "İstanbul",
      side,
      side_label: sideLabel,
      is_active: true,
      seo_title: `${name} Escort | ${sideLabel || "İstanbul"} | VIP Gece`,
      seo_description: `${name} escort ilanları. ${sideLabel ? `${sideLabel}, ` : ""}${aliasText}${DISTRICT_EDITORIAL_NOTES[name]?.focus || "güncel profiller"}. ${DISTRICT_EDITORIAL_NOTES[name]?.transit || "Yakın ilçe bağlantıları"} ile hızlı erişim.`
    };
  });
}

function landingAliasRows() {
  return LANDING_ALIAS_GROUPS.flatMap((group) => {
    const side = districtSide(group.parent_district);
    return group.aliases.map((name) => ({
      name,
      slug: `${safeSlug(name)}-escort`,
      parent_district: group.parent_district,
      city: "İstanbul",
      side,
      side_label: districtSideLabel(side),
      is_alias: true,
      is_active: true,
      focus: `${name} aramasinda ${group.parent_district} baglantili profil akisi`,
      transit: `${group.parent_district} ve yakin ilce baglantilari`,
      seo_title: `${name} Escort | VIP GECE`,
      seo_description: `${name} escort aramasi icin ${group.parent_district} baglantili tum aktif vitrin kartlari tek sayfada.`
    }));
  });
}

function districtSide(name) {
  if (EUROPEAN_DISTRICTS.includes(name)) return "europe";
  if (ASIAN_DISTRICTS.includes(name)) return "asia";
  return "";
}

function districtSideLabel(sideOrDistrict) {
  const side = DISTRICT_SIDE_LABELS[sideOrDistrict]
    ? sideOrDistrict
    : districtSide(sideOrDistrict);
  return DISTRICT_SIDE_LABELS[side] || "";
}

function districtRowsBySide(side) {
  return districtRows().filter((district) => district.side === side);
}

function landingAliasRowsBySide(side) {
  return landingAliasRows().filter((alias) => alias.side === side);
}

function sideGroups() {
  return [
    {
      key: "europe",
      title: DISTRICT_SIDE_LABELS.europe,
      districts: districtRowsBySide("europe"),
      aliases: landingAliasRowsBySide("europe")
    },
    {
      key: "asia",
      title: DISTRICT_SIDE_LABELS.asia,
      districts: districtRowsBySide("asia"),
      aliases: landingAliasRowsBySide("asia")
    }
  ];
}

function getDistrictAliases(name) {
  const wanted = String(name || "");
  const group = LANDING_ALIAS_GROUPS.find((item) => item.parent_district === wanted);
  if (!group) return [];

  return landingAliasRows().filter((alias) => alias.parent_district === group.parent_district);
}

function categoryRows() {
  return CATEGORY_DEFS.map((category) => ({
    ...category,
    is_active: true,
    seo_title: `${category.name} | VIP GECE`,
    seo_description: `${category.name} vitrin kategorisi.`
  }));
}

function aliasNamesForDistrictName(name) {
  const group = LANDING_ALIAS_GROUPS.find((item) => item.parent_district === name);
  return group ? group.aliases : [];
}

function seoClusterRows() {
  const cityCluster = {
    key: "istanbul-escort",
    name: "İstanbul",
    slug: "istanbul-escort",
    query: "istanbul escort",
    target_path: "/istanbul-escort",
    is_active: true
  };

  const districtClusters = districtRows().map((district) => ({
    key: district.slug,
    name: district.name,
    slug: district.slug,
    query: `${district.name.toLocaleLowerCase("tr-TR")} escort`,
    target_path: `/${district.slug}`,
    is_active: true
  }));

  const aliasClusters = landingAliasRows().map((alias) => ({
    key: alias.slug,
    name: alias.name,
    slug: alias.slug,
    query: `${alias.name.toLocaleLowerCase("tr-TR")} escort`,
    target_path: `/${alias.slug}`,
    parent_district: alias.parent_district,
    is_alias: true,
    is_active: true
  }));

  return [cityCluster, ...districtClusters, ...aliasClusters];
}

function publicSettings() {
  const { readSiteSettingsSync } = require("../services/siteSettingsService");
  const settings = readSiteSettingsSync();
  return {
    title: settings.site_name,
    slogan: settings.site_slogan,
    vip_title: settings.featured_title,
    normal_title: settings.normal_title,
    detail_title: settings.detail_title,
    empty_text: settings.empty_text,
    public_ads_enabled: false
  };
}

function publicContact() {
  const { readSiteSettingsSync } = require("../services/siteSettingsService");
  const settings = readSiteSettingsSync();
  return {
    whatsapp: settings.whatsapp,
    telegram: settings.telegram,
    phone: settings.phone,
    contact_mode: "detail_cta_only"
  };
}

function getDistrictBySlug(slug) {
  const wanted = safeSlug(String(slug || "").replace(/-escort$/i, ""));
  return districtRows().find((district) => safeSlug(district.name) === wanted) ||
    landingAliasRows().find((alias) => safeSlug(alias.name) === wanted || safeSlug(alias.slug) === safeSlug(slug)) ||
    null;
}

function getNearbyDistricts(name) {
  const alias = landingAliasRows().find((row) => row.name === name || row.slug === name || safeSlug(row.name) === safeSlug(name));
  const sourceName = alias?.parent_district || name;
  const neighbors = DISTRICT_NEIGHBORS[sourceName] || [];
  return neighbors
    .map((neighborName) => districtRows().find((district) => district.name === neighborName))
    .filter(Boolean);
}

function getCategoryBySlug(slug) {
  const wanted = safeSlug(slug);
  return categoryRows().find((category) => safeSlug(category.slug) === wanted) || null;
}

module.exports = {
  CATEGORY_DEFS,
  ASIAN_DISTRICTS,
  DISTRICT_SIDE_LABELS,
  DISTRICT_NEIGHBORS,
  DISTRICT_NAMES,
  EUROPEAN_DISTRICTS,
  LANDING_ALIAS_GROUPS,
  categoryRows,
  districtRowsBySide,
  districtSide,
  districtSideLabel,
  districtRows,
  getCategoryBySlug,
  getDistrictAliases,
  getDistrictBySlug,
  getNearbyDistricts,
  landingAliasRowsBySide,
  landingAliasRows,
  sideGroups,
  publicContact,
  publicSettings,
  seoClusterRows
};
