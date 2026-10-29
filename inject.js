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
      rects: true, extra: true, webrtc: false, beacon: true, perms: true, popups: true, cleanUrls: true, gpc: true,
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
  const provisional = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
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
  const WEIGHT = { canvas: 3, audio: 3, webgl: 2, webrtc: 2, fonts: 1, rects: 1, extra: 1, screen: 0.5, hardware: 0.5 };
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
    const src = lastSrc[feature];
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

  // --- canvas ---------------------------------------------------------------
  // Modifie ~1 pixel sur 8 de ±1 sur un canal. Même motif à chaque appel.
  function noisePixels(data) {
    const rnd = rngFor("canvas");
    for (let i = 0; i < data.length; i += 4) {
      const r = rnd();
      if (r < 0.125) {
        const c = i + ((r * 24) | 0) % 3;
        data[c] = Math.max(0, Math.min(255, data[c] + (r < 0.0625 ? 1 : -1)));
      }
    }
  }

  const ctx2dProto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  const canvasProto = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  const origGetImageData = ctx2dProto && ctx2dProto.getImageData;
  const origPutImageData = ctx2dProto && ctx2dProto.putImageData;
  const origDrawImage = ctx2dProto && ctx2dProto.drawImage;
  const origGetContext = canvasProto && canvasProto.getContext;

  // Le bruit ne doit toucher que les canvas qui ressemblent à de l'empreinte (texte, formes).
  // Un canvas qui reçoit une vidéo ou une grande image sert à afficher : le brouiller se voit,
  // et le bruit s'accumulerait si le site relit puis réécrit l'image en boucle.
  const mediaCanvases = new WeakSet();
  const MAX_NOISE_PIXELS = 300000;
  const noisable = (canvas, pixels) =>
    !(canvas && mediaCanvases.has(canvas)) && (pixels || (canvas ? canvas.width * canvas.height : 0)) <= MAX_NOISE_PIXELS;

  wrapMethod(ctx2dProto, "drawImage", (orig, self, args) => {
    try {
      const src = args[0];
      if (
        src instanceof HTMLVideoElement ||
        (window.ImageBitmap && src instanceof ImageBitmap) ||
        (src instanceof HTMLImageElement && src.naturalWidth * src.naturalHeight >= 16384)
      ) {
        mediaCanvases.add(self.canvas);
      }
    } catch (_) {}
    return orig.apply(self, args);
  });

  // Copie du canvas avec bruit : l'original affiché à l'écran n'est jamais modifié.
  function noisyCopy(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return null;
    try {
      const copy = document.createElement("canvas");
      copy.width = w;
      copy.height = h;
      const c = origGetContext.call(copy, "2d");
      origDrawImage.call(c, canvas, 0, 0);
      const img = origGetImageData.call(c, 0, 0, w, h);
      noisePixels(img.data);
      origPutImageData.call(c, img, 0, 0);
      return copy;
    } catch (_) {
      return null;
    }
  }

  wrapMethod(canvasProto, "toDataURL", (orig, self, args) => {
    if (active("canvas") && noisable(self)) {
      const copy = noisyCopy(self);
      if (copy) {
        hit("canvas");
        return orig.apply(copy, args);
      }
    }
    return orig.apply(self, args);
  });

  wrapMethod(canvasProto, "toBlob", (orig, self, args) => {
    if (active("canvas") && noisable(self)) {
      const copy = noisyCopy(self);
      if (copy) {
        hit("canvas");
        return orig.apply(copy, args);
      }
    }
    return orig.apply(self, args);
  });

  wrapMethod(ctx2dProto, "getImageData", (orig, self, args) => {
    const img = orig.apply(self, args);
    if (active("canvas") && noisable(self.canvas, img.width * img.height)) {
      noisePixels(img.data);
      hit("canvas");
    }
    return img;
  });

  // --- polices (mesure de texte) -------------------------------------------
  wrapMethod(ctx2dProto, "measureText", (orig, self, args) => {
    const tm = orig.apply(self, args);
    if (!active("fonts")) return tm;
    hit("fonts");
    const r = mulberry32(hash32(siteKey() + "|font|" + self.font + String(args[0])))();
    const delta = (r - 0.5) * 0.02; // ±0,01 px
    return new Proxy(tm, {
      get(t, k) {
        const v = Reflect.get(t, k, t);
        if (k === "width") return v + delta;
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  });

  // --- WebGL ----------------------------------------------------------------
  const isFirefox = /Firefox\//.test(navigator.userAgent);
  const GL_VENDOR = isFirefox ? "Intel" : "Google Inc. (Intel)";
  const GL_RENDERER = isFirefox
    ? "Mesa Intel(R) UHD Graphics (CML GT2)"
    : "ANGLE (Intel, Mesa Intel(R) UHD Graphics (CML GT2), OpenGL 4.6)";
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!ctor) continue;
    wrapMethod(ctor.prototype, "getParameter", (orig, self, args) => {
      if (active("webgl")) {
        if (args[0] === 0x9245) {
          hit("webgl");
          return GL_VENDOR; // UNMASKED_VENDOR_WEBGL
        }
        if (args[0] === 0x9246) {
          hit("webgl");
          return GL_RENDERER; // UNMASKED_RENDERER_WEBGL
        }
      }
      return orig.apply(self, args);
    });
    wrapMethod(ctor.prototype, "readPixels", (orig, self, args) => {
      const ret = orig.apply(self, args);
      const buf = args[6];
      if (active("webgl") && buf instanceof Uint8Array && buf.length <= 400000) {
        hit("webgl");
        const rnd = rngFor("webgl");
        for (let i = 0; i < buf.length; i += 4) {
          const r = rnd();
          if (r < 0.125) buf[i] = Math.max(0, Math.min(255, buf[i] + (r < 0.0625 ? 1 : -1)));
        }
      }
      return ret;
    });
  }

  // --- audio ----------------------------------------------------------------
  const noisedBuffers = new WeakSet();
  function noiseFloats(arr, tag) {
    const rnd = rngFor(tag);
    for (let i = 0; i < arr.length; i++) arr[i] += (rnd() - 0.5) * 2e-7;
  }

  if (window.AudioBuffer) {
    wrapMethod(AudioBuffer.prototype, "getChannelData", (orig, self, args) => {
      const data = orig.apply(self, args);
      if (active("audio")) {
        // un seul bruit par canal, sinon il s'accumulerait à chaque lecture
        const key = data.buffer;
        if (!noisedBuffers.has(key)) {
          noisedBuffers.add(key);
          noiseFloats(data, "audio" + args[0]);
          hit("audio");
        }
      }
      return data;
    });
    wrapMethod(AudioBuffer.prototype, "copyFromChannel", (orig, self, args) => {
      const ret = orig.apply(self, args);
      if (active("audio")) {
        noiseFloats(args[0], "audio-copy" + args[1]);
        hit("audio");
      }
      return ret;
    });
  }
  if (window.AnalyserNode) {
    wrapMethod(AnalyserNode.prototype, "getFloatFrequencyData", (orig, self, args) => {
      const ret = orig.apply(self, args);
      if (active("audio")) {
        noiseFloats(args[0], "analyser");
        hit("audio");
      }
      return ret;
    });
  }

  // --- matériel -------------------------------------------------------------
  const navProto = window.Navigator && Navigator.prototype;
  wrapGetter(navProto, "hardwareConcurrency", (orig, self, args) => {
    const real = orig.apply(self, args);
    if (!active("hardware")) return real;
    hit("hardware");
    return Math.min(real, 4);
  });
  wrapGetter(navProto, "deviceMemory", (orig, self, args) => {
    const real = orig.apply(self, args);
    if (!active("hardware") || real === undefined) return real;
    hit("hardware");
    return Math.min(real, 8);
  });

  // --- écran et langues (niveau renforcé uniquement) ------------------------
  // Écran arrondi à la taille standard supérieure : jamais plus petit que la fenêtre réelle.
  const strong = (f) => active(f) && state.level === "renforce";
  const SIZES = [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160]];
  const screenProto = window.Screen && Screen.prototype;
  if (screenProto) {
    const origGetters = {};
    for (const n of ["width", "height", "availWidth", "availHeight"]) {
      origGetters[n] = Object.getOwnPropertyDescriptor(screenProto, n).get; // avant emballage
    }
    const real = (n) => origGetters[n].call(screen);
    const fake = () => {
      const w = real("width");
      const h = real("height");
      const [fw, fh] = SIZES.find(([sw, sh]) => sw >= w && sh >= h) || [w, h];
      return { width: fw, height: fh, availWidth: fw, availHeight: fh - (h - real("availHeight")) };
    };
    for (const name of ["width", "height", "availWidth", "availHeight"]) {
      wrapGetter(screenProto, name, (orig, self, args) => {
        if (!strong("screen")) return orig.apply(self, args);
        hit("screen");
        return fake()[name];
      });
    }
    for (const name of ["colorDepth", "pixelDepth"]) {
      wrapGetter(screenProto, name, (orig, self, args) => {
        if (!strong("screen")) return orig.apply(self, args);
        return 24;
      });
    }
  }

  const langCache = new Map();
  wrapGetter(navProto, "languages", (orig, self, args) => {
    const langs = orig.apply(self, args);
    if (!strong("screen") || !langs || !langs.length) return langs;
    const key = langs.join(",");
    if (!langCache.has(key)) {
      const first = langs[0];
      langCache.set(key, Object.freeze([...new Set([first, first.split("-")[0]])]));
    }
    hit("screen");
    return langCache.get(key);
  });

  // Signal « ne pas vendre mes données » : l'en-tête Sec-GPC part de l'arrière-plan. Firefox expose aussi la
  // propriété (fausse par défaut) : on la met à vraie pour les sites qui la lisent en JavaScript.
  wrapGetter(navProto, "globalPrivacyControl", (orig, self, args) => (active("gpc") ? true : orig.apply(self, args)));

  // Rectangles DOM : décalage d'environ 0,001 px, invisible mais qui change la signature.
  const elProto = window.Element && Element.prototype;
  wrapMethod(elProto, "getBoundingClientRect", (orig, self, args) => {
    const r = orig.apply(self, args);
    if (!strong("rects")) return r;
    const d = (mulberry32(hash32(siteKey() + "|rect|" + r.width.toFixed(2) + r.height.toFixed(2)))() - 0.5) * 0.002;
    return new DOMRect(r.x + d, r.y + d, r.width + d, r.height + d);
  });

  // --- divers : voix de synthèse, batterie -----------------------------------
  if (window.SpeechSynthesis) {
    wrapMethod(SpeechSynthesis.prototype, "getVoices", (orig, self, args) => {
      if (!active("extra")) return orig.apply(self, args);
      hit("extra");
      return [];
    });
  }
  wrapMethod(navProto, "getBattery", (orig, self, args) => {
    if (!active("extra")) return orig.apply(self, args);
    hit("extra");
    return Promise.reject(new DOMException("Battery status is not available.", "NotAllowedError"));
  });

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
