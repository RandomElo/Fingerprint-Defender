// Scripts de worker. Les scripts de contenu n'entrent pas dans un Web Worker : sans cela, un pisteur y lit le canvas, WebGL, les cœurs et
// les langues réels, puis les compare à ceux de la page. Le noyau de brouillage (noise-core.js) est donc copié en tête de la réponse.
// La configuration (clé du site, niveau) voyage dans le nom du worker, posé par inject.js ; sans elle, le texte copié ne fait rien.
// Les workers dont le script est un blob: sont traités dans la page (inject.js). Les Service Workers ne sont pas touchés : ils ne
// servent pas à lire l'empreinte et réécrire leur script les ferait se mettre à jour sans raison.
const fshWorkerRequests = new Set(); // requêtes dont l'en-tête Sec-Fetch-Dest dit « worker »
let fshWorkerPrefix = null;
const fshUseStrict = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*(['"])use strict\1;?/;

browser.webRequest.onBeforeSendHeaders.addListener(
  (d) => {
    const dest = (d.requestHeaders || []).find((h) => h.name.toLowerCase() === "sec-fetch-dest");
    if (dest && /^(worker|sharedworker)$/i.test(dest.value || "")) fshWorkerRequests.add(d.requestId);
  },
  { urls: ["http://*/*", "https://*/*"], types: ["script", "other"] },
  ["requestHeaders"]
);

browser.webRequest.onHeadersReceived.addListener(
  async (d) => {
    if (!fshWorkerRequests.delete(d.requestId) || d.statusCode !== 200) return {};
    const s = await settings();
    if (!s.enabled) return {};
    if (!fshWorkerPrefix) fshWorkerPrefix = new TextEncoder().encode(fshCore.workerSource(null));
    const filter = browser.webRequest.filterResponseData(d.requestId);
    let first = true;
    filter.ondata = (e) => {
      if (!first) return filter.write(e.data);
      first = false;
      // « use strict » doit rester la première instruction du script : le texte s'insère après.
      const head = new TextDecoder("utf-8").decode(new Uint8Array(e.data, 0, Math.min(e.data.byteLength, 400)));
      const m = fshUseStrict.exec(head);
      const at = m ? new TextEncoder().encode(m[0]).length : 0;
      const bytes = new Uint8Array(e.data);
      const out = new Uint8Array(bytes.length + fshWorkerPrefix.length);
      out.set(bytes.subarray(0, at), 0);
      out.set(fshWorkerPrefix, at);
      out.set(bytes.subarray(at), at + fshWorkerPrefix.length);
      filter.write(out);
    };
    filter.onstop = () => filter.disconnect();
    filter.onerror = () => {};
    return {};
  },
  { urls: ["http://*/*", "https://*/*"], types: ["script", "other"] },
  ["blocking"]
);
// Une requête qui échoue ne passe jamais par onHeadersReceived : on ne garde pas son identifiant.
browser.webRequest.onErrorOccurred.addListener((d) => fshWorkerRequests.delete(d.requestId), { urls: ["http://*/*", "https://*/*"] });
