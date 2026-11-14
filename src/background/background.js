// Réglages initiaux, filtre des URL, statistiques et analyse de réputation des sites.
function randomSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Retire utm_, fbclid, gclid... AVANT l'envoi de la requête : le site ne reçoit jamais le paramètre.
// (La règle declarativeNetRequest n'était pas appliquée par Firefox, d'où ce filtre bloquant.)
async function stripTracking(details) {
  // Sans « ? » ni segment /ref=, il n'y a rien à retirer : on évite de lire les réglages pour chaque requête.
  if (!details.url.includes("?") && !details.url.includes("/ref=")) return {};
  const cleaned = fshCleanUrl(details.url);
  if (cleaned === details.url) return {};

  const s = await settings();
  if (!s.enabled || !s.features.cleanUrls || isAllowed(s.allowlist, fshPageHost(details.url))) return {};
  return { redirectUrl: cleaned };
}

chrome.webRequest.onBeforeRequest.addListener(
  stripTracking,
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame", "xmlhttprequest", "image", "imageset"] },
  ["blocking"]
);

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
    const t = pageStats[tabId] || (pageStats[tabId] = { flagged: {}, blocked: {} });
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
  if (info.status === "loading" && info.url !== undefined) notePage(tabId, (t) => ((t.flagged = {}), (t.blocked = {}), (t.domains = {}), (t.payment = []), (t.third = {})));
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
    await browser.action.setBadgeTextColor({ tabId, color: "#ffffff" }).catch(() => {}); // absent de Firefox Android
    await browser.action.setTitle({
      tabId,
      title: d.kind === "score" ? `Fingerprint Defender : ${d.label}, ${res.score}/100` : `Fingerprint Defender : ${d.label}`,
    });
  } catch (_) {}
}

// Signaux lus dans la page elle-même (boutique, mentions légales...), par onglet.
async function withPage(tabId, res) {
  if (!res || tabId == null) return res;
  const { pageSignals, pageStats } = await chrome.storage.session.get({ pageSignals: {}, pageStats: {} });
  const sig = pageSignals[tabId];
  const tls = pageStats[tabId] && pageStats[tabId].tls && pageStats[tabId].tls.host === res.host ? pageStats[tabId].tls : null;
  const here = sig && sig.host === res.host ? sig : null;
  if (!here && !tls) return res;
  return fshWithPage(res, { shop: here ? here.shop : false, findings: here ? here.findings : [], tls });
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
  if (!sure) {
    // Pas assez grave pour être bloqué, mais s'il s'écrit presque comme un site que tu visites souvent, on te le dit.
    const f = await settings();
    if (!f.features.typo) return {};
    const { habits } = await chrome.storage.local.get({ habits: {} });
    const like = fshLooksLikeHabit(h, habits);
    if (!like) return {};
    recordScam({ kind: "typo", host: h, level: "doubtful", reasons: [`ressemble à ${like}`] });
    return { redirectUrl: chrome.runtime.getURL("src/pages/blocked/blocked.html") + "?kind=typo&like=" + encodeURIComponent(like) + "&u=" + encodeURIComponent(details.url) };
  }
  updateSafetyStats((x) => (x.alerts += 1));
  return { redirectUrl: chrome.runtime.getURL("src/pages/blocked/blocked.html") + "?u=" + encodeURIComponent(details.url) };
}

chrome.webRequest.onBeforeRequest.addListener(guardNavigation, { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }, ["blocking"]);

// Alertes d'arnaque (presse-papiers, paiement, fausse fenêtre de connexion...) : ajoutées à la liste du tableau de bord.
const SCAM_LABELS = {
  clickfix: "Commande piégée copiée (ClickFix)",
  obfuscated: "Commande PowerShell cachée copiée",
  hijack: "Adresse remplacée au moment de copier",
  payment: "Prestataire de paiement douteux",
  bitb: "Fausse fenêtre de connexion",
  tab: "Onglet qui change d'apparence",
  typo: "Site qui ressemble à un site habituel",
  download: "Téléchargement dangereux",
  cert: "Certificat suspect",
};

function recordScam(msg) {
  const label = SCAM_LABELS[msg.kind];
  if (!label) return;
  updateSafetyStats((x) => (x.alerts += 1));
  queue = queue.then(async () => {
    const { alerts } = await chrome.storage.local.get({ alerts: [] });
    const reasons = [label, ...(Array.isArray(msg.reasons) ? msg.reasons.map(String).slice(0, 3) : [])];
    alerts.unshift({ t: Date.now(), host: String(msg.host || "").slice(0, 100), verdict: msg.level === "doubtful" ? "doubtful" : "dangerous", score: null, reasons, from: "" });
    await chrome.storage.local.set({ alerts: alerts.slice(0, 100) });
  });
}

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

// Répond quand les réglages et tout ce qui en dépend (pisteurs appris, identifiants) sont à jour, avec le dernier marqueur vu.
async function syncReady() {
  await Promise.all([settings(), learnedReady, needlesReady]);
  return syncMarker;
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
  if (msg.type === "identity") return identityContext(sender).then((ctx) => ({ ctx }));
  if (msg.type === "alert-scam" && sender.tab) recordScam(msg);
  if (msg.type === "payment-check") onPaymentCheck(msg, sender);
  if (msg.type === "clip-trimmed" && sender.tab) countBlocked(sender.tab.id, "clipboard");
  if (msg.type === "sync-marker") return syncReady();
  if (fromExtensionPage(sender)) {
    if (msg.type === "panic") return panic(Number(msg.hours) || 0);
    if (msg.type === "open-disposable") return openDisposable(msg.url);
    if (msg.type === "copy-clean-link") return copyCleanLink(msg.url);
  }
  if (msg.type === "download-allow" && typeof msg.url === "string") return allowDownloadOnce(msg.url);
  if (msg.type === "consent-refused" && sender.tab) countBlocked(sender.tab.id, "consent", String(msg.cmp).slice(0, 40));
  if (msg.type === "embed-info") return Promise.resolve({ site: topSiteOf(sender) });
  if (msg.type === "embed-allow" && typeof msg.url === "string") return allowEmbedOnce(msg.url);
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
