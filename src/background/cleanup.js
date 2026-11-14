// Nettoyage des données de navigation : à la fermeture du dernier onglet d'un site (réglage « cleanOnClose », désactivé par
// défaut : on serait déconnecté de tout), et le bouton d'urgence du popup.

// Les noms d'hôte ouverts par onglet : un site se compte avec ses sous-domaines (www, mon-compte...).
const tabSites = new Map(); // tabId -> nom d'hôte
const siteHosts = new Map(); // domaine -> noms d'hôte vus

function trackTab(tab) {
  if (!tab || tab.id == null) return;
  try {
    const u = new URL(tab.url || "");
    if (!/^https?:$/.test(u.protocol) || tab.incognito) return tabSites.delete(tab.id);
    tabSites.set(tab.id, u.hostname);
    const reg = fshRegistrable(u.hostname);
    siteHosts.set(reg, new Set([...(siteHosts.get(reg) || []), u.hostname]));
  } catch (_) {
    tabSites.delete(tab.id);
  }
}
chrome.tabs.query({}).then((tabs) => tabs.forEach(trackTab));
chrome.tabs.onUpdated.addListener((id, info, tab) => (info.url !== undefined || info.status === "complete") && trackTab(tab));

async function cleanSite(host) {
  const s = await settings();
  if (!s.enabled || !s.cleanOnClose) return;
  const open = (await chrome.tabs.query({})).map((t) => {
    try {
      return new URL(t.url).hostname;
    } catch (_) {
      return "";
    }
  });
  if (!fshShouldCleanSite(host, s.cleanKeep, open)) return;
  const reg = fshRegistrable(host);
  const hostnames = [...new Set([reg, host, ...(siteHosts.get(reg) || [])])];
  // Firefox Android ne sait pas effacer par site : le nettoyage à la fermeture n'y existe pas.
  if (!chrome.browsingData) return;
  await chrome.browsingData.remove({ hostnames }, { cookies: true, localStorage: true, indexedDB: true, serviceWorkers: true });
  siteHosts.delete(reg);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const host = tabSites.get(tabId);
  tabSites.delete(tabId);
  // Un court délai : un onglet fermé par erreur et rouvert aussitôt ne doit pas perdre sa session.
  if (host) setTimeout(() => cleanSite(host).catch(() => {}), 2500);
});

// Bouton d'urgence : ferme tous les onglets, efface l'activité récente (cookies, stockage, cache, historique, téléchargements,
// formulaires) et change d'identité. `hours` : la durée à effacer, 0 pour tout.
async function panic(hours) {
  const since = hours > 0 ? Date.now() - hours * 3600000 : 0;
  const tabs = await chrome.tabs.query({});
  await chrome.tabs.create({}); // pour que la fenêtre reste ouverte
  await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
  if (chrome.browsingData) {
    const all = { cookies: true, localStorage: true, indexedDB: true, serviceWorkers: true, cache: true, history: true, downloads: true, formData: true };
    // Firefox Android refuse les types qu'il ne connaît pas : on retombe sur ce qu'il sait effacer.
    await chrome.browsingData.remove({ since }, all).catch(() => chrome.browsingData.remove({ since }, { cookies: true, cache: true, history: true }));
  }
  // Le graphe des tiers et les sites habituels sont une liste des sites visités : ils partent aussi.
  await chrome.storage.local.remove(["graph", "daily", "alerts"]);
  await chrome.storage.local.set({ seed: randomSeed(), seedAt: Date.now(), habits: {} });
  return true;
}

// Les actions destructives ou qui touchent au presse-papiers ne viennent que des pages de l'extension (popup, tableau de bord),
// jamais d'un script de contenu.
const fromExtensionPage = (sender) => !!sender && typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
