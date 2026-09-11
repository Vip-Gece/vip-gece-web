"use strict";

const DEMO_PROFILES = [
  {
    id: "demo-ada",
    slug: "ada-vip",
    name: "Ada",
    card_label: "Premium VIP",
    description: "Şık, bakımlı ve seçici bir profil. Net iletişim, özenli görünüm ve hızlı erişim için demo ilan.",
    city: "İstanbul",
    district: "Şişli",
    age: "27",
    height: "172",
    weight: "55",
    phone: "905550000001",
    whatsapp: "905550000001",
    telegram: "vipgece_demo",
    type: "vip",
    is_featured: true,
    is_active: true,
    vip_slot: 1,
    priority_order: 1,
    images: ["/logo.png.webp"],
    tags: ["sisli", "vip"]
  },
  {
    id: "demo-lina",
    slug: "lina-vip",
    name: "Lina",
    card_label: "Dikkat Çeken VIP",
    description: "Modern, enerjik ve özenli bir vitrin profili. Detay sayfası, fotoğraf alanı ve iletişim butonları için hazır demo.",
    city: "İstanbul",
    district: "Kadıköy",
    age: "25",
    height: "168",
    weight: "52",
    phone: "905550000002",
    whatsapp: "905550000002",
    type: "vip",
    is_featured: true,
    is_active: true,
    vip_slot: 2,
    priority_order: 2,
    images: ["/logo.png.webp"],
    tags: ["kadikoy", "vip", "esmer"]
  },
  {
    id: "demo-mira",
    slug: "mira-secili",
    name: "Mira",
    card_label: "Seçili Profil",
    description: "Sade, net ve mobilde rahat okunabilir demo ilan. Kategori ve normal profil akışı için kullanılır.",
    city: "İstanbul",
    district: "Beşiktaş",
    age: "29",
    height: "170",
    weight: "56",
    phone: "905550000003",
    whatsapp: "905550000003",
    type: "normal",
    is_featured: false,
    is_active: true,
    normal_slot: 3,
    priority_order: 10,
    images: ["/logo.png.webp"],
    tags: ["besiktas", "secili"]
  }
];

function shouldUseDemoProfiles() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ENABLE_DEMO_PROFILES === "true";
}

function getDemoProfiles() {
  return DEMO_PROFILES.map((profile) => ({ ...profile }));
}

module.exports = {
  getDemoProfiles,
  shouldUseDemoProfiles
};
