// Requêtes réseau d'une page : pings et balises vers un autre site, adresses du réseau local jointes depuis Internet.
// Les deux sont coupés ici, au niveau du réseau, donc aussi quand la requête vient d'un worker ou d'un attribut
// `ping`, que les scripts injectés dans la page ne voient pas.

// Compte une requête coupée sur la page de l'onglet (pour le popup), avec le domaine visé s'il y en a un.
function countBlocked(tabId, kind, domain) {
  bumpDaily(kind);
  if (!(tabId >= 0)) return;
  notePage(tabId, (t) => {
    t.blocked = t.blocked || {};
    t.blocked[kind] = (t.blocked[kind] || 0) + 1;
    if (domain) {
      t.domains = t.domains || {};
      t.domains[domain] = (t.domains[domain] || 0) + 1;
    }
  });
}

// Hôte de la page de l'onglet qui a lancé la requête. Dans un cadre imbriqué, c'est celui du cadre le plus haut ;
// sinon le document qui a fait la requête (pour un worker blob:, l'origine qui l'a créé).
function topHostOf(details) {
  const ancestors = details.frameAncestors;
  const top = ancestors && ancestors.length ? ancestors[ancestors.length - 1].url : details.documentUrl || details.originUrl;
  return fshPageHost(top || "");
}

async function guardNetwork(details) {
  const s = await settings();
  if (!s.enabled) return {};
  // La page qui a lancé la requête (pour un worker blob:, l'origine qui l'a créé).
  const from = fshPageHost(details.documentUrl || details.originUrl || "");
  if (!from || isAllowed(s.allowlist, from)) return {};
  const to = fshPageHost(details.url);
  if (!to) return {};

  if ((details.type === "ping" || details.type === "beacon") && s.features.beacon && fshRegistrable(from) !== fshRegistrable(to)) {
    countBlocked(details.tabId, "beacons");
    return { cancel: true };
  }
  // Aller soi-même sur l'adresse de son routeur (navigation) reste possible : seules les sous-requêtes sont coupées.
  if (details.type !== "main_frame" && s.features.localnet && fshLocalAccessBlocked(from, to, s.localnetAllow)) {
    countBlocked(details.tabId, "localnet");
    return { cancel: true };
  }
  return {};
}

chrome.webRequest.onBeforeRequest.addListener(guardNetwork, { urls: ["http://*/*", "https://*/*"] }, ["blocking"]);
