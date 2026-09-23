import { writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const option = (key, fallback) => args.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3) || fallback;
const base = new URL(option('site','https://vip-gece.site'));
const report = { at: new Date().toISOString(), site: base.origin, pages: [], assets: [], failures: [], external: [] };
const pages = new Map();
const assets = new Map();
const external = new Set();
const decode = value => value.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/g,"'");
function urlOf(value, source) {
  try {
    const url = new URL(decode(value), source);
    if (!['http:','https:'].includes(url.protocol)) return null;
    url.hash = '';
    if (url.origin !== base.origin) { external.add(url.href); return null; }
    return url;
  } catch { return null; }
}
function add(map, raw, source) {
  const url = urlOf(raw, source);
  if (url && !map.has(url.href)) map.set(url.href, { url: url.href, source });
}
async function request(url) {
  let result;
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const response = await fetch(url, { redirect:'follow', headers:{'User-Agent':'VIP-Gece-Read-Only-Surface-Audit/1.0'}, signal:AbortSignal.timeout(20000) });
      const body = Buffer.from(await response.arrayBuffer());
      result = { status:response.status, finalUrl:response.url, type:response.headers.get('content-type')||'', bytes:body.length, body };
      if (response.status !== 429 && response.status < 500) return result;
    } catch (error) { result = { status:0, error:error.message, body:Buffer.alloc(0) }; }
    await new Promise(r=>setTimeout(r,1000));
  }
  return result;
}
function collect(html, source) {
  for (const match of html.matchAll(/<(a|link|script|img|source)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = {};
    for (const a of match[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)) attrs[a[1].toLowerCase()] = a[3];
    if (tag === 'a' && attrs.href) add(pages,attrs.href,source);
    if (attrs.src) add(assets,attrs.src,source);
    if (tag==='link' && /stylesheet|icon|preload/.test(attrs.rel||'') && attrs.href) add(assets,attrs.href,source);
    if (attrs.srcset && !attrs.srcset.startsWith('data:')) {
      for (const src of attrs.srcset.split(',')) add(assets,src.trim().split(/\s+/)[0],source);
    }
  }
}
const sitemap = await request(new URL('/sitemap.xml',base));
if (sitemap.status!==200) throw new Error(`sitemap HTTP ${sitemap.status}`);
for (const match of sitemap.body.toString().matchAll(/<loc>(.*?)<\/loc>/g)) add(pages,match[1],base);
for (const slug of ['anal','otel','yabanci','gfe','kumral','balik-etli','genc']) add(pages,`/${slug}-escort`,base);
for (const [url, origin] of pages) {
  if (report.pages.length >= 3000) throw new Error('Unexpected crawl expansion; stopped before incomplete coverage');
  const result = await request(url);
  const { body, ...metadata } = result;
  const row = { ...origin, ...metadata };
  if (result.status!==200) report.failures.push({ kind:'page', ...row });
  if (/text\/html/.test(result.type)) collect(body.toString(),url);
  report.pages.push(row);
  if (report.pages.length%50===0) console.error(`pages ${report.pages.length}/${pages.size}`);
  await new Promise(r=>setTimeout(r,80));
}
for (const [url, origin] of assets) {
  const result = await request(url);
  const { body, ...metadata } = result;
  const row = { ...origin, ...metadata };
  if (result.status!==200 || !result.bytes || /text\/html/.test(result.type)) report.failures.push({ kind:'asset', ...row });
  if (/text\/css/.test(result.type)) {
    for (const match of body.toString().matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) add(assets,match[1],url);
  }
  report.assets.push(row);
  await new Promise(r=>setTimeout(r,80));
}
report.external = [...external].sort();
report.ok = !report.failures.length;
const output = option('output','');
if (output) await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({ ok:report.ok, pages:report.pages.length, assets:report.assets.length, external:report.external.length, failures:report.failures },null,2));
process.exitCode = report.ok ? 0 : 1;
