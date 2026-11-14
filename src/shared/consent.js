// Refus automatique des bandeaux de cookies. Masquer un bandeau ne dit rien au site : il croit que tu n'as pas répondu et
// garde son réglage par défaut. Ici on clique sur « Tout refuser », comme tu le ferais.
//
// Les sélecteurs sont écrits d'après la structure publique de chaque outil de consentement. Ils ont été vérifiés sur des
// pages de test qui reproduisent ces structures, pas sur les vrais sites : un outil qui change son code n'est plus reconnu
// (rien ne se passe, le bandeau reste masqué par la feuille de style de content.js). Un sélecteur qui ne correspond à
// rien est sans effet.

// [nom, sélecteurs du bouton de refus, hôte du cadre où il se trouve (null : la page elle-même)]
const FSH_CMP_RULES = [
  ["OneTrust", ["#onetrust-reject-all-handler", ".ot-pc-refuse-all-handler"], null],
  ["Cookiebot", ["#CybotCookiebotDialogBodyButtonDecline", "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll"], null],
  ["Didomi", ["#didomi-notice-disagree-button", ".didomi-continue-without-agreeing"], null],
  ["Usercentrics", ["button[data-testid='uc-deny-all-button']", "#uc-btn-deny-banner"], null],
  ["Axeptio", ["#axeptio_btn_dismiss"], null],
  ["tarteaucitron", ["#tarteaucitronAllDenied2"], null],
  ["Osano", [".osano-cm-denyAll"], null],
  ["iubenda", [".iubenda-cs-reject-btn"], null],
  ["Complianz", [".cmplz-deny"], null],
  ["CookieYes", [".cky-btn-reject"], null],
  ["Cookie Script", ["#cookiescript_reject"], null],
  ["Klaro", [".cn-decline", ".cm-btn-decline"], null],
  ["Borlabs", ["a[data-cookie-refuse]"], null],
  ["Google Funding Choices", [".fc-cta-do-not-consent"], null],
  ["Piwik PRO", ["#ppms_cm_reject-all"], null],
  ["CookieFirst", ["[data-cookiefirst-action='reject']"], null],
  ["Termly", ["[data-tid='banner-decline']"], null],
  ["Consentmanager", [".cmpboxbtnno"], null],
  ["Shopify", ["#shopify-pc__banner__btn-decline"], null],
  // Sourcepoint affiche son message dans un cadre venu de son propre domaine : la règle s'applique dans ce cadre.
  ["Sourcepoint", ["button[title='Reject All']", "button[title='Refuser tout']", "button[title='Tout refuser']"], /(privacy-mgmt\.com|sp-prod\.net|sourcepoint)/i],
];

// Texte entier d'un bouton de refus (règle générique) : le bouton doit dire exactement cela, pas seulement le contenir.
const FSH_REFUSE_TEXT = /^(tout refuser|refuser tout|tout rejeter|refuser|refuser les cookies|refuser et continuer|continuer sans accepter|je refuse|refuser les cookies non essentiels|uniquement les cookies (essentiels|nécessaires)|seulement les cookies nécessaires|reject all|decline all|deny all|reject|decline|reject non-essential|only necessary|necessary only)$/i;

// Zones qui peuvent être un bandeau de consentement : un dialogue, ou un nom de classe ou d'identifiant qui en parle.
const FSH_CONSENT_AREA =
  '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="gdpr" i], [class*="gdpr" i], [id*="cmp" i], [class*="cmp" i]';

// Cherche `selector` dans `root`, y compris dans les shadow roots ouverts (Usercentrics y met son bandeau).
function fshDeepFind(root, selector) {
  const found = root.querySelector(selector);
  if (found) return found;
  let seen = 0;
  for (const el of root.querySelectorAll("*")) {
    if (++seen > 6000) break;
    if (el.shadowRoot) {
      const f = fshDeepFind(el.shadowRoot, selector);
      if (f) return f;
    }
  }
  return null;
}

function fshVisible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

// Refuse le bandeau de `doc` s'il y en a un. Renvoie le nom de l'outil refusé, ou null. À rappeler : les bandeaux arrivent tard.
function fshConsentRefuse(doc) {
  const host = (doc.location && doc.location.hostname) || "";
  for (const [name, selectors, hostRe] of FSH_CMP_RULES) {
    if (hostRe && !hostRe.test(host)) continue;
    for (const sel of selectors) {
      const el = fshDeepFind(doc, sel);
      if (el) {
        el.click();
        return name;
      }
    }
  }

  // Règle générique, dans la page principale seulement : un bouton de refus dans une zone qui parle de cookies.
  const view = doc.defaultView;
  if (!view || view !== view.top) return null;
  let checked = 0;
  for (const area of doc.querySelectorAll(FSH_CONSENT_AREA)) {
    if (++checked > 30) break;
    if (!/cookies?|traceurs?|consent/i.test(area.textContent || "") || !fshVisible(area)) continue;
    for (const b of area.querySelectorAll("button, a[role='button'], [role='button'], input[type='button'], input[type='submit']")) {
      const text = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
      if (FSH_REFUSE_TEXT.test(text) && fshVisible(b)) {
        b.click();
        return "bandeau inconnu";
      }
    }
  }
  return null;
}
