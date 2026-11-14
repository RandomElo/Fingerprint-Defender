// Arnaques repérées dans la page (monde isolé) : saisie de carte chez un prestataire douteux, et plus loin fausses fenêtres
// de connexion et onglet qui change d'apparence. Les avertissements passent par fshBanner (banner.js).
(() => {
  const ctx = globalThis.fshContent;
  if (!ctx) return;

  // --- fausse fenêtre de connexion ---------------------------------------------------------------------
  // On cherche un texte court qui est exactement l'adresse d'un service de connexion (dans la page ou dans un champ en lecture
  // seule), à côté d'un champ mot de passe, alors que la page n'est pas ce service. Les liens sont ignorés : leur texte est
  // souvent une adresse, sans que ce soit une fausse barre d'adresse.
  let bitbReported = false;
  function scanFakeLogin() {
    if (bitbReported || window !== window.top || !ctx.on("scams")) return;
    const texts = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), seen = 0; n && seen < 4000; n = walker.nextNode(), seen++) {
      if (n.nodeValue.length < 140 && n.parentElement && !n.parentElement.closest("a, script, style")) texts.push([n.nodeValue, n.parentElement]);
    }
    for (const input of document.querySelectorAll("input[readonly], input[disabled]")) texts.push([input.value, input]);
    for (const [text, el] of texts) {
      const shown = fshFakeLoginUrl(text, location.hostname);
      if (!shown) continue;
      // Le champ mot de passe doit être dans la même « fenêtre » : un ancêtre proche.
      let near = el;
      let found = false;
      for (let i = 0; i < 8 && near; i++, near = near.parentElement) {
        if (near.querySelector && near.querySelector('input[type="password"]')) {
          found = true;
          break;
        }
      }
      if (!found) continue;
      bitbReported = true;
      chrome.runtime.sendMessage({ type: "alert-scam", kind: "bitb", host: location.hostname, reasons: [`affiche l'adresse de ${shown}`] }).catch(() => {});
      chrome.runtime.sendMessage({
        type: "page-signals",
        host: location.hostname,
        shop: false,
        ids: [],
        bad: [],
        findings: [
          { group: "Contenu de la page", label: "Fausse fenêtre de connexion", status: "bad", penalty: 50, cap: 30, detail: `La page dessine une fausse fenêtre qui affiche l'adresse de ${shown} avec un champ mot de passe. Une vraie fenêtre de connexion n'est pas dessinée dans la page.` },
        ],
      }).catch(() => {});
      fshBanner({
        title: "Fausse fenêtre de connexion",
        text: `Cette page dessine une fausse fenêtre qui affiche l'adresse de ${shown} avec un champ mot de passe. Une vraie fenêtre de connexion n'est pas dessinée dans la page : ne saisis rien ici.`,
        level: "bad",
      });
      return;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    for (const ms of [800, 2500, 6000]) setTimeout(scanFakeLogin, ms);
  });

  // --- onglet qui se déguise (tabnabbing) --------------------------------------------------------------
  // Pendant que tu es sur un autre onglet, la page change de titre ou d'icône pour imiter une connexion, en espérant que tu y
  // saisisses ton mot de passe en revenant. On compare la page avant et après son passage en arrière-plan.
  const iconOf = () => {
    const l = document.querySelector('link[rel~="icon"]');
    return l ? l.href : "";
  };
  const snapshot = () => ({ title: document.title, icon: iconOf(), hasPassword: !!document.querySelector('input[type="password"]'), t: Date.now() });
  let before = null;
  document.addEventListener("visibilitychange", () => {
    if (window !== window.top || !ctx.on("scams")) return;
    if (document.hidden) {
      before = snapshot();
      return;
    }
    if (!before || Date.now() - before.t < 2000) return; // un simple va-et-vient : pas le temps de piéger
    const now = snapshot();
    if (!fshTabDisguised(before, now)) return;
    chrome.runtime.sendMessage({ type: "alert-scam", kind: "tab", host: location.hostname, reasons: [`« ${before.title.slice(0, 40)} » devenu « ${now.title.slice(0, 40)} »`] }).catch(() => {});
    fshBanner({
      title: "Cet onglet a changé pendant ton absence",
      text: `Cette page s'appelait « ${before.title.slice(0, 60)} » et ressemble maintenant à une page de connexion. Des sites piégés font ça pour te faire saisir ton mot de passe. Ne saisis rien avant d'avoir vérifié l'adresse.`,
      level: "bad",
    });
    before = null;
  });

  // --- paiement -----------------------------------------------------------------------------------
  // Un champ de carte : le type de saisie standard (autocomplete) ou un nom courant.
  const CARD_FIELDS =
    'input[autocomplete="cc-number"], input[autocomplete="cc-csc"], input[autocomplete="cc-exp"], input[data-stripe], input[name*="cardnumber" i], input[name*="card-number" i], input[name*="card_number" i], input[id*="cardnumber" i], input[id*="card-number" i], input[name*="cvc" i], input[name*="cvv" i], input[name="ccnumber"], input[name="cc-number"]';

  // À qui part la carte : l'adresse du formulaire si elle est ailleurs, sinon le site (ou le cadre) lui-même.
  function receiverOf(field) {
    if (field.form) {
      try {
        const action = new URL(field.form.getAttribute("action") || location.href, location.href);
        if (/^https?:$/.test(action.protocol)) return action.hostname;
      } catch (_) {}
    }
    return location.hostname;
  }

  // On vérifie quand tu cliques dans le champ, pas au chargement : l'avertissement arrive au moment où il sert.
  const asked = new Set();
  document.addEventListener(
    "focusin",
    (e) => {
      const field = e.target;
      if (!(field instanceof Element) || !field.matches(CARD_FIELDS) || !ctx.on("payment")) return;
      const host = receiverOf(field);
      if (asked.has(host)) return;
      asked.add(host);
      chrome.runtime.sendMessage({ type: "payment-check", host }).catch(() => {});
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (window === window.top && msg && msg.type === "cert-warning") {
      fshBanner({
        title: "Connexion peut-être interceptée",
        text:
          `Le certificat de ${msg.host}, un site que tu visites souvent, ne vient plus d'une autorité reconnue par Firefox. ` +
          "Cela arrive sur un Wi-Fi public, derrière un proxy d'entreprise, avec certains antivirus, ou lors d'une attaque. " +
          "Si tu ne reconnais pas la situation, n'y saisis rien de sensible.",
        level: "bad",
      });
      return;
    }
    if (window !== window.top || !msg || msg.type !== "payment-warning" || !msg.item) return;
    const { host, verdict, score, reasons } = msg.item;
    const label = verdict === "dangerous" ? "dangereux" : "douteux";
    fshBanner({
      title: "Prestataire de paiement douteux",
      text:
        `Tu vas saisir ta carte chez ${host}, dont la réputation est mauvaise (${label}, ${score}/100` +
        `${reasons && reasons.length ? " : " + reasons.join(", ") : ""}). ` +
        "Vérifie que c'est bien le prestataire de ce site avant de payer. Dans le doute, paie avec PayPal ou une carte virtuelle.",
      level: verdict === "dangerous" ? "bad" : "warn",
    });
  });
})();
