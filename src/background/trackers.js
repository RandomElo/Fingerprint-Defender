// Pisteurs appris : un script d'un autre domaine qui lit l'empreinte sur au moins trois sites différents (voir inject.js
// et fshLearnedTrackers) est bloqué ensuite, sur tous les sites. Ce n'est pas une liste : uBlock Origin et les listes
// font déjà ça pour les pisteurs connus. Ici on attrape ceux que personne n'a encore listés, d'après ce qu'ils font.
let learnedTrackers = new Set();

async function refreshLearned() {
  const { stats } = await chrome.storage.local.get("stats");
  learnedTrackers = fshLearnedTrackers(stats);
}
let learnedReady = refreshLearned();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.stats) learnedReady = refreshLearned();
});

async function guardTrackers(details) {
  if (details.type === "main_frame" || !learnedTrackers.size) return {};
  const s = await settings();
  if (!s.enabled || !s.features.trackers) return {};
  const top = topHostOf(details);
  const host = fshPageHost(details.url);
  if (!fshTrackerBlocked(learnedTrackers, top, host, s.trackerAllow) || isAllowed(s.allowlist, top)) return {};
  countBlocked(details.tabId, "trackers", fshRegistrable(host));
  return { cancel: true };
}

chrome.webRequest.onBeforeRequest.addListener(guardTrackers, { urls: ["http://*/*", "https://*/*"] }, ["blocking"]);
