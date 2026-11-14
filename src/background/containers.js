// Menu du clic droit sur un lien : « Ouvrir dans un conteneur jetable » et « Copier le lien propre ».
// Un conteneur jetable est un conteneur Firefox créé pour l'occasion : cookies et stockage séparés du reste. Il est supprimé,
// avec tout ce qu'il contient, quand son dernier onglet se ferme.
let disposableCount = 0;
const COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];

// Le conteneur d'un onglet, ou null : les conteneurs ne sont pas toujours activés (réglage `privacy.userContext.enabled`).
const containersAvailable = () => typeof browser !== "undefined" && !!browser.contextualIdentities;

async function openDisposable(url) {
  if (!/^https?:/.test(String(url))) return false;
  if (!containersAvailable()) {
    // Repli : une fenêtre privée, qui oublie tout à sa fermeture (si l'extension y est autorisée).
    // Sur Firefox Android il n'y a ni conteneurs ni fenêtres : un simple onglet.
    await (chrome.windows ? chrome.windows.create({ url, incognito: true }) : Promise.reject()).catch(() => chrome.tabs.create({ url }));
    return true;
  }
  const identity = await browser.contextualIdentities.create({ name: "Jetable " + ++disposableCount, color: COLORS[disposableCount % COLORS.length], icon: "circle" });
  await chrome.tabs.create({ url, cookieStoreId: identity.cookieStoreId });
  return true;
}

// Supprime les conteneurs jetables qui n'ont plus d'onglet.
async function sweepDisposables() {
  if (!containersAvailable()) return;
  const tabs = await chrome.tabs.query({});
  const used = new Set(tabs.map((t) => t.cookieStoreId));
  for (const c of await browser.contextualIdentities.query({})) {
    if (/^Jetable \d+$/.test(c.name) && !used.has(c.cookieStoreId)) await browser.contextualIdentities.remove(c.cookieStoreId).catch(() => {});
  }
}
chrome.tabs.onRemoved.addListener(() => setTimeout(() => sweepDisposables().catch(() => {}), 800));
chrome.runtime.onStartup.addListener(() => sweepDisposables().catch(() => {}));

// Le presse-papiers s'écrit depuis la page d'arrière-plan de l'extension (permission clipboardWrite), sans geste de l'utilisateur.
async function copyCleanLink(url) {
  const clean = fshCleanUrl(String(url));
  await navigator.clipboard.writeText(clean);
  return clean;
}

// Firefox Android n'a pas de menu contextuel pour les extensions : ces deux actions n'y existent pas.
if (chrome.contextMenus) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "fsh-disposable", title: "Ouvrir dans un conteneur jetable", contexts: ["link"] });
    chrome.contextMenus.create({ id: "fsh-clean-link", title: "Copier le lien propre", contexts: ["link"] });
  });
  chrome.contextMenus.onClicked.addListener(async (info) => {
    const s = await settings();
    if (!s.enabled || !s.features.disposable || !info.linkUrl) return;
    if (info.menuItemId === "fsh-disposable") openDisposable(info.linkUrl).catch(() => {});
    if (info.menuItemId === "fsh-clean-link") copyCleanLink(info.linkUrl).catch(() => {});
  });
}
