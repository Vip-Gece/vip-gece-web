#!/usr/bin/env node

const DEFAULT_URL = "https://vip-gece.site/";

function argValue(name, fallback = "") {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function targetUrl() {
  const raw = argValue("--url", process.env.GSC_VERIFICATION_SOURCE_URL || DEFAULT_URL);
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL http veya https olmali.");
  }
  return parsed.toString();
}

function extractVerificationCode(html) {
  const meta = /<meta\b[^>]*name=["']google-site-verification["'][^>]*>/i.exec(html)?.[0] ||
    /<meta\b[^>]*content=["'][^"']+["'][^>]*name=["']google-site-verification["'][^>]*>/i.exec(html)?.[0] ||
    "";
  const content = /content=["']([^"']+)["']/i.exec(meta)?.[1]?.trim() || "";
  return content;
}

async function main() {
  const url = targetUrl();
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "VIP-Gece-GSC-Verification-Reader/1.0"
    },
    signal: AbortSignal.timeout(20000)
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`${url} HTTP ${response.status} dondurdu.`);
  }
  const code = extractVerificationCode(html);
  if (!code) {
    console.log(JSON.stringify({
      ok: false,
      url,
      final_url: response.url,
      message: "google-site-verification meta etiketi bulunamadi"
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    url,
    final_url: response.url,
    verification_code: code
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
