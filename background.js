// Réglages initiaux, filtre des URL, statistiques et analyse de réputation des sites.
function randomSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Retire utm_, fbclid, gclid... AVANT l'envoi de la requête : le site ne reçoit jamais le paramètre.
// (La règle declarativeNetRequest n'était pas appliquée par Firefox, d'où ce filtre bloquant.)
const TRACKING = FSH_TRACKING;

async function stripTracking(details) {
  let u;
  try {
    u = new URL(details.url);
  } catch (_) {
    return {};
  }
  if (!u.search) return {};
  const keys = [...u.searchParams.keys()].filter((k) => TRACKING.test(k));
  if (!keys.length) return {};

  const s = await chrome.storage.local.get(FSH_DEFAULTS);
  const features = { ...FSH_DEFAULTS.features, ...s.features };
  const allowed = s.allowlist.some((d) => u.hostname === d || u.hostname.endsWith("." + d));
  if (!s.enabled || !features.cleanUrls || allowed) return {};

  keys.forEach((k) => u.searchParams.delete(k));
  return { redirectUrl: u.href };
}

chrome.webRequest.onBeforeRequest.addListener(
  stripTracking,
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame"] },
  ["blocking"]
);

// --- en-têtes des requêtes ---------------------------------------------------------------------------
// Réglages gardés en mémoire : cet écouteur voit passer toutes les requêtes, on ne relit pas le stockage à chaque fois.
let settingsCache = null;
async function settings() {
  if (!settingsCache) {
    const s = await chrome.storage.local.get(FSH_DEFAULTS);
    settingsCache = { ...s, features: { ...FSH_DEFAULTS.features, ...s.features } };
  }
  return settingsCache;
}
chrome.storage.onChanged.addListener(() => (settingsCache = null));

// Accept-Language : même liste réduite que navigator.languages (niveau renforcé), pour que le serveur et la page
// voient la même chose. Sec-GPC : refus de la vente et du partage des données, qui a une valeur légale
// dans plusieurs pays (RGPD, CCPA).
async function rewriteHeaders(details) {
  const s = await settings();
  if (!s.enabled) return {};
  let host;
  try {
    host = new URL(details.url).hostname;
  } catch (_) {
    return {};
  }
  if (s.allowlist.some((d) => host === d || host.endsWith("." + d))) return {};

  const headers = details.requestHeaders;
  let changed = false;
  if (s.level === "renforce" && s.features.screen) {
    const h = headers.find((x) => x.name.toLowerCase() === "accept-language");
    const v = h && fshAcceptLanguage(h.value);
    if (h && v !== h.value) {
      h.value = v;
      changed = true;
    }
  }
  if (s.features.gpc && !headers.some((x) => x.name.toLowerCase() === "sec-gpc")) {
    headers.push({ name: "Sec-GPC", value: "1" });
    changed = true;
  }
  return changed ? { requestHeaders: headers } : {};
}

chrome.webRequest.onBeforeSendHeaders.addListener(rewriteHeaders, { urls: ["http://*/*", "https://*/*"] }, ["blocking", "requestHeaders"]);

// --- changement automatique d'identité -------------------------------------------------------------------
async function rotateSeedIfDue(startup = false) {
  const s = await chrome.storage.local.get({ seedRotation: FSH_DEFAULTS.seedRotation, seedAt: 0 });
  if (fshSeedDue(s.seedRotation, s.seedAt, Date.now(), startup)) {
    await chrome.storage.local.set({ seed: randomSeed(), seedAt: Date.now() });
  }
}
chrome.runtime.onStartup.addListener(() => rotateSeedIfDue(true));
chrome.alarms.create("seed", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((a) => a.name === "seed" && rotateSeedIfDue());
// Choisir « chaque jour » alors que la graine a plus d'un jour la renouvelle tout de suite.
chrome.storage.onChanged.addListener((changes) => changes.seedRotation && rotateSeedIfDue());

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  await chrome.storage.local.set({
    ...FSH_DEFAULTS,
    ...current,
    features: { ...FSH_DEFAULTS.features, ...(current.features || {}) },
    seed: current.seed || randomSeed(),
    seedAt: current.seedAt || Date.now(),
  });
});

// --- pisteurs probables ----------------------------------------------------------
// On ne garde que les scripts tiers signalés par inject.js (voir les points par surface) et le nombre
// d'analyses de sites. Aucun compteur de blocage ni de brouillage.
const MAX_TRACKERS = 200;
let queue = Promise.resolve();

const freshStats = () => ({ v: 3, since: Date.now(), flagged: 0, pisteurs: {}, safety: { checked: 0, alerts: 0 } });

async function loadStats() {
  const { stats } = await chrome.storage.local.get("stats");
  if (stats && stats.v === 3) return stats;
  const s = freshStats();
  if (stats && stats.safety) s.safety = stats.safety; // on garde le compteur d'analyses
  return s;
}

// Données de la page en cours, par onglet (lues par le popup).
function notePage(tabId, fn) {
  if (tabId == null) return;
  queue = queue.then(async () => {
    const { pageStats } = await chrome.storage.session.get({ pageStats: {} });
    const t = pageStats[tabId] || (pageStats[tabId] = { flagged: {} });
    fn(t);
    await chrome.storage.session.set({ pageStats });
  });
}

function addStats({ host, flagged }, tabId) {
  const own = fshRegistrable(host);
  const third = (flagged || []).filter((x) => x && typeof x.src === "string" && x.src !== own);
  if (!third.length) return;

  queue = queue.then(async () => {
    const s = await loadStats();
    for (const { src, f } of third) {
      s.flagged += 1;
      const old = s.pisteurs[src] || { n: 0, f: [], p: [] };
      s.pisteurs[src] = {
        n: old.n + 1,
        f: [...new Set([...old.f, ...f])],
        p: [host, ...(old.p || []).filter((h) => h !== host)].slice(0, 5), // pages où il a été vu
      };
    }
    const entries = Object.entries(s.pisteurs);
    if (entries.length > MAX_TRACKERS) {
      s.pisteurs = Object.fromEntries(entries.sort((a, b) => b[1].n - a[1].n).slice(0, MAX_TRACKERS));
    }
    await chrome.storage.local.set({ stats: s });
  });

  notePage(tabId, (t) => {
    for (const { src, f } of third) t.flagged[src] = [...new Set([...(t.flagged[src] || []), ...f])];
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "stats" && typeof msg.host === "string") addStats(msg, sender.tab && sender.tab.id);
});

// L'onglet qui commence une nouvelle page repart de zéro.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url !== undefined) notePage(tabId, (t) => (t.flagged = {}));
});
chrome.tabs.onRemoved.addListener((tabId) => {
  queue = queue.then(async () => {
    const { pageStats } = await chrome.storage.session.get({ pageStats: {} });
    delete pageStats[tabId];
    await chrome.storage.session.set({ pageStats });
  });
});

// --- sécurité des sites ------------------------------------------------------------
function updateSafetyStats(mutate) {
  queue = queue.then(async () => {
    const s = await loadStats();
    mutate(s.safety);
    await chrome.storage.local.set({ stats: s });
  });
}

// Pastille de l'icône, pour chaque page web : un point rouge, orange ou vert selon le verdict. La note sur 100
// n'est pas écrite sur l'icône : elle reste dans l'infobulle et dans le popup.

async function setBadge(tabId, res) {
  try {
    if (!res) return await browser.action.setBadgeText({ tabId, text: "" });
    const d = fshDisplay(res);
    // Point de couleur pour une note ; "?" quand l'analyse est incomplète, maison pour le réseau local.
    const text = d.kind === "local" ? "⌂" : d.kind === "unverified" ? "?" : "●";
    await browser.action.setBadgeText({ tabId, text });
    await browser.action.setBadgeBackgroundColor({ tabId, color: d.color });
    await browser.action.setBadgeTextColor({ tabId, color: "#ffffff" });
    await browser.action.setTitle({
      tabId,
      title: d.kind === "score" ? `Fingerprint Defender : ${d.label}, ${res.score}/100` : `Fingerprint Defender : ${d.label}`,
    });
  } catch (_) {}
}

// Signaux lus dans la page elle-même (boutique, mentions légales...), par onglet.
async function withPage(tabId, res) {
  if (!res || tabId == null) return res;
  const { pageSignals } = await chrome.storage.session.get({ pageSignals: {} });
  const sig = pageSignals[tabId];
  if (!sig || sig.host !== res.host) return res;
  return fshWithPage(res, sig);
}

// Au chargement d'une page, on calcule le score de l'icône. Avec l'analyse automatique (réglage), l'analyse
// complète est faite (DNS, âge du domaine) ; sinon seules les listes locales et l'adresse sont examinées.
async function refreshBadge(tabId, url) {
  if (!url || !/^https?:/.test(url)) return setBadge(tabId, null);
  const s = await chrome.storage.local.get({ safetyMode: FSH_DEFAULTS.safetyMode, safetyOnline: FSH_DEFAULTS.safetyOnline, safetyAuto: FSH_DEFAULTS.safetyAuto });
  if (s.safetyMode === "off") return setBadge(tabId, null);
  const res = await Reputation.checkSite(url, { online: s.safetyAuto && s.safetyOnline });
  if (res && !res.cached) updateSafetyStats((x) => (x.checked += 1));
  setBadge(tabId, await withPage(tabId, res));
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading" && info.url !== undefined) {
    queue = queue.then(async () => {
      const { pageSignals } = await chrome.storage.session.get({ pageSignals: {} });
      delete pageSignals[tabId];
      await chrome.storage.session.set({ pageSignals });
    });
  }
  if (info.status === "complete" || info.url) refreshBadge(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    refreshBadge(tabId, (await chrome.tabs.get(tabId)).url);
  } catch (_) {}
});

async function handleCheck(msg) {
  const { safetyOnline } = await chrome.storage.local.get({ safetyOnline: FSH_DEFAULTS.safetyOnline });
  let res = await Reputation.checkSite(msg.url, { online: safetyOnline });
  if (res && !res.cached) updateSafetyStats((x) => (x.checked += 1));
  res = await withPage(msg.tabId, res);
  if (res && msg.tabId != null) setBadge(msg.tabId, res);
  return res;
}

function storePageSignals(msg, sender) {
  const tab = sender.tab;
  if (!tab || !Array.isArray(msg.findings)) return;
  const save = (findings) =>
    (queue = queue.then(async () => {
      const { pageSignals } = await chrome.storage.session.get({ pageSignals: {} });
      // Dans une application monopage, la boutique est une vue parmi d'autres : une fois vue, elle reste
      // comptée pour le site tant que l'onglet n'a pas rechargé une page, sauf si la vue actuelle dit autre chose.
      const old = pageSignals[tab.id];
      const sameSite = !!old && old.host === msg.host;
      const labels = new Set(findings.map((f) => f.label));
      const kept = sameSite && old.shop ? old.findings.filter((f) => !labels.has(f.label)) : [];
      pageSignals[tab.id] = { host: msg.host, shop: !!msg.shop || (sameSite && old.shop), findings: [...findings, ...kept].slice(0, 16) };
      await chrome.storage.session.set({ pageSignals });
      refreshBadge(tab.id, tab.url);
    }));
  save(msg.findings);

  // Numéros d'entreprise lus dans les mentions légales : vérifiés au registre officiel (réglage « en ligne »).
  if ((msg.ids && msg.ids.length) || (msg.bad && msg.bad.length)) {
    chrome.storage.local.get({ safetyOnline: FSH_DEFAULTS.safetyOnline, safetyAuto: FSH_DEFAULTS.safetyAuto }).then(async (s) => {
      const online = s.safetyOnline && s.safetyAuto;
      const extra = await Reputation.companyFindings(online ? msg.ids : [], msg.bad);
      if (extra.length) save([...msg.findings, ...extra]);
    });
  }
}

// --- garde de navigation : page de phishing probable, quel que soit le chemin du lien -------------------
// Un lien ouvert depuis un mail, une autre application ou la barre d'adresse ne passe pas par le script de
// la page : on contrôle donc aussi chaque navigation. Analyse locale uniquement (aucune attente réseau).
async function guardNavigation(details) {
  let u;
  try {
    u = new URL(details.url);
  } catch (_) {
    return {};
  }
  if (!/^https?:$/.test(u.protocol) || fshIsLocal(u.hostname)) return {};
  const s = await chrome.storage.local.get({ enabled: true, safetyMode: FSH_DEFAULTS.safetyMode, trusted: [] });
  if (!s.enabled || s.safetyMode === "off") return {};
  const h = u.hostname;
  if (s.trusted.some((d) => h === d || h.endsWith("." + d))) return {};
  const { bypass } = await chrome.storage.session.get({ bypass: {} });
  if (bypass[h] && Date.now() - bypass[h] < 3600000) return {};

  const res = await Reputation.checkSite(details.url, { online: false, noCache: true });
  const sure = res && res.verdict === "dangerous" && (res.findings.some((f) => f.critical) || res.score <= 30);
  if (!sure) return {};
  updateSafetyStats((x) => (x.alerts += 1));
  return { redirectUrl: chrome.runtime.getURL("blocked.html") + "?u=" + encodeURIComponent(details.url) };
}

chrome.webRequest.onBeforeRequest.addListener(guardNavigation, { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }, ["blocking"]);

function recordAlert(msg) {
  const r = msg.result;
  if (!r) return;
  updateSafetyStats((x) => (x.alerts += 1));
  queue = queue.then(async () => {
    const { alerts } = await chrome.storage.local.get({ alerts: [] });
    const reasons = r.findings.filter((f) => f.status === "bad" || f.status === "warn").map((f) => f.label).slice(0, 4);
    alerts.unshift({ t: Date.now(), host: r.host, verdict: r.verdict, score: r.score, reasons, from: msg.from || "" });
    await chrome.storage.local.set({ alerts: alerts.slice(0, 100) });
  });
}

// Site de l'onglet qui envoie le message, pour la clé de brouillage des cadres d'un autre site (content.js).
function topSiteOf(sender) {
  try {
    const u = new URL(sender.tab.url);
    if (/^https?:$/.test(u.protocol)) return fshRegistrable(u.hostname);
  } catch (_) {}
  return "";
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;
  if (msg.type === "top-site") return Promise.resolve({ site: topSiteOf(sender) });
  if (msg.type === "check") return handleCheck(msg);
  if (msg.type === "page-signals") storePageSignals(msg, sender);
  if (msg.type === "alert") recordAlert(msg);
  if (msg.type === "feeds-update") return Reputation.updateFeeds();
});

// Listes de menaces : mises à jour toutes les 6 heures.
async function refreshFeedsIfOld() {
  const { feedsMeta } = await chrome.storage.local.get("feedsMeta");
  if (!feedsMeta || Date.now() - feedsMeta.updated > 6 * 3600 * 1000) Reputation.updateFeeds();
}
chrome.alarms.create("feeds", { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((a) => a.name === "feeds" && refreshFeedsIfOld());
chrome.runtime.onStartup.addListener(refreshFeedsIfOld);
chrome.runtime.onInstalled.addListener(refreshFeedsIfOld);
