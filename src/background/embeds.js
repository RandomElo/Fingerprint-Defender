// Vidéos, cartes et publications intégrées (YouTube, Maps, X, Instagram...) : chargées seulement au clic. Un cadre
// intégré prévient son fournisseur que tu visites la page, même si tu ne le regardes jamais. Le cadre est remplacé par
// une page de l'extension qui dit ce qu'il contiendrait et propose de le charger, une fois ou toujours sur ce site.

// Adresses que l'utilisateur vient d'autoriser d'un clic, pour une minute : la requête qui suit n'est pas remplacée de
// nouveau. Gardées dans la session du navigateur, car le script d'arrière-plan peut s'endormir entre deux.
async function allowEmbedOnce(url) {
  const { embedOnce } = await chrome.storage.session.get({ embedOnce: {} });
  const now = Date.now();
  for (const k of Object.keys(embedOnce)) if (embedOnce[k] < now) delete embedOnce[k];
  embedOnce[url] = now + 60000;
  await chrome.storage.session.set({ embedOnce });
  return true;
}

async function takeEmbedAllowance(url) {
  const { embedOnce } = await chrome.storage.session.get({ embedOnce: {} });
  if (!(embedOnce[url] > Date.now())) return false;
  delete embedOnce[url];
  await chrome.storage.session.set({ embedOnce });
  return true;
}

async function guardEmbeds(details) {
  if (details.type !== "sub_frame") return {};
  const embed = fshEmbedOf(details.url);
  if (!embed) return {};
  const s = await settings();
  if (!s.enabled || !s.features.embeds) return {};
  const top = topHostOf(details);
  // Sur le site du fournisseur lui-même, ou sur un site où tu as choisi de tout charger : rien à retenir.
  if (!top || fshRegistrable(top) === embed.site || isAllowed(s.allowlist, top) || isAllowed(s.embedAllow, top)) return {};
  if (await takeEmbedAllowance(details.url)) return {};
  countBlocked(details.tabId, "embeds", embed.name);
  return {
    redirectUrl: chrome.runtime.getURL("src/pages/embed/embed.html") + "?u=" + encodeURIComponent(details.url) + "&n=" + encodeURIComponent(embed.name),
  };
}

chrome.webRequest.onBeforeRequest.addListener(guardEmbeds, { urls: ["http://*/*", "https://*/*"], types: ["sub_frame"] }, ["blocking"]);
