(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var token = String(location.hash || "").replace(/^#/, "").trim();
  function show(id) {
    ["loading", "invalid", "form", "done"].forEach(function (section) {
      $(section).classList.toggle("hidden", section !== id);
    });
  }
  function fail(message) {
    var msg = $("msg");
    msg.textContent = message;
    msg.className = "msg err";
  }
  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit"
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || data.ok !== true) {
          var error = new Error(data.error || "İşlem tamamlanamadı.");
          error.status = response.status;
          throw error;
        }
        return data;
      });
    });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { show("invalid"); return; }
  post("/api/customer/password-reset/start", { token: token }).then(function (data) {
    var who = $("who");
    who.textContent = (data.label ? data.label + " · " : "") + (data.email_masked || "Müşteri hesabı");
    show("form");
    $("newPassword").focus();
  }).catch(function () { show("invalid"); });

  $("resetForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var first = $("newPassword").value;
    var second = $("newPasswordAgain").value;
    if (first.length < 8) { return fail("Şifre en az 8 karakter olmalı."); }
    if (first !== second) { return fail("Şifreler birbiriyle eşleşmiyor."); }
    var button = $("submitBtn");
    button.disabled = true;
    fail("");
    post("/api/customer/password-reset", { token: token, new_password: first }).then(function () {
      history.replaceState(null, "", location.pathname);
      show("done");
    }).catch(function (error) {
      fail(error.message || "Şifre güncellenemedi.");
    }).finally(function () { button.disabled = false; });
  });
})();
