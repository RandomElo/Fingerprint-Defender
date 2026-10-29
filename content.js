// Monde isolé : transmet les réglages à inject.js, masque les bandeaux, nettoie les liens
// et vérifie la fiabilité d'un site avant d'ouvrir un lien externe.
(() => {
  const EVT = "fsh-config-9d41";
  const SETTING_KEYS = new Set([...Object.keys(FSH_DEFAULTS), "seed"]);
  let cfg = null;

  // Canal vers inject.js, qui vit dans le monde de la page (voir le commentaire de ce fichier). Le nonce est
  // choisi ici, transmis avant tout script du site, et exigé sur chaque message dans les deux sens. La graine
  // ne quitte jamais ce script : inject.js reçoit seulement la clé dérivée pour le site principal.
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const sendToPage = (name, payload) =>
    window.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify({ n: nonce, ...payload }) }));

  // Site principal de l'onglet : la clé de brouillage en dépend, pas du cadre qui lit. Un pisteur intégré
  // dans deux sites doit voir deux empreintes différentes. Le cadre principal et ses cadres de même origine
  // le lisent directement ; un cadre d'un autre site demande à l'arrière-plan l'adresse de l'onglet.
  let topSitePromise = null;
  function topSite() {
    if (!topSitePromise) {
      topSitePromise = (async () => {
        try {
          const h = window.top.location.hostname;
          if (h) return fshRegistrable(h);
        } catch (_) {}
        try {
          const r = await chrome.runtime.sendMessage({ type: "top-site" });
          if (r && r.site) return r.site;
        } catch (_) {}
        return fshRegistrable(location.hostname);
      })();
    }
    return topSitePromise;
  }

  const isAllowed = (list, host) => list.some((d) => host === d || host.endsWith("." + d));
  const on = (feature) => cfg && cfg.enabled && !cfg.siteOff && cfg.features[feature];

  // Seuls les pisteurs tiers probables repérés par inject.js sont transmis.
  function reportTrackers(flagged) {
    if (!flagged || !flagged.length) return;
    chrome.runtime.sendMessage({ type: "stats", host: location.hostname, flagged }).catch(() => {});
  }

  // --- bandeaux de cookies et surcouches ----------------------------------------
  const BANNERS = [
    "#onetrust-consent-sdk", "#onetrust-banner-sdk", "#CybotCookiebotDialog",
    "#CybotCookiebotDialogBodyUnderlay", "#didomi-host", ".didomi-popup-container",
    ".didomi-popup-backdrop", "#qc-cmp2-container", ".fc-consent-root", "#usercentrics-root",
    "#cookiebanner", "#cookie-banner", ".cookie-banner", "#cookie-notice", ".cookie-notice",
    "#cookie-consent", ".cookie-consent", "#cookieConsent", "#gdpr-cookie-notice",
    ".cc-window", ".cc-banner", "#cmpbox", "#cmpwrapper", '[id^="sp_message_container_"]',
    "#axeptio_overlay", "#tarteaucitronRoot", "#cookiescript_injected", ".osano-cm-window",
    "#truste-consent-track", ".truste_overlay", "#hs-eu-cookie-confirmation",
    ".iubenda-cs-container", "#smartbanner", ".smartbanner", "#branch-banner-iframe",
  ];
  const BANNER_CSS = `${BANNERS.join(",")}{display:none !important}`;
  let styleEl = null;

  function syncBannerStyle() {
    const want = on("banners");
    if (want && !styleEl) {
      styleEl = document.createElement("style");
      styleEl.textContent = BANNER_CSS;
      (document.head || document.documentElement).append(styleEl);
    } else if (!want && styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  }

  // Si un bandeau a verrouillé le défilement, on le rend.
  function unlockScroll() {
    if (!on("banners") || !document.querySelector(BANNERS.join(","))) return;
    for (const el of [document.documentElement, document.body]) {
      if (el && getComputedStyle(el).overflow === "hidden") el.style.setProperty("overflow", "auto", "important");
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    unlockScroll();
    setTimeout(unlockScroll, 1500);
  });

  // --- liens trackés : google.com/url?q=..., facebook l.php?u=... ----------------
  const TRACKING = FSH_TRACKING;
  // [hôte, chemin, paramètres contenant la vraie destination]
  const REDIRECTORS = [
    [/(^|\.)google\.[a-z.]+$/, "/url", ["q", "url"]],
    [/(^|\.)facebook\.com$/, "/l.php", ["u"]],
    [/^l\.instagram\.com$/, "/", ["u"]],
    [/(^|\.)youtube\.com$/, "/redirect", ["q"]],
    [/(^|\.)linkedin\.com$/, "/safety/go", ["url"]],
    [/^duckduckgo\.com$/, "/l/", ["uddg"]],
    [/^steamcommunity\.com$/, "/linkfilter/", ["url", "u"]],
    [/^slack-redir\.net$/, "/link", ["url"]],
    [/^l\.wl\.co$/, "/l", ["u"]],
    [/(^|\.)safelinks\.protection\.outlook\.com$/, "/", ["url"]],
    [/^l\.(messenger|threads)\.(com|net)$/, "/l.php", ["u"]],
    [/^l\.threads\.net$/, "/", ["u"]],
  ];

  // forEach plutôt qu'un spread : sous Firefox, les itérateurs de URLSearchParams ne sont pas
  // utilisables depuis un script de contenu.
  function trackingKeys(u) {
    const keys = [];
    u.searchParams.forEach((_, k) => {
      if (TRACKING.test(k)) keys.push(k);
    });
    return keys;
  }

  // Renvoie l'adresse nettoyée, ou null si le lien est déjà propre.
  function cleanedHref(href) {
    let u;
    let original;
    try {
      u = new URL(href, location.href);
      original = u.href;
    } catch (_) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;

    for (const [hostRe, path, keys] of REDIRECTORS) {
      if (!hostRe.test(u.hostname) || (u.pathname !== path && u.pathname !== path + "/")) continue;
      for (const k of keys) {
        try {
          const target = new URL(u.searchParams.get(k));
          if (/^https?:$/.test(target.protocol)) {
            u = target;
            break;
          }
        } catch (_) {}
      }
      break;
    }
    for (const k of trackingKeys(u)) u.searchParams.delete(k);
    return u.href !== original ? u.href : null;
  }

  function cleanAnchor(a) {
    const out = cleanedHref(a.getAttribute("href"));
    if (!out) return 0;
    a.href = out;
    return 1;
  }

  // Filet de sécurité si le filtre réseau n'a pas retiré les paramètres de l'adresse chargée.
  function stripLocation() {
    if (window !== window.top) return;
    try {
      const u = new URL(location.href);
      const keys = trackingKeys(u);
      if (!keys.length) return;
      keys.forEach((k) => u.searchParams.delete(k));
      history.replaceState(history.state, "", u.href);
    } catch (_) {}
  }

  // Les liens ajoutés ou modifiés par la page sont nettoyés par lots.
  const queue = new Set();
  let scheduled = false;

  function flush() {
    scheduled = false;
    if (!on("cleanLinks")) return queue.clear();
    let n = 0;
    for (const node of queue) {
      if (node.matches && node.matches('a[href*="?"]')) n += cleanAnchor(node);
      if (node.querySelectorAll) for (const a of node.querySelectorAll('a[href*="?"]')) n += cleanAnchor(a);
    }
    queue.clear();
  }

  function schedule(node) {
    queue.add(node);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 250);
    }
  }

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") schedule(r.target);
      else for (const n of r.addedNodes) if (n.nodeType === 1) schedule(n);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  document.addEventListener("DOMContentLoaded", () => schedule(document.documentElement));

  const closestAnchor = (target) => {
    const a = target && target.closest && target.closest("a[href]");
    return a instanceof HTMLAnchorElement ? a : null;
  };

  // Certains sites réécrivent le lien au moment du clic.
  function cleanOnInteraction(e) {
    if (!on("cleanLinks")) return;
    const a = closestAnchor(e.target);
    if (a) cleanAnchor(a);
  }
  for (const type of ["pointerdown", "keydown", "contextmenu", "touchstart"]) {
    document.addEventListener(type, cleanOnInteraction, true);
  }

  // --- fiabilité des sites ---------------------------------------------------------
  const verdicts = new Map(); // nom d'hôte -> { res, approved }
  const inFlight = new Map();
  let overlay = null;

  const SAFETY_ACTIVE = () => cfg && cfg.enabled && !cfg.siteOff && cfg.safetyMode !== "off";

  function needsCheck(a) {
    if (!/^https?:$/.test(a.protocol) || !a.hostname || fshIsLocal(a.hostname)) return false;
    if (fshRegistrable(a.hostname) === fshRegistrable(location.hostname)) return false;
    return !isAllowed(cfg.trusted, a.hostname);
  }

  function ask(url) {
    const host = new URL(url).hostname;
    if (verdicts.has(host)) return Promise.resolve(verdicts.get(host).res);
    if (inFlight.has(host)) return inFlight.get(host);
    const p = browser.runtime
      .sendMessage({ type: "check", url })
      .then((res) => {
        if (res) verdicts.set(host, { res });
        return res;
      })
      .finally(() => inFlight.delete(host));
    inFlight.set(host, p);
    return p;
  }

  // Phishing classique : le texte affiche un site (« paypal.com ») mais le lien mène ailleurs.
  const HOST_IN_TEXT = /(?:^|\s|\/\/)((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\/:?\s]|$)/i;
  function augment(res, a) {
    if (!res || res.verdict === "local") return res;
    const m = HOST_IN_TEXT.exec((a.textContent || "").trim().slice(0, 200));
    if (!m) return res;
    const shown = m[1].toLowerCase();
    if (fshRegistrable(shown) === fshRegistrable(a.hostname)) return res;
    const findings = [
      ...res.findings,
      { group: "Lien", label: "Texte du lien trompeur", status: "bad", penalty: 40, cap: 40, detail: `Le lien affiche « ${shown} » mais mène vers ${a.hostname}.` },
    ];
    return { ...res, findings, ...fshScore(findings, res.base) };
  }

  const shouldWarn = (res) =>
    !!res && (cfg.safetyMode === "doubtful" ? res.verdict !== "safe" : res.verdict === "dangerous");

  // Prépare la réponse quand la souris survole un lien, pour qu'elle soit prête au clic.
  let hoverTimer = 0;
  let hovered = null;
  let tip = null;

  function hideTip() {
    if (tip) tip.remove();
    tip = null;
  }

  // Petite étiquette sous le lien : note de fiabilité de la destination, pour tous les liens externes.
  function showTip(a, res) {
    hideTip();
    const d = fshDisplay(res);
    tip = document.createElement("div");
    const root = tip.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .tip { position: fixed; z-index: 2147483646; display: flex; align-items: center; gap: 8px; padding: 6px 11px 6px 7px;
             border-radius: 999px; background: #191d24; color: #fff; font: 12px/1.2 system-ui, sans-serif;
             box-shadow: 0 6px 22px rgba(0,0,0,.4); pointer-events: none; white-space: nowrap; }
      .dot { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 11px; background: ${d.color}; }
      b { font-weight: 600; } span { opacity: .75; }
    `;
    const box = el("div", "tip");
    const glyph = d.kind === "unverified" ? "?" : { safe: "✓", doubtful: "!", dangerous: "✕" }[res.verdict];
    box.append(
      el("div", "dot", glyph),
      el("b", undefined, d.kind === "score" ? `${d.label} ${res.score}/100` : d.label),
      el("span", undefined, res.registrable)
    );
    root.append(style, box);
    document.documentElement.append(tip);
    const r = a.getBoundingClientRect();
    const h = box.offsetHeight || 28;
    box.style.left = Math.max(6, Math.min(r.left, innerWidth - box.offsetWidth - 6)) + "px";
    box.style.top = (r.bottom + h + 12 > innerHeight ? Math.max(6, r.top - h - 6) : r.bottom + 6) + "px";
  }
  window.addEventListener("scroll", hideTip, true);

  document.addEventListener(
    "pointerover",
    (e) => {
      if (!SAFETY_ACTIVE()) return;
      const a = closestAnchor(e.target);
      if (!a || !needsCheck(a)) return;
      hovered = a;
      clearTimeout(hoverTimer);
      const run = () =>
        ask(a.href)
          .then((res) => {
            if (res && hovered === a && cfg.linkBadges && !overlay) showTip(a, augment(res, a));
          })
          .catch(() => {});
      if (verdicts.has(a.hostname)) run();
      else hoverTimer = setTimeout(run, 200);
    },
    true
  );
  document.addEventListener(
    "pointerout",
    (e) => {
      if (hovered && e.relatedTarget && hovered.contains(e.relatedTarget)) return;
      clearTimeout(hoverTimer);
      hovered = null;
      hideTip();
    },
    true
  );

  function go(url, newTab) {
    if (newTab) window.open(url, "_blank", "noopener");
    else location.href = url;
  }

  function onLinkClick(e) {
    if (!SAFETY_ACTIVE() || overlay) return;
    if (e.type === "click" ? e.button !== 0 : e.button !== 1) return;
    const a = closestAnchor(e.target);
    if (!a || !needsCheck(a)) return;

    const known = verdicts.get(a.hostname);
    if (known && (known.approved || !shouldWarn(augment(known.res, a)))) return; // lien sûr : on laisse faire
    e.preventDefault();
    e.stopImmediatePropagation();

    const url = a.href;
    const newTab = a.target === "_blank" || e.type === "auxclick" || e.ctrlKey || e.metaKey || e.shiftKey;
    const decide = (res) => {
      hideOverlay();
      if (shouldWarn(res)) showWarning(res, url, newTab);
      else go(url, newTab);
    };
    if (known) return decide(augment(known.res, a));
    showChecking(a.hostname);
    ask(url).then((res) => decide(augment(res, a)), () => {
      hideOverlay();
      go(url, newTab);
    });
  }
  document.addEventListener("click", onLinkClick, true);
  document.addEventListener("auxclick", onLinkClick, true);

  // --- fenêtres (Shadow DOM, isolées du style de la page) -------------------------
  const NS = "http://www.w3.org/2000/svg";
  const COLORS = { safe: "#16a34a", doubtful: "#d97706", dangerous: "#dc2626" };
  const STATUS_ICON = { ok: "✓", warn: "!", bad: "✕", info: "–" };

  const CSS = `
    :host { all: initial; }
    .back { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
            background: rgba(10,12,18,.62); backdrop-filter: blur(4px); font: 14px/1.45 system-ui, sans-serif;
            animation: fade .15s ease-out; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pop { from { transform: translateY(8px) scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }
    .box { width: min(560px, 94vw); max-height: 92vh; display: flex; flex-direction: column; overflow: hidden;
           background: #fff; color: #1c1f24; border-radius: 16px; box-shadow: 0 20px 70px rgba(0,0,0,.5);
           animation: pop .18s ease-out; }
    @media (prefers-color-scheme: dark) { .box { background: #191d24; color: #e8eaee; } }
    .head { padding: 20px 22px 16px; color: #fff; display: flex; gap: 16px; align-items: center; background: var(--c); }
    .head h2 { margin: 0; font-size: 20px; line-height: 1.2; }
    .head p { margin: 4px 0 0; opacity: .92; font-size: 13px; }
    .gauge { flex: none; }
    .gauge text { fill: #fff; font: 700 24px system-ui, sans-serif; }
    .gauge .sub { font: 11px system-ui, sans-serif; opacity: .85; }
    .body { padding: 14px 22px 4px; overflow: auto; }
    .host { font: 600 15px ui-monospace, monospace; word-break: break-all; }
    .url { font: 12px ui-monospace, monospace; opacity: .65; word-break: break-all; margin-top: 2px; }
    .grp { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin: 14px 0 4px; }
    .row { display: grid; grid-template-columns: 22px 1fr; gap: 8px; padding: 5px 0; align-items: start; }
    .ico { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; }
    .ico.ok { background: #16a34a; } .ico.warn { background: #d97706; } .ico.bad { background: #dc2626; } .ico.info { background: #8b93a1; }
    .row b { font-weight: 600; } .row span { opacity: .75; display: block; font-size: 13px; }
    .btns { display: flex; gap: 8px; padding: 14px 22px 18px; flex-wrap: wrap; align-items: center; }
    button { font: inherit; border-radius: 10px; padding: 9px 15px; cursor: pointer; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; }
    button.main { border: 0; color: #fff; background: linear-gradient(135deg, #3b82f6, #4f46e5); font-weight: 600; }
    button.risk { color: #dc2626; border-color: rgba(220,38,38,.5); }
    .spacer { flex: 1; }
    .link { border: 0; padding: 4px 2px; font-size: 12px; opacity: .7; text-decoration: underline; }
    .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647; display: flex; gap: 10px; align-items: center;
             padding: 10px 16px; border-radius: 999px; background: #191d24; color: #fff; font: 13px system-ui, sans-serif;
             box-shadow: 0 8px 30px rgba(0,0,0,.4); }
    .spin { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%; animation: rot .7s linear infinite; }
    @keyframes rot { to { transform: rotate(360deg); } }
  `;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const svg = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };

  function mountOverlay(content) {
    hideOverlay();
    overlay = document.createElement("div");
    const root = overlay.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.append(style, content);
    (document.body || document.documentElement).append(overlay);
    return root;
  }

  function hideOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  function showChecking(host) {
    const toast = el("div", "toast");
    toast.append(el("div", "spin"), el("span", undefined, `Vérification de ${host}…`));
    mountOverlay(toast);
  }

  function gauge(d) {
    const R = 34;
    const C = 2 * Math.PI * R;
    const g = svg("svg", { class: "gauge", viewBox: "0 0 84 84", width: 84, height: 84 });
    const value = d.kind === "score" ? d.value : 100;
    g.append(
      svg("circle", { cx: 42, cy: 42, r: R, fill: "none", stroke: "rgba(255,255,255,.28)", "stroke-width": 8 }),
      svg("circle", {
        cx: 42, cy: 42, r: R, fill: "none", stroke: "#fff", "stroke-width": 8, "stroke-linecap": "round",
        "stroke-dasharray": `${(value / 100) * C} ${C}`, transform: "rotate(-90 42 42)",
      })
    );
    const scored = d.kind === "score";
    const num = svg("text", { x: 42, y: scored ? 38 : 42, "text-anchor": "middle", "dominant-baseline": "central" });
    num.textContent = d.text;
    g.append(num);
    if (scored) {
      const sub = svg("text", { x: 42, y: 56, "text-anchor": "middle", "dominant-baseline": "central", class: "sub" });
      sub.textContent = "/100";
      g.append(sub);
    }
    return g;
  }

  function showWarning(res, url, newTab) {
    const dangerous = res.verdict === "dangerous";
    const box = el("div", "box");
    box.style.setProperty("--c", COLORS[res.verdict]);

    const head = el("div", "head");
    const titles = el("div");
    titles.append(
      el("h2", undefined, dangerous ? "Ce site n'est pas fiable" : "Ce site semble douteux"),
      el("p", undefined, dangerous ? "On te déconseille fortement de l'ouvrir." : "Quelques signaux inquiétants : ouvre-le avec prudence.")
    );
    head.append(gauge(fshDisplay(res)), titles);

    const body = el("div", "body");
    body.append(el("div", "host", res.host));
    let shown = url;
    try {
      const u = new URL(url);
      shown = u.origin + u.pathname + (u.search ? "?…" : "");
    } catch (_) {}
    body.append(el("div", "url", shown));
    // Les problèmes d'abord, puis ce qui est sans souci, puis ce qui n'a pas pu être vérifié.
    const sections = [
      ["Problèmes détectés", (f) => f.status === "bad" || f.status === "warn"],
      ["Vérifications réussies", (f) => f.status === "ok"],
      ["Non disponible", (f) => f.status === "info"],
    ];
    for (const [title, test] of sections) {
      const list = res.findings.filter(test);
      if (!list.length) continue;
      body.append(el("div", "grp", title));
      for (const f of list) {
        const row = el("div", "row");
        const text = el("div");
        text.append(el("b", undefined, f.label), el("span", undefined, f.detail));
        row.append(el("div", `ico ${f.status}`, STATUS_ICON[f.status]), text);
        body.append(row);
      }
    }

    const btns = el("div", "btns");
    const back = el("button", "main", "Retourner en arrière");
    back.addEventListener("click", hideOverlay);
    const cont = el("button", "risk", "Continuer quand même");
    cont.addEventListener("click", () => {
      verdicts.set(res.host, { res, approved: true });
      hideOverlay();
      go(url, newTab);
    });
    const trust = el("button", "link", `Toujours faire confiance à ${res.host}`);
    trust.addEventListener("click", async () => {
      const { trusted } = await chrome.storage.local.get({ trusted: [] });
      if (!trusted.includes(res.host)) await chrome.storage.local.set({ trusted: [...trusted, res.host] });
      hideOverlay();
      go(url, newTab);
    });
    btns.append(back, cont, el("span", "spacer"), trust);

    box.append(head, body, btns);
    const back2 = el("div", "back");
    back2.addEventListener("click", (e) => e.target === back2 && hideOverlay());
    back2.append(box);
    mountOverlay(back2);
    chrome.runtime.sendMessage({ type: "alert", result: res, from: location.hostname }).catch(() => {});
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && overlay) hideOverlay();
    },
    true
  );

  // --- contenu de la page : signaux typiques des fausses boutiques --------------------
  // On ne lit que la page déjà affichée, rien n'est téléchargé en plus.
  let signalsSent = false;

  function luhn(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let n = +digits[digits.length - 1 - i];
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    return sum % 10 === 0;
  }

  // Numéros SIREN/SIRET cités à côté de « SIRET », « SIREN » ou « RCS » : valides (clé de contrôle) ou non.
  function companyIds(text) {
    const ids = new Set();
    const bad = new Set();
    const re = /(siret|siren|rcs)[^0-9]{0,40}((?:\d[ .\u00a0]?){9,14})/gi;
    let m;
    while ((m = re.exec(text))) {
      const d = m[2].replace(/\D/g, "");
      if (d.length !== 9 && d.length !== 14) continue;
      if (luhn(d) || d.startsWith("356000000")) ids.add(d.slice(0, 9));
      else bad.add(d);
    }
    return { ids: [...ids].slice(0, 2), bad: [...bad].slice(0, 2) };
  }

  // Un élément « panier » dans la page, en comparant les mots entiers du nom de classe : « cartes » ou
  // « cartouche » (un jeu de cartes, une encre) ne sont pas un panier.
  const CART_NAME = /(^|[\s_-])(cart|panier|basket)([\s_-]|$)/i;
  function hasCartElement() {
    const sel = '[class*="cart" i], [id*="cart" i], [class*="panier" i], [class*="basket" i]';
    for (const el of document.querySelectorAll(sel)) {
      if (CART_NAME.test(el.getAttribute("class") || "") || CART_NAME.test(el.id || "")) return true;
    }
    return false;
  }

  let scanning = false;
  async function scanPage() {
    if (window !== window.top || !SAFETY_ACTIVE() || signalsSent || scanning || fshIsLocal(location.hostname)) return;
    scanning = true;
    try {
      await scanPageNow();
    } finally {
      scanning = false;
    }
  }

  async function scanPageNow() {
    const G = "Contenu de la page";
    const findings = [];
    const message = { type: "page-signals", host: location.hostname, shop: false, ids: [], bad: [], findings };

    // 1. Formulaires de mot de passe : envoyés ailleurs ou sur une page non chiffrée.
    const own = fshRegistrable(location.hostname);
    const pwFields = [...document.querySelectorAll('input[type="password"]')];
    if (pwFields.length) {
      let foreign = null;
      for (const input of pwFields) {
        try {
          const u = new URL((input.form && input.form.getAttribute("action")) || location.href, location.href);
          if (/^https?:$/.test(u.protocol) && !fshIsLocal(u.hostname) && fshRegistrable(u.hostname) !== own) foreign = u.hostname;
        } catch (_) {}
      }
      findings.push(
        foreign
          ? { group: G, label: "Mot de passe envoyé ailleurs", status: "warn", penalty: 40, cap: 35, detail: `Le formulaire de mot de passe envoie les données vers « ${foreign} », un autre site.` }
          : { group: G, label: "Mot de passe", status: "ok", penalty: 0, detail: "Les mots de passe restent sur ce site." }
      );
      if (location.protocol === "http:") {
        findings.push({ group: G, label: "Mot de passe non chiffré", status: "warn", penalty: 25, detail: "Un mot de passe est demandé sur une page non chiffrée (HTTP)." });
      }
    }

    // 2. Boutiques en ligne : mentions légales, contact, identité de l'éditeur, remises, urgence.
    const text = ((document.body && document.body.innerText) || "").slice(0, 150000).toLowerCase();
    const anchors = [...document.querySelectorAll("a[href]")].slice(0, 400);
    const links = anchors.map((a) => (a.textContent + " " + a.getAttribute("href")).toLowerCase()).join("\n");
    const kind = fshPageKind(text, hasCartElement());
    const light = kind === "shop-light"; // prix sans panier : contrôles allégés, jamais de « boutique récente »
    const shop = kind === "shop" || light;

    if (shop) {
      message.shop = !light;
      const LEGAL = /mentions? l[ée]gales?|legal notice|impressum|\bcgv\b|conditions g[ée]n[ée]rales de vente|terms (of|and) (service|sale)/;
      const legal = LEGAL.test(links + " " + text);
      const contact = /mailto:|tel:|\bcontact/.test(links);
      const discounts = text.match(/-\s?[5-9]\d\s?%/g) || [];
      const urgency = text.match(/il ne reste que|derni[èe]res? pi[èe]ces|stock limit[ée]|offre limit[ée]e|se termine dans|only \d+ left|hurry/g) || [];
      findings.push(
        { group: G, label: "Boutique en ligne", status: "info", penalty: 0, detail: light ? "Cette page propose des achats (prix, packs) : vérifications allégées, car elle n'a pas de panier." : "Cette page ressemble à une boutique : les vérifications ci-dessous s'appliquent." },
        legal
          ? { group: G, label: "Mentions légales", status: "ok", penalty: 0, detail: "Mentions légales ou conditions de vente présentes." }
          : light
            ? { group: G, label: "Mentions légales", status: "warn", penalty: 8, detail: "Aucune mention légale ni condition de vente trouvée sur la page qui propose des achats." }
            : { group: G, label: "Mentions légales", status: "warn", penalty: 30, cap: 40, detail: "Aucune mention légale ni condition de vente trouvée sur une boutique en ligne." },
        contact
          ? { group: G, label: "Contact", status: "ok", penalty: 0, detail: "Un moyen de contact est présent." }
          : { group: G, label: "Contact", status: "warn", penalty: light ? 4 : 12, detail: "Aucun moyen de contact visible." },
        discounts.length >= 3
          ? { group: G, label: "Remises", status: "warn", penalty: 12, detail: `${discounts.length} remises extrêmes affichées (de -50 % à -99 %).` }
          : { group: G, label: "Remises", status: "ok", penalty: 0, detail: "Pas de remises anormalement élevées." },
        urgency.length >= 2
          ? { group: G, label: "Pression à l'achat", status: "warn", penalty: 8, detail: "Messages d'urgence répétés (stock limité, offre qui se termine...)." }
          : { group: G, label: "Pression à l'achat", status: "ok", penalty: 0, detail: "Pas de pression à l'achat visible." }
      );

      // Identité de l'éditeur (sites français) : numéros SIREN/SIRET dans la page ou les mentions légales.
      const french = /^fr/i.test(document.documentElement.lang || "") || /\.fr$/.test(location.hostname);
      if (french) {
        let { ids, bad } = companyIds(text);
        let legalRead = false;
        if (!ids.length && !bad.length) {
          const link = anchors.find((a) => LEGAL.test((a.textContent + " " + a.getAttribute("href")).toLowerCase()));
          try {
            const u = link && new URL(link.href, location.href);
            if (u && u.origin === location.origin) {
              const r = await fetch(u.href, { credentials: "omit" });
              const doc = new DOMParser().parseFromString((await r.text()).slice(0, 300000), "text/html");
              const legalText = (doc.body.textContent || "").toLowerCase();
              // Une application monopage renvoie sa coquille vide (ou une 404) pour une page qu'elle dessine
              // elle-même : on ne conclut « aucun numéro » que si on a bien lu une page de mentions légales.
              if (r.ok && LEGAL.test(legalText)) {
                ({ ids, bad } = companyIds(legalText));
                legalRead = true;
              }
            }
          } catch (_) {}
        }
        message.ids = ids;
        message.bad = bad;
        if (!ids.length && !bad.length && legalRead) {
          findings.push({ group: G, label: "Identité de l'éditeur", status: "warn", penalty: 15, detail: "Aucun numéro d'entreprise (SIRET, SIREN, RCS) trouvé dans les mentions légales." });
        }
      }
    }

    // 3. Page de soutien (dons, abonnement facultatif) : pas une boutique, donc pas de pénalité de boutique.
    // On regarde seulement si le paiement passe par un prestataire reconnu et si des mentions légales existent.
    if (kind === "support") {
      const processor = (links + " " + text).match(/stripe|paypal|patreon|ko-fi|liberapay|helloasso|tipeee|utip/);
      const legal = /mentions? l[ée]gales?|legal notice|impressum|\bcgv\b|conditions g[ée]n[ée]rales|terms (of|and) (service|sale)|confidentialit|privacy/.test(links);
      findings.push(
        { group: G, label: "Page de soutien", status: "info", penalty: 0, detail: "Cette page propose des dons ou un abonnement facultatif : elle n'est pas jugée comme une boutique." },
        processor
          ? { group: G, label: "Paiement", status: "ok", penalty: 0, detail: `Le paiement passe par un prestataire reconnu (${processor[0]}).` }
          : { group: G, label: "Paiement", status: "info", penalty: 0, detail: "Prestataire de paiement non identifié sur cette page." },
        legal
          ? { group: G, label: "Mentions légales", status: "ok", penalty: 0, detail: "Mentions légales ou conditions présentes." }
          : { group: G, label: "Mentions légales", status: "warn", penalty: 6, detail: "Aucune mention légale ni condition trouvée sur la page de soutien." }
      );
    }

    if (!findings.length) return;
    signalsSent = true;
    chrome.runtime.sendMessage(message).catch(() => {});
  }
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(scanPage, 1500);
    setTimeout(scanPage, 6000); // sites qui construisent la page après coup
  });

  // Applications monopage : aller sur la boutique ne recharge pas la page, donc rien ne relançait l'analyse.
  // On surveille l'adresse et on relit la page quand elle change, une fois la nouvelle vue dessinée.
  if (window === window.top) {
    let lastHref = location.href;
    setInterval(() => {
      if (document.hidden || location.href === lastHref) return;
      lastHref = location.href;
      signalsSent = false;
      setTimeout(scanPage, 1200);
      setTimeout(scanPage, 5000);
    }, 1000);
  }

  // --- réglages ------------------------------------------------------------------
  function push() {
    chrome.storage.local.get({ ...FSH_DEFAULTS, seed: "" }, async (s) => {
      cfg = {
        enabled: s.enabled,
        siteOff: isAllowed(s.allowlist, location.hostname),
        level: s.level,
        safetyMode: s.safetyMode,
        linkBadges: s.linkBadges,
        trusted: s.trusted,
        features: { ...FSH_DEFAULTS.features, ...s.features },
      };
      const flags = { enabled: cfg.enabled, siteOff: cfg.siteOff, level: cfg.level, features: cfg.features };
      sendToPage(EVT, flags); // les réglages ne dépendent pas du site principal : on ne les fait pas attendre
      syncBannerStyle();
      if (document.documentElement) schedule(document.documentElement);
      if (on("cleanUrls")) stripLocation();

      // La clé suit, dès qu'on connaît le site principal. Sans graine (première installation en cours),
      // inject.js garde sa clé provisoire.
      if (!s.seed) return;
      try {
        sendToPage(EVT, { ...flags, key: fshSiteKey(s.seed, await topSite()) });
      } catch (_) {}
    });
  }

  // Compteurs envoyés par inject.js, relayés au script d'arrière-plan. L'écouteur est posé avant tout script
  // du site et coupe la propagation : la page ne les voit pas, et sans le nonce elle ne peut pas en forger.
  window.addEventListener(
    EVT + "-stats",
    (e) => {
      e.stopImmediatePropagation();
      try {
        const d = JSON.parse(e.detail);
        if (d.n === nonce && Array.isArray(d.t)) reportTrackers(d.t.slice(0, 20));
      } catch (_) {}
    },
    true
  );

  // inject.js démarre parfois après nous : son premier message de bienvenue serait alors tombé dans le vide.
  // Il nous le signale, on répond (quelques fois seulement, au cas où la page enverrait de faux signaux).
  let readyReplies = 0;
  window.addEventListener(
    EVT + "-ready",
    (e) => {
      e.stopImmediatePropagation();
      if (++readyReplies > 3) return;
      sendToPage(EVT + "-hello", {});
      push();
    },
    true
  );
  sendToPage(EVT + "-hello", {});

  push();
  chrome.storage.onChanged.addListener((changes) => {
    if (Object.keys(changes).some((k) => SETTING_KEYS.has(k))) push();
  });
})();
