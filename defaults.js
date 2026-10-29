// Réglages par défaut et petits utilitaires, partagés par l'arrière-plan, content.js et les pages.
const FSH_DEFAULTS = {
  enabled: true,
  // "renforce" : écran et langues uniformisés. "prudent" : on ne touche pas à ces valeurs.
  level: "renforce",
  // Analyse des sites avant d'ouvrir un lien externe : "off", "dangerous" (alerte si dangereux)
  // ou "doubtful" (alerte si douteux ou dangereux).
  safetyMode: "doubtful",
  // Autorise les analyses en ligne (DNS filtrants, âge du domaine). Seul le nom de domaine est envoyé.
  safetyOnline: true,
  // Analyse complète (DNS, âge du domaine) de chaque page visitée, pour le score de l'icône.
  // Envoie le nom de domaine des pages visitées aux services d'analyse.
  safetyAuto: true,
  // Étiquette de fiabilité au survol de chaque lien externe.
  linkBadges: true,
  trusted: [],
  // Changement automatique d'identité (graine) : "never", "session" (à chaque démarrage du navigateur),
  // "daily" ou "weekly".
  seedRotation: "never",
  features: {
    canvas: true,
    webgl: true,
    audio: true,
    fonts: true,
    hardware: true,
    screen: true,
    rects: true,
    extra: true,
    webrtc: false,
    beacon: true,
    cleanUrls: true,
    cleanLinks: true,
    perms: true,
    popups: true,
    banners: true,
    gpc: true,
  },
  allowlist: [],
};

// Noms de domaine "enregistrables" (approximation sans la liste des suffixes publics).
function fshRegistrable(host) {
  const labels = host.split(".");
  if (labels.length <= 2 || /^[\d.]+$/.test(host) || host.includes(":")) return host;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const compound = tld.length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(second);
  return labels.slice(compound ? -3 : -2).join(".");
}

// Clé de brouillage propre à un site principal (32 caractères hexadécimaux, hachage cyrb128).
// La graine reste dans l'extension : la page n'en reçoit que cette clé dérivée, et encore, par un canal
// qu'elle ne peut pas écouter (voir content.js). Un même pisteur intégré dans deux sites différents
// reçoit donc deux clés différentes, ce qui l'empêche de relier les deux visites.
function fshSiteKey(seed, site) {
  const str = seed + "|" + site;
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

// En-tête Accept-Language aligné sur navigator.languages réduit (inject.js, niveau renforcé) : le serveur ne doit
// pas voir la liste complète que la page ne montre plus. Renvoie l'en-tête tel quel s'il est déjà réduit
// (une langue, ou une langue régionale et sa langue de base) ou s'il n'a pas le format attendu.
function fshAcceptLanguage(header) {
  if (typeof header !== "string") return header;
  const tags = header.split(",").map((t) => t.split(";")[0].trim());
  const first = tags[0];
  if (!/^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/.test(first)) return header;
  const base = first.split("-")[0];
  if (tags.length === 1 || (tags.length === 2 && tags[1].toLowerCase() === base.toLowerCase())) return header;
  return base === first ? first : `${first},${base};q=0.9`;
}

// Faut-il changer d'identité maintenant ? `startup` : le navigateur vient de démarrer.
function fshSeedDue(mode, seedAt, now, startup) {
  if (mode === "session") return !!startup;
  const days = mode === "daily" ? 1 : mode === "weekly" ? 7 : 0;
  return days > 0 && now - (seedAt || 0) >= days * 86400000;
}

// Score d'un site : on part de `base` (100 pour un site très connu, moins pour un inconnu) et on retire
// les pénalités. Un signal critique (liste de menaces, DNS filtrant) force un score très bas, et un signal
// à `cap` (identité invalide, imitation de marque...) plafonne le score quoi qu'il arrive.
//
// Les pénalités « souples » (`soft`) sont les signes d'un site récent : domaine jeune, enregistré un an,
// propriétaire masqué, absent des classements. Ils vont presque toujours ensemble et disent la même chose.
// On ne les additionne donc pas : leur total est plafonné (`softCap`, porté par l'âge du domaine, 24 sans
// âge connu). Et sans preuve plus solide qu'un site jeune (signal critique, plafond d'identité, pénalité
// forte et non souple), le verdict reste « douteux » : un petit jeu ou un blog tout neuf n'est pas dangereux.
function fshScore(findings, base) {
  let score = base;
  let soft = 0;
  let softCap = 0;
  for (const f of findings) {
    const p = f.penalty || 0;
    if (f.soft && p > 0) {
      soft += p;
      softCap = Math.max(softCap, f.softCap || 0);
    } else score -= p;
  }
  score -= Math.min(soft, softCap || 24);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const critical = findings.some((f) => f.critical);
  let proof = critical;
  for (const f of findings) {
    if (f.cap != null && f.status !== "ok" && f.status !== "info") {
      score = Math.min(score, f.cap);
      proof = true;
    }
    if (!f.soft && (f.penalty || 0) >= 15) proof = true;
  }
  if (critical) score = Math.min(score, 8);
  return { score, verdict: critical || (score < 45 && proof) ? "dangerous" : score < 75 ? "doubtful" : "safe" };
}

// Que propose une page ? `text` est son texte en minuscules, `cartElement` dit si un élément « panier » existe.
//  - "shop" : vocabulaire ou élément de panier (sites de vente classiques).
//  - "shop-light" : prix en vraie monnaie accompagnés de mots d'achat, sans panier (boutiques de jeux, packs,
//    abonnements). Le signal est plus faible, car une plateforme de vidéo ou un magazine affichent aussi des prix :
//    les contrôles sont allégés (voir content.js).
//  - "support" : une page de soutien (dons, mécénat, abonnement facultatif à Patreon, Ko-fi...). Elle affiche des
//    prix mais ne vend rien : on ne la juge pas comme une boutique.
//  - null : autre chose.
function fshPageKind(text, cartElement) {
  const cartWords = (text.match(/panier|add to cart|ajouter au panier|checkout|commander|basket/g) || []).length;
  if (cartWords >= 3 || cartElement) return "shop";
  const support = (text.match(/soutien|soutenir|\bdons?\b(?!['\u2019]t)|mécène|patreon|ko-fi|tipeee|utip|liberapay|helloasso|buy me a coffee|open collective/g) || []).length;
  if (support >= 2) return "support";
  const prices = (text.match(/\d+(?:[.,]\d{1,2})?\s?(?:€|eur\b|\$|usd\b|£)|(?:€|\$|£)\s?\d+/g) || []).length;
  const buy = (text.match(/\bacheter\b|\bachat\b|\bbuy\b|\bboutique\b|\bshop\b|\bstore\b|\bpaiement\b|\bpayer\b|\babonnement\b|\bsubscribe\b|\bpack\b/g) || []).length;
  return prices >= 2 && buy >= 2 ? "shop-light" : null;
}
const fshLooksLikeShop = (text, cartElement) => (fshPageKind(text, cartElement) || "").startsWith("shop");

// Résultat d'un site complété par ce qu'on a lu dans la page (`sig` : { shop, findings }). Un site très connu
// (base 100) n'a pas à prouver qu'il est une vraie boutique : seuls les mots de passe envoyés ailleurs comptent,
// et ni les contrôles de boutique ni la « boutique récente » ne s'appliquent. Sinon YouTube ou n'importe
// quel grand site qui affiche des prix tomberait à 40 pour des « mentions légales absentes ».
function fshWithPage(res, sig) {
  const wellKnown = res.base >= 100;
  const page = wellKnown ? sig.findings.filter((f) => /^Mot de passe/.test(f.label)) : sig.findings;
  const findings = [...res.findings, ...page];
  // Une boutique sur un domaine de moins d'un an : le profil classique des fausses boutiques.
  if (!wellKnown && sig.shop && res.ageDays !== null && res.ageDays < 365) {
    findings.push({
      group: "Contenu de la page", label: "Boutique récente", status: "bad", penalty: 25,
      detail: `Boutique en ligne sur un domaine de ${res.ageDays} jours : profil classique des fausses boutiques.`,
    });
  }
  return { ...res, findings, ...fshScore(findings, res.base), page: true };
}

// Ce qu'on affiche pour un résultat : une note sur 100 seulement quand l'analyse est assez complète.
// Réseau local : "LAN". Analyse incomplète (âge du domaine introuvable, hors ligne...) : "?".
const FSH_GRAY = "#6b7280";
function fshDisplay(res) {
  if (res.verdict === "local") return { kind: "local", text: "LAN", color: FSH_GRAY, label: "Réseau local" };
  if (res.verified === false && res.verdict !== "dangerous") return { kind: "unverified", text: "?", color: FSH_GRAY, label: "Non vérifié" };
  const color = { safe: "#16a34a", doubtful: "#d97706", dangerous: "#dc2626" }[res.verdict];
  const label = { safe: "Fiable", doubtful: "Douteux", dangerous: "Dangereux" }[res.verdict];
  return { kind: "score", text: String(res.score), value: res.score, color, label };
}

// Adresses du réseau local (jamais analysées ni envoyées sur Internet) : localhost, noms sans point,
// suffixes .home/.lan/.local..., adresses IP privées.
function fshIsLocal(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || (!h.includes(".") && !h.includes(":"))) return true;
  if (/\.(local|lan|home|internal|intranet|localdomain|corp|localhost|test|invalid|home\.arpa)$/.test(h)) return true;
  if (h.includes(":")) return h === "::1" || /^(fc|fd|fe80)/.test(h);
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = +m[1];
  const b = +m[2];
  return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

// Paramètres de suivi retirés des adresses (même liste que dans inject.js).
const FSH_TRACKING = /^(utm_[a-z0-9_]+|hsa_[a-z0-9_]+|mtm_[a-z0-9_]+|fbclid|gclid|gclsrc|gbraid|wbraid|dclid|gad_source|gad_campaignid|srsltid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|igsh|mc_eid|mc_cid|_hsenc|_hsmi|mkt_tok|vero_id|ocid|_gl|mibextid|pk_(campaign|kwd|source|medium|content)|wickedid|oly_anon_id|oly_enc_id|rb_clickid|s_cid|sc_cid|trkinfo|ef_id|s_kwcid|zanpid|ref_src|ref_url)$/i;
