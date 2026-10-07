"use strict";

(() => {
  const script = document.currentScript;
  const entries = new Map([
    ["landing", "/public/js/category-final.js"],
    ["detail", "/public/js/detail-final.js"],
    ["home", "/public/js/home-render.js"]
  ]);
  const entry = entries.get(script?.dataset.publicModule);
  if (!entry) return;
  // A trusted classic root starts a non-parser-inserted module graph.
  const moduleScript = document.createElement("script");
  moduleScript.type = "module";
  moduleScript.integrity = script.dataset.moduleIntegrity;
  moduleScript.crossOrigin = "anonymous";
  moduleScript.src = `${entry}?v=${encodeURIComponent(script.dataset.moduleVersion || "")}`;
  document.head.appendChild(moduleScript);
})();
