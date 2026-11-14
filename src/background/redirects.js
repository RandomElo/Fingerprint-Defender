// Pages AMP de Google : on ouvre la vraie page du site, pas la copie hébergée par Google (cdn.ampproject.org ou
// google.com/amp), qui passe par ses serveurs et lui apprend ce que tu lis.
async function guardAmp(details) {
  if (details.type !== "main_frame") return {};
  const original = fshAmpOriginal(details.url);
  if (!original) return {};
  const s = await settings();
  if (!s.enabled || !s.features.amp) return {};
  return { redirectUrl: original };
}

chrome.webRequest.onBeforeRequest.addListener(guardAmp, { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] }, ["blocking"]);
