// Ce que les sites font de toi, en chiffres : les tiers contactés par page (note de vie privée du popup), qui apparaît sur combien
// de sites (tableau de bord), et ce qui a été bloqué jour par jour (bilan de la semaine). Tout reste en local.
// Les comptes sont gardés en mémoire et écrits par lots : écrire dans le stockage à chaque requête serait trop lourd.
const thirdBuf = new Map(); // onglet -> Map(domaine tiers -> nombre de requêtes)
const dailyBuf = {}; // type de blocage -> nombre, depuis la dernière écriture
let activityTimer = 0;
const MAX_GRAPH_SITES = 300;
const MAX_THIRD_PER_SITE = 80;

function scheduleActivityFlush() {
  if (!activityTimer) activityTimer = setTimeout(flushActivity, 1500);
}

// Un blocage de plus aujourd'hui, par type (trackers, localnet, identifiers, beacons, embeds, consent, clipboard...).
function bumpDaily(kind) {
  dailyBuf[kind] = (dailyBuf[kind] || 0) + 1;
  dailyBuf.blocked = (dailyBuf.blocked || 0) + 1;
  scheduleActivityFlush();
}

function noteThirdParty(details) {
  if (details.type === "main_frame" || !(details.tabId >= 0)) return;
  const top = topHostOf(details);
  const host = fshPageHost(details.url);
  if (!top || !host || fshIsLocal(top)) return;
  const reg = fshRegistrable(host);
  if (reg === fshRegistrable(top)) return;
  let m = thirdBuf.get(details.tabId);
  if (!m) thirdBuf.set(details.tabId, (m = new Map()));
  if (m.size < MAX_THIRD_PER_SITE || m.has(reg)) m.set(reg, (m.get(reg) || 0) + 1);
  scheduleActivityFlush();
}

let graphQueue = Promise.resolve();

async function flushActivity() {
  activityTimer = 0;
  const entries = [...thirdBuf];
  thirdBuf.clear();
  const daily = { ...dailyBuf };
  for (const k of Object.keys(dailyBuf)) delete dailyBuf[k];

  for (const [tabId, m] of entries) {
    notePage(tabId, (t) => {
      t.third = t.third || {};
      for (const [d, n] of m) t.third[d] = (t.third[d] || 0) + n;
    });
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    let site = "";
    try {
      site = tab && !tab.incognito ? fshRegistrable(new URL(tab.url).hostname) : "";
    } catch (_) {}
    if (!site) continue;
    graphQueue = graphQueue.then(async () => {
      const { graph } = await chrome.storage.local.get({ graph: {} });
      graph[site] = [...new Set([...(graph[site] || []), ...m.keys()])].slice(0, MAX_THIRD_PER_SITE);
      const sites = Object.keys(graph);
      if (sites.length > MAX_GRAPH_SITES) for (const s of sites.slice(0, sites.length - MAX_GRAPH_SITES)) delete graph[s];
      await chrome.storage.local.set({ graph });
    });
  }

  if (Object.keys(daily).length) {
    graphQueue = graphQueue.then(async () => {
      const { daily: stored } = await chrome.storage.local.get({ daily: {} });
      const today = new Date().toISOString().slice(0, 10);
      stored[today] = stored[today] || {};
      for (const [k, n] of Object.entries(daily)) stored[today][k] = (stored[today][k] || 0) + n;
      for (const day of Object.keys(stored).sort().slice(0, -14)) delete stored[day]; // on garde deux semaines
      await chrome.storage.local.set({ daily: stored });
    });
  }
}

// Observation seulement (pas de « blocking ») : ce listener ne retarde aucune requête.
chrome.webRequest.onBeforeRequest.addListener(noteThirdParty, { urls: ["http://*/*", "https://*/*"] });
