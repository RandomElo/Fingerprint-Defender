// En-têtes envoyés aux sites : Accept-Language, Sec-GPC et Referer.
//  - Accept-Language : même liste réduite que navigator.languages (niveau renforcé), pour que le serveur et la page
//    voient la même chose.
//  - Sec-GPC : refus de la vente et du partage des données, qui a une valeur légale dans plusieurs pays (RGPD, CCPA).
//  - Referer : réduit à l'origine pour une requête vers un autre site, même si le site a demandé l'inverse.
async function rewriteHeaders(details) {
  const s = await settings();
  if (!s.enabled) return {};
  let host;
  try {
    host = new URL(details.url).hostname;
  } catch (_) {
    return {};
  }
  if (isAllowed(s.allowlist, host)) return {};

  const headers = details.requestHeaders;
  const find = (name) => headers.find((x) => x.name.toLowerCase() === name);
  let changed = false;

  if (s.level === "renforce" && s.features.screen) {
    const h = find("accept-language");
    const v = h && fshAcceptLanguage(h.value);
    if (h && v !== h.value) {
      h.value = v;
      changed = true;
    }
  }
  if (s.features.gpc && !find("sec-gpc")) {
    headers.push({ name: "Sec-GPC", value: "1" });
    changed = true;
  }
  if (s.features.referer) {
    const h = find("referer");
    const v = h && fshTrimReferer(h.value, details.url);
    if (h && v !== h.value) {
      h.value = v;
      changed = true;
    }
  }
  return changed ? { requestHeaders: headers } : {};
}

chrome.webRequest.onBeforeSendHeaders.addListener(rewriteHeaders, { urls: ["http://*/*", "https://*/*"] }, ["blocking", "requestHeaders"]);
