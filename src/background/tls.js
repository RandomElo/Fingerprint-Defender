// Connexion chiffrée : ce que Firefox sait de la connexion de la page (version de TLS, certificat, HSTS, nom du site chiffré).
// Sert à trois choses : une ligne dans le popup, un avertissement quand le certificat vient d'être émis sur un domaine très récent
// (voir fshWithPage), et une alerte quand le certificat d'un site habituel ne vient plus d'une autorité reconnue par Firefox.
// Tout est dans un try : si une version de Firefox change cette interface, la page se charge comme si de rien n'était.
async function onHeadersTls(details) {
  try {
    const s = await settings();
    if (!s.enabled || !s.features.tls) return {};
    const info = await browser.webRequest.getSecurityInfo(details.requestId, { certificateChain: true });
    if (!info || info.state === "insecure" || !info.certificates || !info.certificates.length) return {};
    const leaf = info.certificates[0];
    const root = info.certificates[info.certificates.length - 1];
    const host = fshPageHost(details.url);
    const tls = {
      host,
      protocol: info.protocolVersion || "",
      hsts: !!info.hsts,
      ech: !!info.usedEch,
      issuer: fshCertIssuer(leaf.issuer && (leaf.issuer.name || leaf.issuer)),
      validFrom: leaf.validity ? leaf.validity.start : 0,
      builtInRoot: typeof root.isBuiltInRoot === "boolean" ? root.isBuiltInRoot : null,
    };
    notePage(details.tabId, (t) => (t.tls = tls));
    watchRoot(details.tabId, tls);
  } catch (_) {}
  return {};
}

// On retient, pour les sites habituels, si leur certificat venait d'une autorité reconnue. Un changement est une alerte.
async function watchRoot(tabId, tls) {
  if (tls.builtInRoot === null) return;
  const reg = fshRegistrable(tls.host);
  const { habits, certRoots } = await chrome.storage.local.get({ habits: {}, certRoots: {} });
  if (!habits[reg] || habits[reg].n < 3) return;
  const before = certRoots[reg];
  if (fshRootChange(before, tls.builtInRoot)) {
    recordScam({ kind: "cert", host: tls.host, level: "dangerous", reasons: ["le certificat ne vient plus d'une autorité reconnue"] });
    chrome.tabs.sendMessage(tabId, { type: "cert-warning", host: tls.host }, { frameId: 0 }).catch(() => {});
  }
  certRoots[reg] = { builtIn: tls.builtInRoot, n: (before ? before.n : 0) + 1 };
  await chrome.storage.local.set({ certRoots });
}

browser.webRequest.onHeadersReceived.addListener(onHeadersTls, { urls: ["https://*/*"], types: ["main_frame"] }, ["blocking"]);
