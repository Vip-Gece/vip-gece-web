const OLD_DOMAIN = process.env.OLD_DOMAIN || "";
const NEW_SITE = (process.env.NEW_SITE || "https://vip-gece.site").replace(/\/$/, "");
const SITEMAP_SOURCE =
  process.env.SITEMAP_SOURCE || "http://127.0.0.1:3003/sitemap.xml";
const SITEMAP_HOST = process.env.SITEMAP_HOST || "vip-gece.site";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 16));
const TIMEOUT_MS = Math.max(1_000, Number(process.env.TIMEOUT_MS || 15_000));
const ALLOW_CANCELLED_COM_MIGRATION = process.env.ALLOW_CANCELLED_COM_MIGRATION === "true";

if (!OLD_DOMAIN) {
  throw new Error("OLD_DOMAIN zorunlu. vip-gece.com -> vip-gece.site taşıması iptal edildiği için varsayılan eski domain yok.");
}

if (OLD_DOMAIN.replace(/^www\./i, "") === "vip-gece.com" && !ALLOW_CANCELLED_COM_MIGRATION) {
  throw new Error("vip-gece.com -> vip-gece.site 301 taşıma denetimi iptal edildi. Tarihsel kanıt için bilinçli çalıştırılacaksa ALLOW_CANCELLED_COM_MIGRATION=true verin.");
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      redirect: "manual",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

const sitemapResponse = await request(SITEMAP_SOURCE, {
  headers: { Host: SITEMAP_HOST }
});

if (!sitemapResponse.ok) {
  throw new Error(`Sitemap alınamadı: HTTP ${sitemapResponse.status}`);
}

const sitemapXml = await sitemapResponse.text();
const paths = [
  ...new Set([
    ...Array.from(sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => {
      return new URL(decodeXml(match[1])).pathname;
    }),
    "/robots.txt",
    "/sitemap.xml",
    "/image-sitemap.xml"
  ])
];

const sources = [
  `https://${OLD_DOMAIN}`,
  `https://www.${OLD_DOMAIN}`,
  `http://${OLD_DOMAIN}`,
  `http://www.${OLD_DOMAIN}`
];
const jobs = [];

paths.forEach((pathname, pathIndex) => {
  sources.forEach((source, sourceIndex) => {
    const probe = `${pathIndex + 1}-${sourceIndex + 1}`;
    const query = `__cutover_probe=${probe}`;
    jobs.push({
      input: `${source}${pathname}?${query}`,
      expected: `${NEW_SITE}${pathname}?${query}`
    });
  });
});

const failures = [];
let completed = 0;
let cursor = 0;

async function worker() {
  while (cursor < jobs.length) {
    const index = cursor;
    cursor += 1;
    const job = jobs[index];

    try {
      const response = await request(job.input, { method: "HEAD" });
      const location = response.headers.get("location") || "";
      if (response.status !== 301 || location !== job.expected) {
        failures.push({
          input: job.input,
          status: response.status,
          location,
          expected: job.expected
        });
      }
    } catch (error) {
      failures.push({
        input: job.input,
        error: error instanceof Error ? error.message : String(error),
        expected: job.expected
      });
    }

    completed += 1;
  }
}

await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker())
);

console.log(`old_domain=${OLD_DOMAIN}`);
console.log(`new_site=${NEW_SITE}`);
console.log(`sitemap_paths=${paths.length}`);
console.log(`checked_redirects=${completed}`);
console.log(`failing_count=${failures.length}`);

if (failures.length) {
  console.log(JSON.stringify(failures.slice(0, 50), null, 2));
  process.exitCode = 1;
} else {
  console.log("ok=true");
}
