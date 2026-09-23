"use strict";

import { $, adminApi, showStatus } from "./shared.js?v=20260913-auth-session1";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("tr-TR").format(number(value));
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value ?? "");
}

function appendEmpty(container, message) {
  const empty = document.createElement("p");
  empty.className = "panel-quick-note";
  empty.textContent = message;
  container.appendChild(empty);
}

function statusLabel(value) {
  return value ? "Hazır" : "Eksik";
}

function statusBadge(value) {
  const badge = document.createElement("span");
  badge.className = `badge ${value ? "badge-live" : "badge-off"}`;
  badge.textContent = statusLabel(value);
  return badge;
}

function renderStatus(overview) {
  const google = overview.google || {};
  const cloudflare = overview.cloudflare || {};
  const supabase = overview.supabase || {};
  setText("seoGoogleStatus", google.configured && google.enabled ? "Bağlı" : "Eksik");
  setText("seoCloudflareStatus", cloudflare.configured ? "Bağlı" : "Kontrol Gerekli");
  setText("seoSupabaseStatus", supabase.host || "-");
  setText("seoImageStatus", `${formatNumber(overview.totals?.broken_images)} kırık`);
  setText("seoGoogleDetail", google.next_action || "");
  setText("seoCloudflareDetail", cloudflare.next_action || "");
}

function renderSeoProfiles(rows) {
  const list = $("seoControlProfileRows");
  if (!list) return;
  list.textContent = "";
  const profiles = Array.isArray(rows) ? rows : [];
  if (!profiles.length) return appendEmpty(list, "Profil satırı bulunamadı.");

  profiles
    .filter((profile) => profile.active)
    .sort((left, right) => {
      const leftRisk = number(left.broken_image_count) + (left.seo_ready ? 0 : 10);
      const rightRisk = number(right.broken_image_count) + (right.seo_ready ? 0 : 10);
      if (leftRisk !== rightRisk) return rightRisk - leftRisk;
      return String(left.name || "").localeCompare(String(right.name || ""), "tr");
    })
    .slice(0, 40)
    .forEach((profile) => {
      const row = document.createElement("div");
      row.className = "seo-control-row";

      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = profile.name || "İsimsiz profil";
      const meta = document.createElement("span");
      meta.textContent = [
        profile.primary_target_query || "hedef sorgu yok",
        `${formatNumber(profile.usable_image_count)} sağlam görsel`,
        profile.broken_image_count ? `${formatNumber(profile.broken_image_count)} kırık görsel` : "görsel sağlıklı",
        profile.seo_ready ? "SEO hazır" : "SEO eksik"
      ].join(" · ");
      copy.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "profile-actions";
      actions.append(statusBadge(profile.seo_ready && profile.broken_image_count === 0));

      const search = document.createElement("button");
      search.className = "btn btn-light";
      search.type = "button";
      search.dataset.analyticsProfile = String(profile.id || "");
      search.textContent = "Search";

      const edit = document.createElement("button");
      edit.className = "btn btn-warning";
      edit.type = "button";
      edit.dataset.edit = String(profile.id || "");
      edit.textContent = "Düzenle";

      actions.append(search, edit);
      row.append(copy, actions);
      list.appendChild(row);
    });
}

function renderFirst5Plan(plan = {}) {
  const list = $("seoFirst5Plan");
  if (!list) return;
  list.textContent = "";
  const rows = Array.isArray(plan.focus) ? plan.focus : [];
  if (!rows.length) return appendEmpty(list, "İlk 5 hedef planı hazırlanamadı.");
  rows.forEach((item) => {
    const row = document.createElement("div");
    row.className = "analytics-breakdown-row";
    const label = document.createElement("span");
    label.textContent = item;
    row.append(label);
    list.appendChild(row);
  });
}

export async function loadSeoControl() {
  if (document.documentElement.dataset.adminRole !== "full_admin") return false;
  try {
    const overview = await adminApi("/api/admin/seo-control");
    const totals = overview.totals || {};
    setText("seoReadyProfiles", `${formatNumber(totals.seo_ready_profiles)} / ${formatNumber(totals.active_profiles)}`);
    setText("seoMissingProfiles", formatNumber(totals.seo_missing_profiles));
    setText("seoBrokenProfiles", formatNumber(totals.profiles_with_broken_images));
    setText("seoOldSupabaseImages", formatNumber(totals.old_supabase_images));
    renderStatus(overview);
    renderSeoProfiles(overview.profiles);
    renderFirst5Plan(overview.first5_plan);
    showStatus("panelStatus", "SEO, Search, Cloudflare ve görsel kontrol özeti yenilendi.", "ok");
    return true;
  } catch (error) {
    showStatus("panelStatus", error.message || "SEO kontrol özeti alınamadı.", "err");
    return false;
  }
}
