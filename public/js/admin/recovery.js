"use strict";

function recoveryRequested() {
  const params = new URLSearchParams(window.location.search);
  const value = String(params.get("fido-recovery") || "").toLowerCase();
  return value === "1" || value === "true";
}

function initFidoRecovery() {
  if (!recoveryRequested()) {
    return;
  }

  const passkeyButton = document.getElementById("loginPasskeyBtn");
  if (!passkeyButton || document.getElementById("passwordRecoveryBox")) {
    return;
  }

  const box = document.createElement("div");
  box.id = "passwordRecoveryBox";
  box.className = "login-recovery-box";
  box.setAttribute("aria-live", "polite");

  const note = document.createElement("p");
  note.className = "login-recovery-note";
  note.textContent = "Geçici FIDO kurtarma modu. Şifreyle girdikten sonra Ayarlar bölümünden yeni FIDO anahtarını ekle; ardından bu mod sunucuda yeniden kapatılır.";

  const label = document.createElement("label");
  label.setAttribute("for", "loginPassword");
  label.textContent = "Geçici Kurtarma Şifresi";

  const password = document.createElement("input");
  password.id = "loginPassword";
  password.type = "password";
  password.autocomplete = "current-password";
  password.spellcheck = false;

  const button = document.createElement("button");
  button.className = "btn btn-light btn-full";
  button.id = "loginBtn";
  button.type = "button";
  button.textContent = "Geçici Şifre ile Gir";

  box.append(note, label, password, button);
  passkeyButton.insertAdjacentElement("afterend", box);

  document.documentElement.dataset.fidoRecovery = "requested";
  password.focus({ preventScroll: true });
}

document.addEventListener("DOMContentLoaded", initFidoRecovery);
