"use strict";

import { $, sb, showStatus } from "./shared.js?v=20260913-auth-session1";

function passkeyApiReady() {
  return Boolean(
    sb.auth &&
    typeof sb.auth.signInWithPasskey === "function" &&
    typeof sb.auth.registerPasskey === "function" &&
    sb.auth.passkey &&
    typeof sb.auth.passkey.list === "function"
  );
}

export function passkeySupported() {
  return passkeyApiReady();
}

export function passkeyErrorMessage(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  const name = String(error?.name || "");
  if (code.includes("passkey_disabled") || message.includes("passkey_disabled")) {
    return "Supabase projesinde passkey/FIDO girisi henuz etkin degil. Supabase Dashboard → Authentication → Passkeys ayarini acin (RP ID: vip-gece.site, Origin: https://panel.vip-gece.site).";
  }
  if (name === "NotAllowedError" || message.includes("NotAllowedError")) {
    return "Anahtar bulunamadi, islem iptal edildi veya suresi doldu. Once Ayarlar → FIDO Guvenlik Anahtarlari bolumunden anahtarinizi ekleyin.";
  }
  return error?.message || "FIDO islemi tamamlanamadi.";
}

export async function signInAdminWithPasskey() {
  if (!passkeyApiReady()) throw new Error("Bu ortamda passkey/FIDO destegi hazir degil.");
  const { data, error } = await sb.auth.signInWithPasskey();
  if (error) throw error;
  return data;
}

export async function listAdminPasskeys() {
  if (!passkeyApiReady()) throw new Error("Bu ortamda passkey/FIDO destegi hazir degil.");
  const { data, error } = await sb.auth.passkey.list();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function registerAdminPasskey() {
  if (!passkeyApiReady()) throw new Error("Bu ortamda passkey/FIDO destegi hazir degil.");
  const { data, error } = await sb.auth.registerPasskey();
  if (error) throw error;
  return data;
}

export async function deleteAdminPasskey(passkeyId) {
  if (!passkeyApiReady() || typeof sb.auth.passkey.delete !== "function") {
    throw new Error("Bu ortamda passkey/FIDO destegi hazir degil.");
  }
  const { data, error } = await sb.auth.passkey.delete({ passkeyId });
  if (error) throw error;
  return data;
}

function formatPasskeyDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function renderPasskeyNotice(message) {
  const list = $("passkeyList");
  if (!list) return;
  list.textContent = "";
  const note = document.createElement("p");
  note.className = "panel-quick-note";
  note.textContent = message;
  list.appendChild(note);
}

function renderPasskeyList(items) {
  const list = $("passkeyList");
  if (!list) return;
  list.textContent = "";
  if (!items.length) {
    renderPasskeyNotice("Kayitli FIDO anahtari yok. Giris yapmak icin bir anahtar ekleyin.");
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "ad-item";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.friendly_name || "FIDO Anahtari";
    const meta = document.createElement("small");
    const created = formatPasskeyDate(item.created_at);
    const lastUsed = item.last_used_at ? formatPasskeyDate(item.last_used_at) : "";
    meta.textContent = [
      created ? `Kayit: ${created}` : "",
      lastUsed ? `Son kullanim: ${lastUsed}` : ""
    ].filter(Boolean).join(" · ");
    info.append(title, document.createElement("br"), meta);
    const actions = document.createElement("div");
    actions.className = "profile-actions";
    const remove = document.createElement("button");
    remove.className = "btn btn-danger";
    remove.type = "button";
    remove.dataset.passkeyDelete = String(item.id || "");
    remove.textContent = "Kaldir";
    actions.appendChild(remove);
    row.append(info, actions);
    list.appendChild(row);
  });
}

export async function loadPasskeys() {
  const list = $("passkeyList");
  if (!list) return;
  if (document.documentElement.dataset.adminRole !== "full_admin") return;
  if (!passkeyApiReady()) {
    renderPasskeyNotice("Bu ortamda passkey/FIDO yonetimi hazir degil.");
    return;
  }
  try {
    renderPasskeyList(await listAdminPasskeys());
  } catch (error) {
    renderPasskeyNotice(passkeyErrorMessage(error));
  }
}

export function initPasskeyPanel() {
  const registerButton = $("registerPasskeyBtn");
  registerButton?.addEventListener("click", () => {
    void (async () => {
      showStatus("panelStatus", "FIDO anahtari kaydediliyor; anahtarinizi takip dokunun...", "warn");
      try {
        await registerAdminPasskey();
        showStatus("panelStatus", "FIDO anahtari eklendi.", "ok");
        await loadPasskeys();
      } catch (error) {
        showStatus("panelStatus", passkeyErrorMessage(error), "err");
      }
    })();
  });

  $("refreshPasskeysBtn")?.addEventListener("click", () => {
    void loadPasskeys();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const passkeyId = target.dataset.passkeyDelete;
    if (!passkeyId) return;
    void (async () => {
      showStatus("panelStatus", "Anahtar kaldiriliyor...", "warn");
      try {
        await deleteAdminPasskey(passkeyId);
        showStatus("panelStatus", "FIDO anahtari kaldirildi.", "ok");
        await loadPasskeys();
      } catch (error) {
        showStatus("panelStatus", passkeyErrorMessage(error), "err");
      }
    })();
  });
}
