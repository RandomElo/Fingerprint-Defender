// Monde de la page, avant tout script du site.
// Principe : un bruit DÉTERMINISTE (même graine + même site = mêmes valeurs à chaque appel)
// et des fonctions qui restent "natives" (Proxy). Les services qui détectent les bloqueurs
// (Google Meet, Agenda...) repèrent surtout les valeurs qui changent à chaque lecture,
// les canvas vides ou les fonctions réécrites visibles via toString().
(() => {
  "use strict";
  const EVT = "fsh-config-9d41";

  const state = {
    enabled: true,
    siteOff: false,
    level: "renforce",
    features: {
      canvas: true, webgl: true, audio: true, hardware: true, fonts: true, screen: true,
      rects: true, extra: true, webrtc: false, beacon: true, perms: true, popups: true, cleanUrls: true, gpc: true, webrtcRelay: false, scams: true, cleanCopy: true,
    },
    key: null, // clé de brouillage du site principal, fournie par content.js
  };

  // --- canal avec content.js ------------------------------------------------------
  // Ce script tourne dans le monde de la page : tout ce qu'il reçoit par un événement, un script du site
  // peut aussi le voir ou le forger. Trois protections :
  //  1. Nos écouteurs sont posés en phase de capture, avant tout script du site, et coupent la propagation :
  //     un écouteur ajouté plus tard par la page ne reçoit jamais ces événements.
  //  2. content.js choisit au démarrage un nonce secret et le transmet par cet événement, avant que la page
  //     n'ait pu s'abonner. Un message de configuration sans ce nonce est ignoré : la page ne peut pas
  //     couper la protection en envoyant un faux message.
  //  3. La graine ne passe jamais ici, seulement la clé dérivée pour le site principal.
  let nonce = null;
  // Clé provisoire, tant que la vraie n'est pas arrivée (lecture asynchrone du stockage). Dès qu'une valeur a
  // été brouillée avec elle, on la garde pour toute la page : changer de clé en cours de route donnerait deux
  // valeurs différentes pour la même lecture, ce que les sites repèrent chez les bloqueurs.
  let provisional = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  let keyUsed = false;
  const siteKey = () => {
    keyUsed = true;
    return state.key || provisional;
  };

  window.addEventListener(
    EVT + "-hello",
    (e) => {
      e.stopImmediatePropagation();
      if (nonce) return; // le premier message arrive avant tout script du site : on ne l'accepte qu'une fois
      try {
        const d = JSON.parse(e.detail);
        if (typeof d.n === "string" && d.n.length >= 16) nonce = d.n;
      } catch (_) {}
    },
    true
  );

  const FEATURE_KEYS = Object.keys(state.features);
  window.addEventListener(
    EVT,
    (e) => {
      e.stopImmediatePropagation();
      try {
        const cfg = JSON.parse(e.detail);
        if (!nonce || cfg.n !== nonce) return;
        state.enabled = cfg.enabled === true;
        state.siteOff = cfg.siteOff === true;
        state.level = cfg.level === "prudent" ? "prudent" : "renforce";
        for (const k of FEATURE_KEYS) if (typeof cfg.features[k] === "boolean") state.features[k] = cfg.features[k];
        // Pas de changement de clé si des valeurs ont déjà été brouillées avec la clé provisoire.
        if (typeof cfg.key === "string" && /^[0-9a-f]{32}$/.test(cfg.key) && (state.key || !keyUsed)) state.key = cfg.key;
      } catch (_) {}
    },
    true
  );

  // Au cas où content.js aurait démarré avant nous et envoyé son premier message dans le vide.
  window.dispatchEvent(new CustomEvent(EVT + "-ready"));

  const active = (f) => state.enabled && !state.siteOff && state.features[f];

  // Statistiques : nombre de lectures brouillées, envoyées par lots à content.js.
  // Détection des pisteurs probables : chaque script de page qui lit plusieurs surfaces d'empreinte
  // différentes marque des points ; à FLAG_AT, il est signalé. Une surface compte une fois par script.
  const WEIGHT = { canvas: 3, audio: 3, webgl: 2, webrtc: 2, workers: 5, fonts: 1, rects: 1, extra: 1, screen: 0.5, hardware: 0.5 };
  const FLAG_AT = 5;

  const pendingFlags = []; // scripts devenus "pisteur probable"
  const surfaces = {}; // domaine du script -> surfaces touchées
  const flagged = new Set();
  let flushTimer = 0;
  const realSetTimeout = window.setTimeout.bind(window);

  // Qui lit ? On retrouve le domaine du script appelant dans la pile d'appels. La pile coûte cher :
  // lue sur les premiers appels puis une fois sur 8, le résultat est réutilisé entre-temps.
  const lastSrc = {};
  const ticks = {};
  const siteOf = (host) => {
    const l = host.split(".");
    if (l.length <= 2 || /^[\d.]+$/.test(host) || host.includes(":")) return host;
    const compound = l[l.length - 1].length === 2 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(l[l.length - 2]);
    return l.slice(compound ? -3 : -2).join(".");
  };
  function callerSite() {
    try {
      const m = /https?:\/\/([^/\s:)]+)/.exec(new Error().stack || "");
      if (m) return siteOf(m[1].toLowerCase());
    } catch (_) {}
    return siteOf(location.hostname);
  }

  function schedule() {
    if (flushTimer) return;
    flushTimer = realSetTimeout(() => {
      flushTimer = 0;
      if (!nonce) return schedule(); // content.js pas encore là : on réessaie
      const payload = JSON.stringify({ n: nonce, t: pendingFlags });
      pendingFlags.length = 0;
      window.dispatchEvent(new CustomEvent(EVT + "-stats", { detail: payload }));
    }, 1500);
  }

  const ownSite = siteOf(location.hostname);

  function hit(feature) {
    if (!WEIGHT[feature]) return; // blocages : rien à compter
    const n = (ticks[feature] = (ticks[feature] || 0) + 1);
    if (n <= 30 || n % 8 === 0 || !lastSrc[feature]) lastSrc[feature] = callerSite();
    mark(lastSrc[feature], feature);
  }

  // Le script du domaine `src` a lu la surface `feature` : il marque des points, et il est signalé au seuil.
  function mark(src, feature) {
    if (src === ownSite || flagged.has(src)) return; // seuls les scripts d'un autre domaine nous intéressent

    const set = surfaces[src] || (surfaces[src] = new Set());
    if (set.has(feature)) return;
    set.add(feature);
    let score = 0;
    for (const f of set) score += WEIGHT[f] || 0;
    if (score >= FLAG_AT) {
      flagged.add(src);
      pendingFlags.push({ src, f: [...set] });
      schedule();
    }
  }

  // --- utilitaires ---------------------------------------------------------
  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // La clé est déjà propre au site principal : un pisteur intégré dans deux sites n'a pas les mêmes valeurs.
  const rngFor = (tag) => mulberry32(hash32(siteKey() + "|" + tag));

  // Remplace une méthode par un Proxy : toString() reste "[native code]", name/length conservés.
  function wrapMethod(proto, name, handler) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== "function") return;
    const orig = desc.value;
    const proxy = new Proxy(orig, {
      apply(target, self, args) {
        return handler(target, self, args);
      },
    });
    Object.defineProperty(proto, name, { ...desc, value: proxy });
  }

  function wrapGetter(proto, name, handler) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.get !== "function") return;
    const proxy = new Proxy(desc.get, {
      apply(target, self, args) {
        return handler(target, self, args);
      },
    });
    Object.defineProperty(proto, name, { ...desc, get: proxy });
  }

  // --- brouillage : le noyau est dans src/shared/noise-core.js ---------------------------------------------------
  // Même code pour la page, pour les cadres que la page crée et lit aussitôt, et pour les workers (voir plus bas).
  const core = window.__fshCore;
  delete window.__fshCore; // la page ne doit pas voir ce nom
  const env = {
    key: siteKey,
    active,
    strong: (f) => active(f) && state.level === "renforce",
    hit,
  };
  // Sonde partagée avec le noyau : un getter emballé répond à ce symbole (le registre de symboles est commun à tous les cadres).
  // Elle évite d'emballer deux fois une fenêtre, que ce soit le parent qui s'en occupe en premier ou le script du cadre lui-même.
  const PROBE = Symbol.for("fsh-probe-9d41");
  const KEYREQ = Symbol.for("fsh-key-9d41");
  // Un cadre du même site qui démarre avant d'avoir reçu ses réglages en demande l'état à son parent, au lieu de prendre une clé
  // provisoire aléatoire : sa première lecture est alors la même que celle de la page. La demande passe par le getter emballé du
  // parent (rien d'exposé sur window), et celui-ci ne répond que si l'appelant est ce script (pile d'appels) : une page qui ferait
  // le même appel n'obtiendrait pas la clé, qui lui permettrait de retirer le bruit.
  // Les scripts de contenu n'ont pas d'adresse dans une pile d'appels : leurs lignes s'écrivent « nom@<anonymous code> », alors que
  // celles d'une page portent son adresse. L'appelant doit donc être adoptFromParent, déclaré dans ce fichier.
  env.share = () => {
    try {
      const lines = String(new Error().stack).split("\n"); // 0 : ici, 1 : le getter emballé, 2 : l'appelant
      if (!/^adoptFromParent@<anonymous code>/.test(lines[2] || "")) return undefined;
      return {
        key: siteKey(),
        real: !!state.key,
        enabled: state.enabled,
        level: state.level,
        features: { ...state.features },
      };
    } catch (_) {
      return undefined;
    }
  };
  function adoptFromParent() {
    try {
      if (window.parent === window) return;
      const p = window.parent;
      const d = Object.getOwnPropertyDescriptor(p.Navigator.prototype, "hardwareConcurrency");
      const r = d && d.get && d.get.call(p.navigator, KEYREQ);
      if (!r || typeof r !== "object" || !/^[0-9a-f]{32}$/.test(r.key)) return;
      if (r.real) state.key = r.key;
      else {
        provisional = r.key;
        keyUsed = true;
      }
      state.enabled = r.enabled === true;
      state.level = r.level === "prudent" ? "prudent" : "renforce";
      for (const k of FEATURE_KEYS) if (typeof r.features[k] === "boolean") state.features[k] = r.features[k];
    } catch (_) {} // parent d'un autre site : on attend nos propres réglages
  }
  adoptFromParent();
  const isPatched = (win) => {
    try {
      const d = Object.getOwnPropertyDescriptor(win.Navigator.prototype, "hardwareConcurrency");
      return !!(d && d.get && d.get.call(win.navigator, PROBE) === PROBE);
    } catch (_) {
      return false;
    }
  };
  const patchWindow = (win) => {
    try {
      if (!win || isPatched(win)) return;
      core(win, env);
    } catch (_) {}
  };
  patchWindow(window);

  // Cadres : un script peut créer un iframe et lire aussitôt `iframe.contentWindow.HTMLCanvasElement.prototype`, avant que le
  // script de contenu ait démarré dans ce cadre. On emballe le cadre au moment où la page demande sa fenêtre. Un cadre d'un autre
  // site (accès refusé) a son propre script de contenu.
  for (const ctor of [window.HTMLIFrameElement, window.HTMLFrameElement, window.HTMLObjectElement, window.HTMLEmbedElement]) {
    if (!ctor) continue;
    wrapGetter(ctor.prototype, "contentWindow", (orig, self, args) => {
      const w = orig.apply(self, args);
      if (w && state.enabled && !state.siteOff) patchWindow(w);
      return w;
    });
    wrapGetter(ctor.prototype, "contentDocument", (orig, self, args) => {
      const d = orig.apply(self, args);
      if (d && d.defaultView && state.enabled && !state.siteOff) patchWindow(d.defaultView);
      return d;
    });
  }

  // --- WebRTC : adresses privées remplacées par un nom .local (désactivé par défaut) ---
  const PRIVATE_IP = /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g;
  if (window.RTCIceCandidate) {
    for (const name of ["candidate", "address"]) {
      wrapGetter(RTCIceCandidate.prototype, name, (orig, self, args) => {
        const v = orig.apply(self, args);
        if (!active("webrtc") || typeof v !== "string") return v;
        return v.replace(PRIVATE_IP, (ip) => {
          hit("webrtc");
          // Dérivé de la clé du site : le même nom d'un site à l'autre permettrait de relier les visites.
          const h = hash32(siteKey() + "|ice|" + ip).toString(16).padStart(8, "0");
          return `${h}-0000-4000-8000-000000000000.local`;
        });
      });
    }
  }

  // WebRTC en relais seulement : l'adresse publique n'est plus révélée aux pairs, mais sans serveur TURN l'appel
  // échoue, donc c'est un réglage à activer à la main (désactivé par défaut, Meet et Teams doivent marcher).
  if (window.RTCPeerConnection) {
    const NativeRTC = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(NativeRTC, {
      construct(target, args, newTarget) {
        if (active("webrtcRelay")) {
          hit("webrtc");
          args = [{ ...(args[0] && typeof args[0] === "object" ? args[0] : {}), iceTransportPolicy: "relay" }, ...args.slice(1)];
        }
        return Reflect.construct(target, args, newTarget === window.RTCPeerConnection ? target : newTarget);
      },
    });
  }

  // Workers : le noyau y est copié (voir noise-core.js), avec la clé du site. Un script en blob: passe par un blob d'amorçage ;
  // un script en http(s): reçoit le noyau en tête de sa réponse (background/workers.js), la configuration voyant dans le nom du worker.
  const workerConfig = () => ({
    k: siteKey(),
    l: state.level,
    f: Object.fromEntries(["canvas", "webgl", "audio", "hardware", "fonts", "screen", "extra", "gpc"].map((f) => [f, active(f)])),
  });
  const workerPatchable = () => state.enabled && !state.siteOff && typeof core.workerSource === "function";
  function patchedWorkerArgs(args, isShared) {
    const raw = args[0];
    const url = String(raw);
    const optsIsName = isShared && typeof args[1] === "string";
    const opts = !optsIsName && args[1] && typeof args[1] === "object" ? { ...args[1] } : {};
    if (/^blob:/i.test(url)) {
      const module = opts.type === "module";
      const boot = core.workerSource(workerConfig());
      const code = module ? boot.replace(/^;/, "") + `await import(${JSON.stringify(url)});` : boot + `importScripts(${JSON.stringify(url)});`;
      const wrapped = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      return [wrapped, ...args.slice(1)];
    }
    if (!/^(https?:|\/|\.|[^:]*$)/i.test(url)) return args; // data: et le reste : laissé tel quel
    const tagged = core.workerName(workerConfig(), optsIsName ? args[1] : opts.name);
    if (optsIsName) return [raw, tagged, ...args.slice(2)];
    return [raw, { ...opts, name: tagged }, ...args.slice(2)];
  }

  // Un script d'un autre domaine qui lance beaucoup de workers d'un coup : signature d'un mineur de cryptomonnaie
  // caché, ou d'un calcul d'empreinte lourd. Six workers ou plus suffisent à le classer « pisteur probable » (5 points).
  const MANY_WORKERS = 6;
  const workersBy = {};
  for (const name of ["Worker", "SharedWorker"]) {
    const Native = window[name];
    if (!Native) continue;
    const proxy = new Proxy(Native, {
      construct(target, args, newTarget) {
        try {
          const src = callerSite();
          if (src !== ownSite && (workersBy[src] = (workersBy[src] || 0) + 1) >= MANY_WORKERS) mark(src, "workers");
        } catch (_) {}
        try {
          if (workerPatchable()) args = patchedWorkerArgs(args, name === "SharedWorker");
        } catch (_) {}
        return Reflect.construct(target, args, newTarget === proxy ? target : newTarget);
      },
    });
    window[name] = proxy;
  }

  // --- presse-papiers : commandes piégées (ClickFix) et adresses remplacées -------------------------------------
  // Une fausse page de vérification copie dans ton presse-papiers une commande PowerShell ou shell, puis te demande de la
  // coller dans Windows+R ou un terminal. Un script malveillant peut aussi remplacer l'adresse de portefeuille ou l'IBAN
  // que tu viens de copier. Le détail de la détection est dans src/shared/clipboard.js.
  const clip = window.__fshClipboard;
  delete window.__fshClipboard; // la page ne doit pas voir ce nom
  if (clip) {
    const tell = (kind, text) => {
      if (nonce) window.dispatchEvent(new CustomEvent(EVT + "-alert", { detail: JSON.stringify({ n: nonce, kind, text: String(text).slice(0, 4000) }) }));
    };
    const pageText = () => {
      try {
        return ((document.body && document.body.innerText) || "").slice(0, 20000);
      } catch (_) {
        return "";
      }
    };

    wrapMethod(window.Clipboard && Clipboard.prototype, "writeText", (orig, self, args) => {
      if (active("scams") && typeof args[0] === "string") {
        const kind = clip.risk(args[0], pageText());
        if (kind) {
          tell(kind, args[0]);
          return Promise.resolve(); // la page croit avoir copié
        }
      }
      return orig.apply(self, args);
    });

    wrapMethod(Document.prototype, "execCommand", (orig, self, args) => {
      if (active("scams") && /^(copy|cut)$/i.test(String(args[0]))) {
        const selected = String(getSelection());
        const kind = clip.risk(selected, pageText());
        if (kind) {
          tell(kind, selected);
          return true;
        }
      }
      return orig.apply(self, args);
    });

    // Remplacement de ce qui est copié : au moment d'un événement copy, la page appelle setData avec autre chose que la sélection.
    let selectedAtCopy = null;
    for (const type of ["copy", "cut"]) {
      document.addEventListener(
        type,
        () => {
          try {
            selectedAtCopy = String(getSelection());
          } catch (_) {
            selectedAtCopy = "";
          }
          realSetTimeout(() => (selectedAtCopy = null), 0);
        },
        true
      );
    }
    wrapMethod(window.DataTransfer && DataTransfer.prototype, "setData", (orig, self, args) => {
      // Un lien de suivi ajouté au texte copié : on remet seulement ce que tu as sélectionné, sans bruit.
      if (selectedAtCopy && active("cleanCopy") && /^(text\/plain|text)$/i.test(String(args[0])) && clip.appended(selectedAtCopy, args[1])) {
        tell("trimmed", "");
        return orig.call(self, args[0], selectedAtCopy);
      }
      if (selectedAtCopy && active("scams") && /^(text\/plain|text)$/i.test(String(args[0])) && clip.hijack(selectedAtCopy, args[1])) {
        tell("hijack", args[1]);
        return orig.call(self, args[0], selectedAtCopy); // on remet ce que tu as réellement copié
      }
      return orig.apply(self, args);
    });
  }

  // --- fuites vers les sites ---------------------------------------------------
  wrapMethod(navProto, "sendBeacon", (orig, self, args) => {
    if (active("beacon")) {
      try {
        const u = new URL(args[0], location.href);
        if (siteOf(u.hostname) !== siteOf(location.hostname)) {
          hit("beacon");
          return true; // le site croit que l'envoi a réussi
        }
      } catch (_) {}
    }
    return orig.apply(self, args);
  });

  // --- navigation interne des applis (pushState/replaceState) : paramètres de suivi retirés ---
  const TRACKING = /^(utm_[a-z0-9_]+|hsa_[a-z0-9_]+|mtm_[a-z0-9_]+|fbclid|gclid|gclsrc|gbraid|wbraid|dclid|gad_source|gad_campaignid|srsltid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|igsh|mc_eid|mc_cid|_hsenc|_hsmi|mkt_tok|vero_id|ocid|_gl|mibextid|pk_(campaign|kwd|source|medium|content)|wickedid|oly_anon_id|oly_enc_id|rb_clickid|s_cid|sc_cid|trkinfo|ef_id|s_kwcid|zanpid|ref_src|ref_url)$/i;
  for (const name of ["pushState", "replaceState"]) {
    wrapMethod(window.History && History.prototype, name, (orig, self, args) => {
      if (active("cleanUrls") && typeof args[2] === "string") {
        try {
          const u = new URL(args[2], location.href);
          const keys = [...u.searchParams.keys()].filter((k) => TRACKING.test(k));
          if (keys.length) {
            keys.forEach((k) => u.searchParams.delete(k));
            args = [args[0], args[1], u.href];
            hit("cleanUrls");
          }
        } catch (_) {}
      }
      return orig.apply(self, args);
    });
  }

  // --- nuisances : permissions et popups ---------------------------------------
  if (window.Notification) {
    wrapMethod(Notification, "requestPermission", (orig, self, args) => {
      if (!active("perms")) return orig.apply(self, args);
      hit("perms");
      if (typeof args[0] === "function") args[0]("denied");
      return Promise.resolve("denied");
    });
  }
  if (window.Geolocation) {
    const denied = {
      code: 1,
      message: "User denied Geolocation",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    };
    const refuse = (orig, self, args) => {
      if (!active("perms")) return orig.apply(self, args);
      hit("perms");
      if (typeof args[1] === "function") realSetTimeout(() => args[1](denied), 0);
      return 1;
    };
    wrapMethod(Geolocation.prototype, "getCurrentPosition", refuse);
    wrapMethod(Geolocation.prototype, "watchPosition", refuse);
  }
  wrapMethod(window, "open", (orig, self, args) => {
    const ua = navigator.userActivation;
    if (active("popups") && ua && !ua.isActive) {
      hit("popups");
      return null;
    }
    // Lien ouvert par script (window.open) : paramètres de suivi retirés avant l'ouverture.
    if (active("cleanUrls") && typeof args[0] === "string") {
      try {
        const u = new URL(args[0], location.href);
        const keys = [...u.searchParams.keys()].filter((k) => TRACKING.test(k));
        if (keys.length) {
          keys.forEach((k) => u.searchParams.delete(k));
          args = [u.href, ...args.slice(1)];
          hit("cleanUrls");
        }
      } catch (_) {}
    }
    return orig.apply(self, args);
  });
})();
