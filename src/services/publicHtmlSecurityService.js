"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parse } = require("parse5");
const { ROOT_DIR } = require("../config/env");
const { buildStrictPublicCsp } = require("../middleware/security");

const TRUSTED_SCRIPT_PATHS = new Set([
  "/public/js/deferred-css.js",
  "/public/js/components-loader.js",
  "/public/js/category-final.js",
  "/public/js/detail-final.js",
  "/public/js/home-render.js"
]);
const assetIntegrity = new Map();
const MODULE_ENTRY_NAMES = new Map([
  ["/public/js/category-final.js", "landing"],
  ["/public/js/detail-final.js", "detail"],
  ["/public/js/home-render.js", "home"]
]);

function scriptIntegrity(source) {
  return `sha384-${crypto.createHash("sha384").update(source).digest("base64")}`;
}

function trustedAsset(pathname) {
  if (!assetIntegrity.has(pathname)) {
    const source = fs.readFileSync(path.join(ROOT_DIR, pathname));
    assetIntegrity.set(pathname, {
      integrity: scriptIntegrity(source),
      version: crypto.createHash("sha256").update(source).digest("hex").slice(0, 24)
    });
  }
  return assetIntegrity.get(pathname);
}

function securePublicHtml(html) {
  const source = String(html);
  const document = parse(source, { sourceCodeLocationInfo: true });
  const edits = [];
  const hashes = new Set();

  function visit(node) {
    const location = node.sourceCodeLocation;
    if (node.tagName === "script" && node.namespaceURI === "http://www.w3.org/1999/xhtml" && location?.startTag) {
      const attributes = new Map(node.attrs.map((attribute) => [attribute.name, attribute.value]));
      const src = attributes.get("src") || "";
      const pathname = src.split("?")[0];
      const type = (attributes.get("type") || "").toLowerCase();
      const executable = ["", "module", "text/javascript", "application/javascript"].includes(type);

      // Only fixed application roots receive trust; arbitrary inline or injected tags do not.
      if (executable && TRUSTED_SCRIPT_PATHS.has(pathname) && !src.includes("#")) {
        const moduleEntry = type === "module" && MODULE_ENTRY_NAMES.get(pathname);
        const scriptPath = moduleEntry ? "/public/js/public-modules.js" : pathname;
        const { integrity, version } = trustedAsset(scriptPath);
        hashes.add(integrity);
        const mode = type === "module" && !moduleEntry ? ' type="module"' : "";
        const defer = attributes.has("defer") || moduleEntry ? " defer" : "";
        const async = attributes.has("async") ? " async" : "";
        const nomodule = attributes.has("nomodule") ? " nomodule" : "";
        const moduleData = moduleEntry
          ? ` data-public-module="${moduleEntry}" data-module-version="${trustedAsset(pathname).version}" data-module-integrity="${trustedAsset(pathname).integrity}"`
          : "";
        edits.push({
          start: location.startTag.startOffset,
          end: location.startTag.endOffset,
          value: `<script${mode}${defer}${async}${nomodule}${moduleData} src="${scriptPath}?v=${version}" integrity="${integrity}" crossorigin="anonymous">`
        });
      }
    }
    for (const child of node.childNodes || []) visit(child);
  }

  visit(document);
  let secured = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    secured = secured.slice(0, edit.start) + edit.value + secured.slice(edit.end);
  }
  return { html: secured, policy: buildStrictPublicCsp(hashes) };
}

function sendPublicHtml(res, html) {
  const secured = securePublicHtml(html);
  res.setHeader("Content-Security-Policy", secured.policy);
  return res.type("html").send(secured.html);
}

module.exports = { securePublicHtml, sendPublicHtml, scriptIntegrity };
