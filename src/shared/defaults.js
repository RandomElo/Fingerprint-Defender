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
  // Sites autorisés à contacter ton réseau local (exception en un clic dans le popup).
  localnetAllow: [],
  // Sites où les pisteurs appris ne sont pas bloqués, et sites autorisés à recevoir tes identifiants.
  trackerAllow: [],
  identifiersAllow: [],
  // Tes adresses et numéros, pour repérer quand un site les envoie à un tiers (hachés ou en clair). Ils restent sur cet appareil.
  identifiers: { emails: [], phones: [] },
  // Sites où les vidéos, cartes et publications intégrées se chargent sans demander.
  embedAllow: [],
  // Nettoyage : à la fermeture du dernier onglet d'un site, ses cookies et son stockage sont effacés (désactivé : on serait
  // déconnecté de tout). `cleanKeep` : les sites où l'on reste connecté.
  cleanOnClose: false,
  cleanKeep: [],
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
    referer: true, // Referer réduit à l'origine pour les requêtes vers un autre site
    localnet: true, // une page publique ne peut pas joindre le réseau local
    webrtcRelay: false, // WebRTC en relais seulement : cache l'IP publique mais coupe souvent les appels
    trackers: true, // pisteurs repérés par leur comportement sur plusieurs sites : bloqués ensuite
    identifiers: true, // tes identifiants envoyés à un tiers : coupés
    consent: true, // refuser automatiquement les bandeaux de cookies
    embeds: true, // vidéos, cartes et publications intégrées : chargées au clic
    amp: true, // ouvrir la vraie page à la place d'une page AMP de Google
    scams: true, // commandes piégées copiées par une page, adresses remplacées au moment de copier
    payment: true, // prestataire de paiement : vérifié quand tu saisis ta carte
    typo: true, // un site qui ressemble à un site que tu visites souvent : arrêté avant son chargement
    downloads: true, // exécutables et fichiers à double extension : arrêtés avant d'être enregistrés
    tls: true, // certificat : détails dans le popup, certificat tout neuf, interception d'un site habituel
    disposable: true, // menu du clic droit : conteneur jetable, copie du lien propre
    cleanCopy: true, // retirer le lien de suivi ajouté à un texte copié
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

// Domaines qu'on ne bloque jamais, ni par apprentissage ni pour tes identifiants : sans eux, un paiement, une banque, un
// captcha ou Google Meet et Agenda cessent de marcher. Les prestataires anti-fraude y sont : ils lisent l'empreinte
// comme un pisteur, mais les banques et les paiements les exigent. Et les grands hébergeurs partagés : bloquer
// « cloudfront.net » parce qu'un script y est hébergé couperait la moitié du web.
const FSH_NEVER_BLOCK = [
  // Google : Meet, Agenda, Drive, YouTube
  "google.com", "gstatic.com", "googleapis.com", "googleusercontent.com", "googlevideo.com", "youtube.com", "ytimg.com", "gvt1.com", "gvt2.com",
  // paiement et authentification forte (3-D Secure)
  "stripe.com", "stripe.network", "stripecdn.com", "paypal.com", "paypalobjects.com", "adyen.com", "checkout.com", "braintreegateway.com",
  "braintree-api.com", "worldpay.com", "klarna.com", "cardinalcommerce.com", "3dsecure.io", "mollie.com", "payplug.com", "sumup.com",
  "mastercard.com", "visa.com", "americanexpress.com", "lemonway.com",
  // captchas et défis anti-robots
  "cloudflare.com", "hcaptcha.com", "recaptcha.net", "arkoselabs.com", "funcaptcha.com", "geetest.com", "captcha-delivery.com", "datadome.co",
  "perimeterx.net", "px-cloud.net",
  // anti-fraude (exigés par les banques et les paiements)
  "threatmetrix.com", "online-metrix.net", "lexisnexis.com", "iovation.com", "sift.com", "siftscience.com", "forter.com", "riskified.com",
  "signifyd.com", "kount.com", "fpjs.io", "fpcdn.io", "fingerprint.com",
  // hébergeurs et réseaux de diffusion partagés
  "cloudfront.net", "amazonaws.com", "azureedge.net", "akamaihd.net", "akamaized.net", "akamai.net", "fastly.net", "cloudflare.net",
  "jsdelivr.net", "unpkg.com", "github.io", "githubusercontent.com", "herokuapp.com", "netlify.app", "vercel.app", "pages.dev", "workers.dev",
  "appspot.com", "firebaseapp.com", "web.app", "blob.core.windows.net", "wp.com", "wordpress.com",
];
const fshNeverBlock = (host) => FSH_NEVER_BLOCK.some((d) => host === d || host.endsWith("." + d));

// Pisteurs appris : un script classé « pisteur probable » (voir inject.js) sur au moins `minSites` sites différents. Un
// même script qui lit l'empreinte sur plusieurs sites sans rapport est un pisteur, pas une fonctionnalité de l'un d'eux.
// `stats.pisteurs[domaine].p` garde les cinq dernières pages où il a été vu.
function fshLearnedTrackers(stats, minSites = 3) {
  const learned = new Set();
  for (const [src, info] of Object.entries((stats && stats.pisteurs) || {})) {
    const sites = new Set(((info && info.p) || []).map((h) => fshRegistrable(String(h))));
    if (sites.size >= minSites && !fshNeverBlock(src)) learned.add(src);
  }
  return learned;
}

// Cette requête est-elle celle d'un pisteur appris, depuis une page d'un autre site ? `allow` : sites où l'utilisateur
// a choisi de ne pas bloquer.
function fshTrackerBlocked(learned, topHost, host, allow = []) {
  if (!topHost || !host) return false;
  const site = fshRegistrable(host);
  if (site === fshRegistrable(topHost) || !learned.has(site) || fshNeverBlock(host)) return false;
  return !allow.some((d) => topHost === d || topHost.endsWith("." + d));
}

// Écritures à chercher pour tes identifiants : adresse en minuscules ; numéro en chiffres seuls, avec le 0 ou l'indicatif
// 33 (France), car les régies le normalisent ainsi avant de le hacher.
function fshIdentifierVariants(identifiers) {
  const emails = new Set();
  const phones = new Set();
  for (const e of (identifiers && identifiers.emails) || []) {
    const v = String(e).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) emails.add(v);
  }
  for (const t of (identifiers && identifiers.phones) || []) {
    const d = String(t).replace(/\D/g, "");
    if (d.length < 8) continue;
    phones.add(d);
    if (d.startsWith("0")) phones.add("33" + d.slice(1));
    else if (d.startsWith("33")) phones.add("0" + d.slice(2));
  }
  return { emails: [...emails], phones: [...phones] };
}

// La première des `needles` (en minuscules) présente dans `text`, ou null.
function fshFindIdentifier(text, needles) {
  const t = String(text).toLowerCase();
  return needles.find((n) => n && t.includes(n)) || null;
}

// Paramètres de suivi propres à un site : sans danger là, mais trop courants ailleurs sous le même nom pour entrer dans
// la liste globale (« s », « t » ou « sr » veulent dire autre chose presque partout). [hôte, chemin ou null, paramètres,
// segment de chemin à retirer ou null].
const FSH_SITE_RULES = [
  [/(^|\.)amazon\.[a-z.]+$/, null, /^(pd_rd_[a-z]+|pf_rd_[a-z]+|qid|sr|linkcode|linkid|content-id|_encoding|crid|sprefix|dib|dib_tag)$/i, /\/ref=[^/?#]*/],
  [/(^|\.)google\.[a-z.]+$/, /^\/(search|webhp)?$/, /^(ved|ei|sca_esv|sxsrf|gs_lcp|gs_lp|gs_ssp|sclient|uact|oq|aqs|rlz|iflsig|bih|biw|dpr)$/i, null],
  [/(^|\.)(youtube\.com|youtu\.be)$/, null, /^(si|feature|pp|ab_channel)$/i, null],
  [/(^|\.)spotify\.com$|^spotify\.link$/, null, /^(si|nd|dlsi)$/i, null],
  [/(^|\.)linkedin\.com$/, null, /^(trackingid|refid|trk|trkemail|lipi|midtoken|midsig|eid|otptoken|originalsubdomain)$/i, null],
  [/^(www\.|mobile\.)?(twitter|x)\.com$/, /\/status\//, /^(s|t|ref_src|ref_url)$/i, null],
  [/(^|\.)facebook\.com$/, null, /^(__cft__.*|__tn__|fref|refsrc|hc_ref|eav|paipv|comment_tracking|notif_id|notif_t)$/i, null],
  [/(^|\.)aliexpress\.[a-z.]+$/, null, /^(spm|scm|scm_id|scm-url|pvid|algo_pvid|algo_exp_id|aff_[a-z_]+|gps-id|ws_ab_test|btsid|sk|terminal_id)$/i, null],
  [/(^|\.)reddit\.com$/, null, /^(\$deep_link|correlation_id|ref_campaign|ref_source|share_id|rdt|rdt_cid)$/i, null],
  [/(^|\.)tiktok\.com$/, null, /^(_r|_t|is_from_webapp|sender_device|web_id|share_app_id|share_link_id|social_sharing|u_code|tt_from)$/i, null],
];

// Adresse nettoyée : paramètres de suivi de la liste globale, puis règles du site. Renvoie l'adresse reçue si rien ne change.
// forEach plutôt qu'un spread : sous Firefox, les itérateurs de URLSearchParams ne sont pas utilisables depuis un script de contenu.
function fshCleanUrl(href) {
  let u;
  try {
    u = new URL(href);
  } catch (_) {
    return href;
  }
  if (!/^https?:$/.test(u.protocol)) return href;
  const drop = [];
  u.searchParams.forEach((_, k) => {
    if (FSH_TRACKING.test(k)) drop.push(k);
  });
  for (const [hostRe, pathRe, params, segment] of FSH_SITE_RULES) {
    if (!hostRe.test(u.hostname) || (pathRe && !pathRe.test(u.pathname))) continue;
    u.searchParams.forEach((_, k) => {
      if (params.test(k)) drop.push(k);
    });
    if (segment) u.pathname = u.pathname.replace(segment, "");
  }
  drop.forEach((k) => u.searchParams.delete(k));
  return u.href === href ? href : u.href;
}

// Contenus intégrés qu'on ne charge qu'au clic : ils préviennent leur fournisseur que tu visites la page, même sans les
// regarder. `site` : le domaine du fournisseur (sur son propre site, il n'y a rien à retenir).
const FSH_EMBEDS = [
  { name: "YouTube", site: "youtube.com", host: /^(www\.)?youtube(-nocookie)?\.com$/, path: /^\/embed\// },
  { name: "Vimeo", site: "vimeo.com", host: /^player\.vimeo\.com$/, path: /^\/video\// },
  { name: "X (Twitter)", site: "twitter.com", host: /^platform\.(twitter|x)\.com$/, path: /^\/(embed|widgets)\// },
  { name: "Instagram", site: "instagram.com", host: /^(www\.)?instagram\.com$/, path: /\/embed/ },
  { name: "Facebook", site: "facebook.com", host: /^(www\.)?facebook\.com$/, path: /^\/(v\d+\.\d+\/)?plugins\// },
  { name: "Google Maps", site: "google.com", host: /^(www\.)?google\.[a-z.]+$/, path: /^\/maps\/embed/ },
  { name: "Spotify", site: "spotify.com", host: /^open\.spotify\.com$/, path: /^\/embed/ },
  { name: "Twitch", site: "twitch.tv", host: /^player\.twitch\.tv$/, path: /./ },
  { name: "Dailymotion", site: "dailymotion.com", host: /^(www\.|geo\.)?dailymotion\.com$/, path: /^\/(embed|player)/ },
  { name: "SoundCloud", site: "soundcloud.com", host: /^w\.soundcloud\.com$/, path: /^\/player/ },
  { name: "TikTok", site: "tiktok.com", host: /^(www\.)?tiktok\.com$/, path: /^\/embed/ },
];

// Le contenu intégré désigné par cette adresse de cadre, ou null.
function fshEmbedOf(href) {
  try {
    const u = new URL(href);
    if (!/^https?:$/.test(u.protocol)) return null;
    return FSH_EMBEDS.find((e) => e.host.test(u.hostname.toLowerCase()) && e.path.test(u.pathname)) || null;
  } catch (_) {
    return null;
  }
}

// Adresse à charger quand on clique : YouTube passe par youtube-nocookie.com, sa version qui ne pose pas de cookie
// avant la lecture.
function fshEmbedLoadUrl(href) {
  try {
    const u = new URL(href);
    if (/^(www\.)?youtube\.com$/.test(u.hostname)) u.hostname = "www.youtube-nocookie.com";
    return u.href;
  } catch (_) {
    return href;
  }
}

// La vraie page derrière une page AMP de Google (cache cdn.ampproject.org ou google.com/amp), ou null. Les paramètres
// ajoutés par le cache AMP (amp_js_v, usqp...) sont retirés.
function fshAmpOriginal(href) {
  let u;
  let m;
  try {
    u = new URL(href);
  } catch (_) {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)cdn\.ampproject\.org$/.test(host)) m = u.pathname.match(/^\/[cvi]i?\/(s\/)?(.+)$/);
  else if (/^(www\.)?google\.[a-z.]+$/.test(host)) m = u.pathname.match(/^\/amp\/(s\/)?(.+)$/);
  if (!m || !/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(m[2])) return null;
  const out = new URL((m[1] ? "https://" : "http://") + m[2]);
  u.searchParams.forEach((v, k) => {
    if (!/^(amp_|usqp$|ampshare$|amp$)/i.test(k)) out.searchParams.append(k, v);
  });
  return out.href;
}

// Prestataires de paiement connus : quand tu saisis ta carte chez eux, on ne s'inquiète pas. Tout autre destinataire de la
// carte passe par l'analyse de réputation des sites. La correspondance est stricte (le domaine du prestataire ou un de ses
// sous-domaines) : « stripe.com.pirate.net » n'est pas Stripe.
const FSH_PAYMENT_PROVIDERS = [
  ["Stripe", ["stripe.com", "stripe.network"]],
  ["PayPal", ["paypal.com", "paypalobjects.com", "paypal.me"]],
  ["Adyen", ["adyen.com", "adyenpayments.com"]],
  ["Checkout.com", ["checkout.com"]],
  ["Mollie", ["mollie.com"]],
  ["Braintree", ["braintreegateway.com", "braintree-api.com"]],
  ["Klarna", ["klarna.com"]],
  ["Worldpay", ["worldpay.com"]],
  ["PayPlug", ["payplug.com"]],
  ["SumUp", ["sumup.com"]],
  ["Square", ["squareup.com", "square.site"]],
  ["Alma", ["getalma.eu", "almapay.com"]],
  ["Oney", ["oney.fr", "oney.com"]],
  ["Lyra / PayZen", ["lyra.com", "payzen.eu", "lyra-network.com"]],
  ["Mangopay", ["mangopay.com"]],
  ["HiPay", ["hipay.com", "hipay-tpp.com"]],
  ["Apple Pay", ["apple.com"]],
  ["Google Pay", ["pay.google.com"]],
];

// Le nom du prestataire de paiement connu qui possède `host`, ou null.
function fshPaymentProvider(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  for (const [name, domains] of FSH_PAYMENT_PROVIDERS) if (domains.some((d) => h === d || h.endsWith("." + d))) return name;
  return null;
}

// --- faute de frappe sur un site habituel -------------------------------------------------------------------------
// L'extension retient en local, par jour de visite, les sites où tu vas souvent. Avant d'ouvrir une adresse qui s'écrit presque
// comme l'un d'eux (paypa1.com pour paypal.com), elle te le dit. C'est plus fiable qu'une liste de marques : c'est ta liste.

// Extensions de fin de nom de domaine très utilisées pour les arnaques.
const FSH_RISKY_TLDS = ["xyz", "top", "shop", "click", "icu", "cyou", "buzz", "monster", "cfd", "sbs", "rest", "work", "live", "site", "online", "club", "vip", "link", "support", "help", "zip", "mov"];

// Vrai si `a` et `b` diffèrent d'une seule lettre (ajoutée, retirée ou changée).
function fshWithinOne(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

// Le site habituel que `host` imite, ou null. `habits` : { domaine: { n: nombre de jours de visite } }. Un site déjà visité
// plusieurs jours n'est jamais signalé, et les noms trop courts (moins de cinq lettres) sont ignorés : trop de faux positifs.
function fshLooksLikeHabit(host, habits, minDays = 4) {
  const reg = fshRegistrable(String(host || "").toLowerCase());
  if (!reg || !reg.includes(".") || (habits[reg] && habits[reg].n >= 2)) return null;
  const [label, ...rest] = reg.split(".");
  const tld = rest.join(".");
  const fold = (s) => s.replace(/vv/g, "w").replace(/rn/g, "m").replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/5/g, "s");
  for (const [habit, info] of Object.entries(habits)) {
    if (!info || info.n < minDays || habit === reg) continue;
    const [hl, ...hrest] = habit.split(".");
    if (hl.length < 5) continue;
    if (label !== hl && fold(label) === fold(hl)) return habit; // 0 pour o, 1 pour l, rn pour m
    if (label !== hl && Math.min(label.length, hl.length) >= 6 && fshWithinOne(label, hl)) return habit; // une lettre de différence
    if (label === hl && tld !== hrest.join(".") && FSH_RISKY_TLDS.includes(tld.split(".").pop())) return habit; // paypal.xyz
    if (label !== hl && (label.startsWith(hl + "-") || label.endsWith("-" + hl))) return habit; // mabanque-secure, secure-mabanque
  }
  return null;
}

// --- téléchargements ----------------------------------------------------------------------------------------------
const FSH_RISKY_FILE = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|vbs|vbe|jse|wsf|wsh|hta|lnk|jar|reg|cpl|msp)$/i;
const FSH_DOC_FILE = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|odt|jpe?g|png|gif|zip|rar|7z|mp3|mp4|csv)$/i;

// "double" : un nom de document suivi d'une extension exécutable (facture.pdf.exe), toujours une ruse. "executable" :
// un programme ou un script, à juger selon la réputation du site d'où il vient. null : rien à dire.
function fshDownloadRisk(filename) {
  const name = String(filename || "").split(/[\\/]/).pop().trim();
  if (!FSH_RISKY_FILE.test(name)) return null;
  return FSH_DOC_FILE.test(name.replace(FSH_RISKY_FILE, "")) ? "double" : "executable";
}

// --- certificats --------------------------------------------------------------------------------------------------
// Firefox est le seul navigateur qui laisse une extension lire les détails d'une connexion chiffrée.

// L'organisation qui a délivré un certificat, d'après son nom distinctif ("CN=R3, O=Let's Encrypt, C=US"), ou son nom commun.
function fshCertIssuer(dn) {
  const s = String(dn || "");
  const m = s.match(/(?:^|,\s*)O=("([^"]+)"|[^,]+)/i) || s.match(/(?:^|,\s*)CN=("([^"]+)"|[^,]+)/i);
  return m ? (m[2] || m[1]).trim() : "";
}

// Un site dont le certificat venait d'une autorité reconnue par Firefox (au moins deux visites) et dont le certificat actuel
// n'en vient plus : la connexion est interceptée (Wi-Fi public, proxy d'entreprise, antivirus, ou attaque).
function fshRootChange(previous, builtInNow) {
  return !!previous && previous.builtIn === true && previous.n >= 2 && builtInNow === false;
}

// --- fausse fenêtre de connexion ("browser in the browser") et onglet qui se déguise ---------------------------------
// Une page dessine une fausse fenêtre de navigateur avec une « barre d'adresse » en texte qui affiche l'adresse d'un vrai service
// de connexion, et un champ mot de passe : la vraie fenêtre n'a pas de barre d'adresse en texte dans la page.
const FSH_LOGIN_URL =
  /^https?:\/\/(?:accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|id\.apple\.com|www\.facebook\.com\/(?:login|dialog)|github\.com\/login|signin\.aws\.amazon\.com|www\.paypal\.com\/signin|login\.yahoo\.com|auth\.openai\.com|discord\.com\/login|steamcommunity\.com\/openid)(?:[/?#]\S*)?$/i;

// L'hôte du service de connexion que `text` affiche en entier comme une adresse, si la page n'est pas ce service ; sinon null.
function fshFakeLoginUrl(text, pageHost) {
  const t = String(text || "").trim();
  if (t.length > 140 || !FSH_LOGIN_URL.test(t)) return null;
  try {
    const shown = new URL(t).hostname;
    return fshRegistrable(shown) === fshRegistrable(String(pageHost || "")) ? null : shown;
  } catch (_) {
    return null;
  }
}

// Titre d'une page de connexion.
const FSH_LOGIN_TITLE = /(connexion|se connecter|identifiez|identification|sign[ -]?in|log[ -]?in|login|mot de passe|password|session expir)/i;

// Un onglet laissé en arrière-plan a changé d'apparence pour imiter une connexion : il ne parlait pas de connexion avant et
// il en parle maintenant (titre), ou un champ mot de passe est apparu.
function fshTabDisguised(before, now) {
  const titleNow = FSH_LOGIN_TITLE.test(now.title) && !FSH_LOGIN_TITLE.test(before.title);
  const passwordNow = now.hasPassword && !before.hasPassword;
  return (titleNow || passwordNow) && (now.title !== before.title || now.icon !== before.icon || passwordNow);
}

// --- nettoyage -----------------------------------------------------------------------------------------------------
// Faut-il effacer les données du site `host` maintenant ? Pas pour une adresse locale (un serveur de développement garde son
// stockage), pas pour un site de la liste de ceux où l'on reste connecté, pas tant qu'un autre onglet est ouvert sur ce site.
function fshShouldCleanSite(host, keep, openHosts) {
  const h = String(host || "").toLowerCase();
  if (!h || fshIsLocal(h)) return false;
  const reg = fshRegistrable(h);
  if ((keep || []).some((d) => h === d || h.endsWith("." + d) || reg === d)) return false;
  return !(openHosts || []).some((o) => fshRegistrable(String(o || "").toLowerCase()) === reg);
}

// --- vie privée d'une page, bilan, export ------------------------------------------------------------------------------
// Note de vie privée d'une page : la fiabilité dit si le site est honnête, celle-ci dit ce qu'il fait de toi. Chaque tiers
// contacté au-delà de trois, chaque pisteur d'empreinte, tes identifiants qu'il a tenté d'envoyer et ce qu'on a dû bloquer la baissent.
function fshPrivacy({ third = 0, flagged = 0, identifiers = 0, blocked = 0 } = {}) {
  let score = 100;
  score -= Math.min(40, Math.max(0, third - 3) * 3);
  score -= Math.min(30, flagged * 15);
  score -= Math.min(20, identifiers * 20);
  score -= Math.min(10, blocked);
  score = Math.max(0, Math.round(score));
  return { score, label: score >= 80 ? "discret" : score >= 55 ? "bavard" : "envahissant" };
}

// Les tiers présents sur le plus de sites. `graph` : { site: [domaines tiers] }.
function fshTopThirdParties(graph, limit = 15) {
  const sites = {};
  for (const [site, list] of Object.entries(graph || {})) for (const d of list) (sites[d] = sites[d] || new Set()).add(site);
  return Object.entries(sites)
    .map(([domain, set]) => ({ domain, sites: set.size }))
    .sort((a, b) => b.sites - a.sites || a.domain.localeCompare(b.domain))
    .slice(0, limit);
}

// Les sites qui contactent le plus de tiers.
function fshChattiestSites(graph, limit = 5) {
  return Object.entries(graph || {})
    .map(([site, list]) => ({ site, third: list.length }))
    .sort((a, b) => b.third - a.third || a.site.localeCompare(b.site))
    .slice(0, limit);
}

// Somme des `days` derniers jours d'un compteur { "2026-10-31": { trackers: 3, ... } }.
function fshWeekTotals(daily, now = Date.now(), days = 7) {
  const totals = {};
  for (let i = 0; i < days; i++) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    for (const [kind, n] of Object.entries((daily || {})[day] || {})) totals[kind] = (totals[kind] || 0) + n;
  }
  return totals;
}

// Export et import des réglages : seulement ce qui est un réglage ou une liste de sites. Jamais la graine (ce serait ton
// identité), ni tes identifiants, ni l'historique des sites habituels, ni les statistiques.
const FSH_EXPORT_KEYS = ["enabled", "level", "safetyMode", "safetyOnline", "safetyAuto", "linkBadges", "trusted", "allowlist", "localnetAllow", "trackerAllow", "identifiersAllow", "embedAllow", "cleanOnClose", "cleanKeep", "seedRotation"];

function fshExportSettings(stored) {
  const settings = {};
  for (const k of FSH_EXPORT_KEYS) if (stored[k] !== undefined) settings[k] = stored[k];
  settings.features = { ...FSH_DEFAULTS.features, ...(stored.features || {}) };
  return { app: "fingerprint-shield", version: 1, settings };
}

// Lit un export : { ok, values, rejected }. Tout ce qui est inconnu ou du mauvais type est refusé, jamais appliqué.
function fshImportSettings(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    return { ok: false, values: {}, rejected: ["fichier illisible"] };
  }
  if (!data || data.app !== "fingerprint-shield" || typeof data.settings !== "object" || !data.settings) return { ok: false, values: {}, rejected: ["ce n'est pas un export de Fingerprint Shield"] };
  const values = {};
  const rejected = [];
  const strings = (a) => Array.isArray(a) && a.length <= 500 && a.every((x) => typeof x === "string" && x.length > 0 && x.length < 120);
  for (const [k, v] of Object.entries(data.settings)) {
    if (k === "features") {
      if (v && typeof v === "object") {
        const f = {};
        for (const [name, on] of Object.entries(v)) {
          if (name in FSH_DEFAULTS.features && typeof on === "boolean") f[name] = on;
          else rejected.push("features." + name);
        }
        values.features = f;
      } else rejected.push(k);
    } else if (!FSH_EXPORT_KEYS.includes(k)) rejected.push(k);
    else if (Array.isArray(FSH_DEFAULTS[k])) strings(v) ? (values[k] = v) : rejected.push(k);
    else if (typeof v === typeof FSH_DEFAULTS[k] && (typeof v !== "string" || v.length < 40)) values[k] = v;
    else rejected.push(k);
  }
  return { ok: true, values, rejected };
}

// Hôte d'une adresse. Pour blob: et data: (scripts de workers), on prend l'origine qui les a créés :
// "blob:http://a.example/x" donne "a.example". Chaîne vide si inconnu ou si ce n'est pas une page web.
function fshPageHost(u) {
  try {
    const x = new URL(u);
    const o = x.origin !== "null" ? new URL(x.origin) : x;
    return /^(https?|wss?):$/.test(o.protocol) ? o.hostname : "";
  } catch (_) {
    return "";
  }
}

// Noms publics qui désignent la machine ou le réseau local : services de test (localtest.me), et adresses
// privées écrites dans le nom (192.168.1.10.nip.io), qu'on utilise pour contourner un filtre sur les adresses (rebinding DNS).
const FSH_LOCAL_NAMES = /(^|\.)(localtest\.me|lvh\.me|vcap\.me|lacolhost\.com|localhost\.localdomain)$/i;
function fshLocalName(host) {
  const h = String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (!h) return false;
  if (fshIsLocal(h) || FSH_LOCAL_NAMES.test(h)) return true;
  const m = h.match(/(?:^|\.)((?:\d{1,3}[.-]){3}\d{1,3})\.(?:nip\.io|sslip\.io|xip\.io)$/);
  return !!m && fshIsLocal(m[1].replace(/-/g, "."));
}

// Services connus qui parlent à une application installée sur la machine pour de bonnes raisons (lancer un appel,
// synchroniser un coffre de mots de passe...). Ils passent sans exception à créer.
const FSH_LOCAL_OK = ["zoom.us", "spotify.com", "discord.com", "jetbrains.com", "battle.net", "blizzard.com", "steampowered.com", "1password.com", "bitwarden.com", "logitech.com"];

// Une page d'Internet n'a aucune raison de joindre ton routeur, ton imprimante ou un service de ta machine : c'est
// ainsi que des sites sondent les ports ouverts ou attaquent l'interface d'une box. Un appareil local qui parle à un
// autre, lui, est normal. `allow` : les exceptions de l'utilisateur.
function fshLocalAccessBlocked(fromHost, toHost, allow = []) {
  if (!fromHost || !toHost || fshLocalName(fromHost) || !fshLocalName(toHost)) return false;
  const site = fshRegistrable(fromHost);
  return ![...FSH_LOCAL_OK, ...allow].some((d) => site === d || fromHost === d || fromHost.endsWith("." + d));
}

// Referer réduit à l'origine pour une requête vers un autre site : le chemin et les paramètres de la page
// (recherche, identifiant de commande, jeton...) ne partent pas chez un tiers, quelle que soit la politique du site.
function fshTrimReferer(referer, requestUrl) {
  try {
    const r = new URL(referer);
    const u = new URL(requestUrl);
    if (!/^https?:$/.test(r.protocol) || fshRegistrable(r.hostname) === fshRegistrable(u.hostname)) return referer;
    return r.origin + "/";
  } catch (_) {
    return referer;
  }
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
  // Certificat émis il y a quelques jours sur un domaine de quelques semaines : une arnaque qui vient d'être montée.
  if (!wellKnown && sig.tls && sig.tls.validFrom && res.ageDays !== null && res.ageDays < 90) {
    const days = Math.floor((Date.now() - sig.tls.validFrom) / 86400000);
    if (days < 3) {
      findings.push({
        group: "Connexion", label: "Certificat tout neuf", status: "warn", penalty: 12,
        detail: `Le certificat a été émis il y a ${Math.max(days, 0)} jour(s) sur un domaine de ${res.ageDays} jours : c'est le profil d'un site monté pour une arnaque.`,
      });
    }
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

// Fuseau horaire et pays de sortie. Le fuseau n'est pas modifié (un agenda a besoin du bon), mais un VPN qui sort dans un autre
// pays que celui du fuseau est un signal que les sites recoupent. Les pays voisins sont normaux : on signale seulement quand le pays
// de sortie ne figure pas parmi ceux du fuseau. Table volontairement courte : un fuseau inconnu donne « inconnu », jamais un faux avertissement.
const FSH_TZ_COUNTRIES = {
  "Europe/Paris": ["FR", "MC"], "Europe/London": ["GB", "GG", "JE", "IM"], "Europe/Berlin": ["DE"], "Europe/Madrid": ["ES", "AD"], "Europe/Rome": ["IT", "VA", "SM"],
  "Europe/Amsterdam": ["NL"], "Europe/Brussels": ["BE"], "Europe/Zurich": ["CH", "LI"], "Europe/Vienna": ["AT"], "Europe/Stockholm": ["SE"], "Europe/Oslo": ["NO"],
  "Europe/Copenhagen": ["DK"], "Europe/Helsinki": ["FI"], "Europe/Warsaw": ["PL"], "Europe/Prague": ["CZ"], "Europe/Lisbon": ["PT"], "Europe/Dublin": ["IE"],
  "Europe/Athens": ["GR"], "Europe/Budapest": ["HU"], "Europe/Bucharest": ["RO"], "Europe/Sofia": ["BG"], "Europe/Kyiv": ["UA"], "Europe/Kiev": ["UA"],
  "Europe/Moscow": ["RU"], "Europe/Istanbul": ["TR"], "Europe/Luxembourg": ["LU"], "Europe/Zagreb": ["HR"], "Europe/Belgrade": ["RS"], "Europe/Bratislava": ["SK"],
  "Europe/Ljubljana": ["SI"], "Europe/Vilnius": ["LT"], "Europe/Riga": ["LV"], "Europe/Tallinn": ["EE"], "Atlantic/Reykjavik": ["IS"],
  "America/New_York": ["US"], "America/Chicago": ["US"], "America/Denver": ["US"], "America/Los_Angeles": ["US"], "America/Phoenix": ["US"], "America/Anchorage": ["US"],
  "America/Toronto": ["CA"], "America/Vancouver": ["CA"], "America/Montreal": ["CA"], "America/Edmonton": ["CA"], "America/Halifax": ["CA"],
  "America/Mexico_City": ["MX"], "America/Sao_Paulo": ["BR"], "America/Argentina/Buenos_Aires": ["AR"], "America/Bogota": ["CO"], "America/Lima": ["PE"], "America/Santiago": ["CL"],
  "Asia/Tokyo": ["JP"], "Asia/Seoul": ["KR"], "Asia/Shanghai": ["CN"], "Asia/Hong_Kong": ["HK"], "Asia/Singapore": ["SG"], "Asia/Kolkata": ["IN"], "Asia/Calcutta": ["IN"],
  "Asia/Dubai": ["AE", "OM"], "Asia/Jerusalem": ["IL"], "Asia/Bangkok": ["TH", "VN", "KH", "LA"], "Asia/Jakarta": ["ID"], "Asia/Manila": ["PH"], "Asia/Karachi": ["PK"], "Asia/Tehran": ["IR"],
  "Asia/Taipei": ["TW"], "Asia/Riyadh": ["SA", "KW", "YE"], "Asia/Kuala_Lumpur": ["MY"], "Asia/Ho_Chi_Minh": ["VN"],
  "Australia/Sydney": ["AU"], "Australia/Melbourne": ["AU"], "Australia/Perth": ["AU"], "Australia/Brisbane": ["AU"], "Pacific/Auckland": ["NZ"],
  "Africa/Cairo": ["EG"], "Africa/Johannesburg": ["ZA"], "Africa/Lagos": ["NG"], "Africa/Casablanca": ["MA"], "Africa/Algiers": ["DZ"], "Africa/Tunis": ["TN"], "Africa/Nairobi": ["KE"],
};

// « match » : le pays de sortie est celui du fuseau ; « mismatch » : un autre pays ; « unknown » : fuseau absent de la table ou pays illisible.
function fshTimezoneVsCountry(timeZone, country) {
  const list = FSH_TZ_COUNTRIES[timeZone];
  const c = String(country || "").toUpperCase();
  if (!list || !/^[A-Z]{2}$/.test(c)) return "unknown";
  return list.includes(c) ? "match" : "mismatch";
}
