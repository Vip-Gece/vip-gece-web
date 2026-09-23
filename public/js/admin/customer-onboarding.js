"use strict";
import { $, adminApi, showStatus } from "./shared.js?v=20260913-auth-session1";

export async function issueCustomerAccessLink() {
  const id = $("customerAccountId")?.value;
  if (!id) {
    showStatus("panelStatus", "Önce müşteri hesabını kaydedin veya seçin.", "err");
    return;
  }
  if (!window.confirm("Yeni giriş bağlantısı oluşturulsun mu? Önceki bağlantı ve bu müşterinin açık oturumları kapanacak.")) return;
  const button = $("issueCustomerAccessLinkBtn");
  button.disabled = true;
  try {
    const result = await adminApi(`/api/v1/admin/customer-accounts/${encodeURIComponent(id)}/access-link`, { method: "POST" });
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(92vw,560px);max-height:90vh;overflow:auto;border-radius:8px;padding:24px";
    const title = document.createElement("h3");
    title.textContent = result.account.label || result.account.email;
    const field = document.createElement("textarea");
    field.readOnly = true; field.rows = 4; field.value = result.access_url;
    field.setAttribute("aria-label", "Müşteri giriş bağlantısı");
    field.style.cssText = "width:100%;box-sizing:border-box;overflow-wrap:anywhere";
    const status = document.createElement("p"); status.setAttribute("role", "status");
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "btn btn-primary"; copy.textContent = "Bağlantıyı kopyala";
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(field.value); status.textContent = "Kopyalandı."; }
      catch { field.focus(); field.select(); status.textContent = "Panoya erişilemedi."; }
    };
    const close = document.createElement("button");
    close.type = "button"; close.className = "btn btn-light"; close.textContent = "Kapat";
    close.onclick = () => dialog.close();
    dialog.addEventListener("close", () => { field.value = ""; dialog.remove(); }, { once: true });
    dialog.append(title, field, status, copy, close); document.body.append(dialog); dialog.showModal();
  } catch (error) {
    showStatus("panelStatus", error.message || "Giriş bağlantısı oluşturulamadı.", "err");
  } finally { button.disabled = false; }
}

export async function issueCustomerPasswordResetLink() {
  const id = $("customerAccountId")?.value;
  if (!id) {
    showStatus("panelStatus", "Önce müşteri hesabını kaydedin veya seçin.", "err");
    return;
  }
  if (!window.confirm("Tek kullanımlık şifre yenileme bağlantısı oluşturulsun mu? Bağlantı varsayılan 60 dakika geçerlidir; müşteri açıp kendi şifresini belirler. E-posta/telefon gerekmez.")) return;
  const button = $("issueCustomerPasswordResetLinkBtn");
  button.disabled = true;
  try {
    const result = await adminApi(`/api/v1/admin/customer-accounts/${encodeURIComponent(id)}/password-reset-link`, { method: "POST" });
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(92vw,560px);max-height:90vh;overflow:auto;border-radius:8px;padding:24px";
    const title = document.createElement("h3");
    title.textContent = result.account.label || result.account.email;
    const expiry = document.createElement("p");
    expiry.textContent = `Tek kullanımlık bağlantı · Geçerlilik: ${new Date(result.expires_at).toLocaleString("tr-TR")} (${result.ttl_minutes} dk)`;
    const field = document.createElement("textarea");
    field.readOnly = true; field.rows = 4; field.value = result.reset_url;
    field.setAttribute("aria-label", "Müşteri şifre yenileme bağlantısı");
    field.style.cssText = "width:100%;box-sizing:border-box;overflow-wrap:anywhere";
    const status = document.createElement("p"); status.setAttribute("role", "status");
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "btn btn-primary"; copy.textContent = "Bağlantıyı kopyala";
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(field.value); status.textContent = "Kopyalandı."; }
      catch { field.focus(); field.select(); status.textContent = "Panoya erişilemedi."; }
    };
    const close = document.createElement("button");
    close.type = "button"; close.className = "btn btn-light"; close.textContent = "Kapat";
    close.onclick = () => dialog.close();
    dialog.addEventListener("close", () => { field.value = ""; dialog.remove(); }, { once: true });
    dialog.append(title, expiry, field, status, copy, close); document.body.append(dialog); dialog.showModal();
  } catch (error) {
    showStatus("panelStatus", error.message || "Şifre yenileme bağlantısı oluşturulamadı.", "err");
  } finally { button.disabled = false; }
}

export function generateCustomerPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const password = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_");
  $("customerAccountPassword").value = password;
}

export async function copyCustomerPassword() {
  const value = $("customerAccountPassword")?.value;
  if (!value) return showStatus("panelStatus", "Yeni şifre alanı boş.", "err");
  try {
    await navigator.clipboard.writeText(value);
    showStatus("panelStatus", "Yeni şifre kopyalandı.", "ok");
  } catch { showStatus("panelStatus", "Panoya erişilemedi.", "err"); }
}
