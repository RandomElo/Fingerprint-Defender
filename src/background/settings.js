// Réglages gardés en mémoire. Les écouteurs réseau voient passer toutes les requêtes : on ne relit pas le stockage à chaque fois.
let settingsCache = null;

async function settings() {
  if (!settingsCache) {
    const s = await chrome.storage.local.get(FSH_DEFAULTS);
    settingsCache = { ...s, features: { ...FSH_DEFAULTS.features, ...s.features } };
  }
  return settingsCache;
}

// Ces clés bougent tout le temps (statistiques, caches) et ne sont pas des réglages : elles ne vident pas le cache.
const NOT_SETTINGS = ["stats", "repCache", "rankCache", "alerts", "feeds", "feedsMeta", "habits", "graph", "daily", "certRoots"];
// Les listes de menaces changent le verdict des sites : elles vident le cache des verdicts de navigation, pas celui des réglages.
// Marqueur de synchronisation : le banc de test écrit `__sync` avec ses réglages et attend que l'arrière-plan l'ait vu (voir
// syncReady dans background.js). Sans effet pour l'utilisateur.
let syncMarker = null;

chrome.storage.onChanged.addListener((changes) => {
  if (changes.__sync) syncMarker = changes.__sync.newValue;
  if (Object.keys(changes).some((k) => !NOT_SETTINGS.includes(k))) settingsCache = null;
});

const isAllowed = (list, host) => list.some((d) => host === d || host.endsWith("." + d));
