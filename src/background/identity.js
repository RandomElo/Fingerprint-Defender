// Changement automatique d'identité : la graine est renouvelée selon le réglage « seedRotation ».
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

// Une identité par contexte : la même graine donnerait la même empreinte dans tous les conteneurs Firefox et dans toutes les
// fenêtres privées, ce qui permet de relier un compte « Travail » à un compte « Perso » sur le même site. Le contexte s'ajoute à
// la graine avant le calcul de la clé du site (content.js). L'onglet normal n'ajoute rien : ses clés restent celles d'avant.
// Les fenêtres privées reçoivent en plus un secret propre à la session du navigateur (storage.session, effacé à la fermeture),
// donc deux fenêtres privées successives n'ont pas la même empreinte.
async function identityContext(sender) {
  const tab = sender && sender.tab;
  if (!tab) return "";
  if (tab.incognito) {
    let { privSeed } = await chrome.storage.session.get("privSeed");
    if (!privSeed) {
      privSeed = randomSeed();
      await chrome.storage.session.set({ privSeed });
    }
    return `|p:${privSeed}:${tab.windowId}`;
  }
  if (tab.cookieStoreId && tab.cookieStoreId !== "firefox-default") return `|c:${tab.cookieStoreId}`;
  return "";
}
