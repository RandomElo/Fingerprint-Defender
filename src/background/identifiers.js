// Tes identifiants envoyés à un tiers. Les régies publicitaires (Meta, Google...) demandent aux sites l'adresse mail ou le
// numéro de leurs visiteurs, hachés en SHA-256 : ce haché sert d'identifiant commun à tous les sites. On calcule ici
// les mêmes hachés pour les identifiants saisis dans les réglages, et on coupe toute requête vers un autre site qui les
// contient. L'adresse en clair n'est cherchée que dans l'adresse d'une requête de suivi (image, ping, script) : dans le
// corps d'un formulaire, elle peut être envoyée exprès par toi.
let hashNeedles = [];
let plainNeedles = [];

async function digestHex(algo, text) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function buildNeedles() {
  const { identifiers } = await chrome.storage.local.get({ identifiers: FSH_DEFAULTS.identifiers });
  const { emails, phones } = fshIdentifierVariants(identifiers);
  const hashes = [];
  for (const v of [...emails, ...phones]) hashes.push(await digestHex("SHA-256", v), await digestHex("SHA-1", v));
  hashNeedles = hashes;
  plainNeedles = emails.flatMap((e) => [e, encodeURIComponent(e).toLowerCase()]);
}
let needlesReady = buildNeedles();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.identifiers) needlesReady = buildNeedles();
});

// Requêtes qui servent à envoyer une information à un tiers sans que la page affiche rien.
const TRACKING_TYPES = new Set(["image", "imageset", "ping", "beacon", "script", "stylesheet", "other"]);

function bodyText(body) {
  if (!body) return "";
  let text = "";
  if (body.formData) text += " " + Object.values(body.formData).flat().join(" ");
  for (const part of body.raw || []) if (part.bytes) text += " " + new TextDecoder().decode(part.bytes);
  return text;
}

async function guardIdentifiers(details) {
  if (details.type === "main_frame" || (!hashNeedles.length && !plainNeedles.length)) return {};
  const s = await settings();
  if (!s.enabled || !s.features.identifiers) return {};
  const top = topHostOf(details);
  const host = fshPageHost(details.url);
  // Un envoi au site lui-même (connexion, formulaire) est normal : seuls les tiers nous intéressent.
  if (!top || !host || fshRegistrable(top) === fshRegistrable(host) || fshNeverBlock(host)) return {};
  if (isAllowed(s.allowlist, top) || isAllowed(s.identifiersAllow, top)) return {};

  const text = details.url + bodyText(details.requestBody);
  const found = fshFindIdentifier(text, hashNeedles) || (TRACKING_TYPES.has(details.type) && fshFindIdentifier(details.url, plainNeedles));
  if (!found) return {};
  countBlocked(details.tabId, "identifiers", fshRegistrable(host));
  return { cancel: true };
}

chrome.webRequest.onBeforeRequest.addListener(guardIdentifiers, { urls: ["http://*/*", "https://*/*"] }, ["blocking", "requestBody"]);
