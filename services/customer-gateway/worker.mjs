import { isIP } from "node:net";

const API = "/api/customer/mobile";
const PROFILE_FIELDS = ["id", "name", "card_label", "age", "height", "weight", "city", "district", "description", "phone", "whatsapp", "telegram", "is_complete", "is_live", "state", "missing_fields", "updated_at"];
const ACCOUNT_FIELDS = ["id", "label", "email", "username", "max_profiles", "auto_publish", "must_change_password"];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
function profile(value) {
  if (!value || !/^[A-Za-z0-9_-]{1,80}$/.test(String(value.id))) throw new Error("invalid profile");
  return { ...pick(value, PROFILE_FIELDS), images: (value.images || []).map((_, index) => `${API}/profiles/${value.id}/images/${index}`) };
}
function safeResponse(value) {
  const output = { ok: true };
  if (value.account) output.account = pick(value.account, ACCOUNT_FIELDS);
  if (value.session) output.session = pick(value.session, ["token", "expires_at"]);
  if (value.quota) output.quota = pick(value.quota, ["limit", "unlimited", "used", "remaining", "ready", "live"]);
  if (value.profiles) output.profiles = value.profiles.map(profile);
  if (value.profile) output.profile = profile(value.profile);
  if (value.upload_id) { output.upload_id = value.upload_id; output.original_saved = value.original_saved === true; }
  return output;
}
function json(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
async function bounded(stream, maximum) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw Object.assign(new Error("too large"), { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
function routeAllowed(path, method) {
  if (method === "POST" && [API + "/login", API + "/password", API + "/profiles"].includes(path)) return true;
  if (method === "GET" && path === API + "/bootstrap") return true;
  if (/^\/api\/customer\/mobile\/profiles\/[A-Za-z0-9_-]{1,80}$/.test(path)) return ["GET", "PUT"].includes(method);
  if (/^\/api\/customer\/mobile\/profiles\/[A-Za-z0-9_-]{1,80}\/images$/.test(path)) return method === "POST";
  return method === "GET" && /^\/api\/customer\/mobile\/profiles\/[A-Za-z0-9_-]{1,80}\/images\/(?:[0-9]|1[01])$/.test(path);
}
export async function handle(request, env, fetchOrigin = fetch) {
  if (env.ENABLED !== "true") return json({ ok: false }, 404);
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.search || !routeAllowed(url.pathname, request.method)) return json({ ok: false }, 404);
  const edgeIp = request.headers.get("CF-Connecting-IP") || "";
  const edgeIpv6 = request.headers.get("CF-Connecting-IPv6") || "";
  if (!isIP(edgeIp)) return json({ ok: false }, 403);
  // Cloudflare preserves the real IPv6 here when pseudo IPv4 overwrites the IP.
  const pseudoIpv4 = isIP(edgeIp) === 4 && Number(edgeIp.split(".")[0]) >= 240;
  const clientIp = pseudoIpv4 && isIP(edgeIpv6) === 6 ? edgeIpv6 : edgeIp;
  try {
    const origin = new URL(env.CUSTOMER_ORIGIN_URL);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash ||
        origin.pathname !== "/" || String(env.CUSTOMER_GATEWAY_ORIGIN_SECRET || "").length < 32 || origin.origin === url.origin) throw new Error("configuration");
    const headers = new Headers({ Accept: "application/json", "X-Customer-Origin-Secret": env.CUSTOMER_GATEWAY_ORIGIN_SECRET });
    headers.set("X-Customer-Client-IP", clientIp);
    const authorization = request.headers.get("Authorization");
    if (authorization) {
      if (!/^Bearer [A-Za-z0-9._-]{1,4096}$/.test(authorization)) return json({ ok: false }, 401);
      headers.set("Authorization", authorization);
    }
    const isImage = request.method === "POST" && url.pathname.endsWith("/images");
    const isMedia = request.method === "GET" && /\/images\/\d+$/.test(url.pathname);
    const type = (request.headers.get("Content-Type") || "").split(";")[0].toLowerCase();
    let body;
    if (request.method !== "GET") {
      if (!(isImage ? ["image/jpeg", "image/png", "image/webp"].includes(type) : type === "application/json")) return json({ ok: false }, 415);
      const max = isImage ? 8 * 1024 * 1024 : 65536;
      if (Number(request.headers.get("Content-Length")) > max) return json({ ok: false }, 413);
      body = await bounded(request.body, max);
      headers.set("Content-Type", type);
      if (isImage) {
        const id = request.headers.get("X-Upload-Id") || "";
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) return json({ ok: false }, 400);
        headers.set("X-Upload-Id", id);
      }
    }
    const upstream = await fetchOrigin(new URL(url.pathname, origin), {
      method: request.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(55000)
    });
    if (upstream.status >= 300 && upstream.status < 400) { await upstream.body?.cancel(); return json({ ok: false }, 502); }
    if (isMedia && upstream.ok && upstream.headers.get("Content-Type")?.startsWith("image/jpeg")) {
      return new Response(await bounded(upstream.body, 3 * 1024 * 1024), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (!upstream.headers.get("Content-Type")?.startsWith("application/json")) { await upstream.body?.cancel(); return json({ ok: false }, 502); }
    const data = JSON.parse(new TextDecoder().decode(await bounded(upstream.body, 2 * 1024 * 1024)));
    if (!upstream.ok || !data.ok) {
      const code = data.code === "PASSWORD_CHANGE_REQUIRED" ? data.code : "REQUEST_FAILED";
      return json({ ok: false, code }, [400, 401, 403, 404, 409, 413, 415, 429].includes(upstream.status) ? upstream.status : 502);
    }
    return json(safeResponse(data), upstream.status);
  } catch (error) { return json({ ok: false, code: "REQUEST_FAILED" }, error.status === 413 ? 413 : 502); }
}
export default { fetch(request, env) { return handle(request, env); } };
