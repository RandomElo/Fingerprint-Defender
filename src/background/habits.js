// Sites habituels : un jour de visite de plus pour chaque site ouvert dans un onglet normal. Retenus en local seulement, jamais
// envoyés nulle part, et jamais depuis une fenêtre privée. Servent à reconnaître une faute de frappe (voir fshLooksLikeHabit).
const MAX_HABITS = 300;
let habitQueue = Promise.resolve();

function recordHabit(url) {
  let host;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return;
    host = u.hostname;
  } catch (_) {
    return;
  }
  if (fshIsLocal(host)) return;
  const reg = fshRegistrable(host);
  const today = new Date().toISOString().slice(0, 10);
  habitQueue = habitQueue.then(async () => {
    const { habits } = await chrome.storage.local.get({ habits: {} });
    const h = habits[reg] || { n: 0, last: "" };
    if (h.last === today) return; // un jour de visite compte une fois, pas une fois par page
    habits[reg] = { n: h.n + 1, last: today };
    const entries = Object.entries(habits);
    if (entries.length > MAX_HABITS) {
      entries.sort((a, b) => b[1].n - a[1].n || (b[1].last > a[1].last ? 1 : -1));
      await chrome.storage.local.set({ habits: Object.fromEntries(entries.slice(0, MAX_HABITS)) });
    } else {
      await chrome.storage.local.set({ habits });
    }
  });
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.url && !tab.incognito) recordHabit(tab.url);
});
