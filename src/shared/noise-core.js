// Noyau du brouillage, indépendant de la page : fshCore(window, env) emballe les API d'empreinte de la fenêtre
// (ou du worker) `window`. Il est appliqué à trois endroits, avec le même code :
//   1. la page elle-même (inject.js) ;
//   2. les cadres créés par la page, avant qu'elle puisse les lire (inject.js, contentWindow) ;
//   3. les Web Workers et Shared Workers, où le code de cette fonction est copié en tête du script (background/workers.js
//      et inject.js pour les workers blob), puisque les scripts de contenu n'y entrent pas.
// Pour le point 3, la fonction est recopiée en texte : elle ne doit rien utiliser qui vienne de l'extérieur, sauf `env`.
//   env.key()      clé de brouillage du site principal
//   env.active(f)  la fonction f est-elle active
//   env.strong(f)  active et niveau renforcé
//   env.hit(f)     compte une lecture brouillée
(function () {
function fshCore(window, env) {
  "use strict";
  const isWorker = typeof window.document === "undefined";
  const PROBE = Symbol.for("fsh-probe-9d41");
  const KEYREQ = Symbol.for("fsh-key-9d41");

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
  const rngFor = (tag) => mulberry32(hash32(env.key() + "|" + tag));
  const { active, strong, hit } = env;

  // Remplace une méthode par un Proxy : toString() reste "[native code]", name/length conservés.
  function wrapMethod(proto, name, handler) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== "function") return;
    const proxy = new Proxy(desc.value, {
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
        if (args.length === 1) {
          if (args[0] === PROBE) return PROBE; // « cette fenêtre est déjà emballée » (voir inject.js)
          if (args[0] === KEYREQ && env.share) {
            const shared = env.share(); // état donné à un cadre du même site, seulement à inject.js
            if (shared !== undefined) return shared;
          }
        }
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
        const c = i + (((r * 24) | 0) % 3);
        data[c] = Math.max(0, Math.min(255, data[c] + (r < 0.0625 ? 1 : -1)));
      }
    }
  }

  // Le canvas d'une page (HTMLCanvasElement) et celui d'un worker ou d'un OffscreenCanvas se traitent pareil.
  const kinds = [];
  if (window.CanvasRenderingContext2D && window.HTMLCanvasElement) {
    kinds.push({ ctx: window.CanvasRenderingContext2D.prototype, canvas: window.HTMLCanvasElement.prototype, encode: ["toDataURL", "toBlob"], offscreen: false });
  }
  if (window.OffscreenCanvasRenderingContext2D && window.OffscreenCanvas) {
    kinds.push({ ctx: window.OffscreenCanvasRenderingContext2D.prototype, canvas: window.OffscreenCanvas.prototype, encode: ["convertToBlob"], offscreen: true });
  }

  // Le bruit ne doit toucher que les canvas qui ressemblent à de l'empreinte (texte, formes).
  // Un canvas qui reçoit une vidéo ou une grande image sert à afficher : le brouiller se voit,
  // et le bruit s'accumulerait si le site relit puis réécrit l'image en boucle.
  const mediaCanvases = new WeakSet();
  const MAX_NOISE_PIXELS = 300000;
  const noisable = (canvas, pixels) =>
    !(canvas && mediaCanvases.has(canvas)) && (pixels || (canvas ? canvas.width * canvas.height : 0)) <= MAX_NOISE_PIXELS;

  for (const kind of kinds) {
    const origGetContext = Object.getOwnPropertyDescriptor(kind.canvas, "getContext").value;
    const origGetImageData = kind.ctx.getImageData;
    const origPutImageData = kind.ctx.putImageData;
    const origDrawImage = kind.ctx.drawImage;

    wrapMethod(kind.ctx, "drawImage", (orig, self, args) => {
      try {
        const src = args[0];
        if (
          (window.HTMLVideoElement && src instanceof window.HTMLVideoElement) ||
          (window.ImageBitmap && src instanceof window.ImageBitmap) ||
          (window.HTMLImageElement && src instanceof window.HTMLImageElement && src.naturalWidth * src.naturalHeight >= 16384)
        ) {
          mediaCanvases.add(self.canvas);
        }
      } catch (_) {}
      return orig.apply(self, args);
    });

    // Copie du canvas avec bruit : l'original affiché à l'écran n'est jamais modifié.
    const noisyCopy = (canvas) => {
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return null;
      try {
        let copy;
        if (kind.offscreen) copy = new window.OffscreenCanvas(w, h);
        else {
          copy = window.document.createElement("canvas");
          copy.width = w;
          copy.height = h;
        }
        const c = origGetContext.call(copy, "2d");
        origDrawImage.call(c, canvas, 0, 0);
        const img = origGetImageData.call(c, 0, 0, w, h);
        noisePixels(img.data);
        origPutImageData.call(c, img, 0, 0);
        return copy;
      } catch (_) {
        return null;
      }
    };

    for (const name of kind.encode) {
      wrapMethod(kind.canvas, name, (orig, self, args) => {
        if (active("canvas") && noisable(self)) {
          const copy = noisyCopy(self);
          if (copy) {
            hit("canvas");
            return orig.apply(copy, args);
          }
        }
        return orig.apply(self, args);
      });
    }

    wrapMethod(kind.ctx, "getImageData", (orig, self, args) => {
      const img = orig.apply(self, args);
      if (active("canvas") && noisable(self.canvas, img.width * img.height)) {
        noisePixels(img.data);
        hit("canvas");
      }
      return img;
    });

    // --- polices (mesure de texte) -------------------------------------------
    wrapMethod(kind.ctx, "measureText", (orig, self, args) => {
      const tm = orig.apply(self, args);
      if (!active("fonts")) return tm;
      hit("fonts");
      const r = mulberry32(hash32(env.key() + "|font|" + self.font + String(args[0])))();
      const delta = (r - 0.5) * 0.02; // ±0,01 px
      return new Proxy(tm, {
        get(t, k) {
          const v = Reflect.get(t, k, t);
          if (k === "width") return v + delta;
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
    });
  }

  // --- polices installées : FontFace avec local() -------------------------------------------------------------
  // `new FontFace("x", "local(Nom)").load()` échoue si la police n'est pas installée : une façon d'énumérer les polices sans
  // mesurer de texte. En niveau renforcé, une police uniquement locale n'est « trouvée » que si elle fait partie des polices
  // que presque tout le monde a. Une source qui contient aussi un url() reste intacte : le site a un repli.
  if (window.FontFace) {
    const COMMON = /^(arial|helvetica|times new roman|times|courier new|courier|verdana|georgia|tahoma|trebuchet ms|segoe ui|system-ui|sans-serif|serif|monospace|noto sans|dejavu sans|liberation sans|roboto|open sans)$/i;
    const sources = new WeakMap();
    const NativeFontFace = window.FontFace;
    const proxy = new Proxy(NativeFontFace, {
      construct(target, args, newTarget) {
        const face = Reflect.construct(target, args, newTarget === proxy ? target : newTarget);
        if (typeof args[1] === "string") sources.set(face, { family: String(args[0]), src: args[1] });
        return face;
      },
    });
    window.FontFace = proxy;
    try {
      Object.defineProperty(NativeFontFace.prototype, "constructor", { value: proxy, writable: true, configurable: true });
    } catch (_) {}
    wrapMethod(NativeFontFace.prototype, "load", (orig, self, args) => {
      const s = sources.get(self);
      if (s && strong("fonts") && /\blocal\(/i.test(s.src) && !/\burl\(/i.test(s.src)) {
        const names = [...s.src.matchAll(/local\(\s*["']?([^"')]+?)["']?\s*\)/gi)].map((m) => m[1].trim());
        if (names.length && !names.some((n) => COMMON.test(n))) {
          hit("fonts");
          return Promise.reject(new window.DOMException("A network error occurred.", "NetworkError"));
        }
      }
      return orig.apply(self, args);
    });
  }

  // --- WebGL ----------------------------------------------------------------
  const isFirefox = /Firefox\//.test(window.navigator.userAgent);
  const GL_VENDOR = isFirefox ? "Intel" : "Google Inc. (Intel)";
  const GL_RENDERER = isFirefox ? "Mesa Intel(R) UHD Graphics (CML GT2)" : "ANGLE (Intel, Mesa Intel(R) UHD Graphics (CML GT2), OpenGL 4.6)";
  // Profil « Intel UHD » : le nom annoncé doit aller avec les limites. Un « Intel » qui a les limites d'une carte NVIDIA saute aux
  // yeux. On annonce le plus petit de la valeur réelle et de celle du profil : jamais plus que ce que la carte sait faire, donc rien ne casse.
  const GL_LIMITS = {
    0x0d33: 16384, // MAX_TEXTURE_SIZE
    0x851c: 16384, // MAX_CUBE_MAP_TEXTURE_SIZE
    0x84e8: 16384, // MAX_RENDERBUFFER_SIZE
    0x8869: 16, // MAX_VERTEX_ATTRIBS
    0x8dfb: 1024, // MAX_VERTEX_UNIFORM_VECTORS
    0x8dfd: 1024, // MAX_FRAGMENT_UNIFORM_VECTORS
    0x8dfc: 30, // MAX_VARYING_VECTORS
    0x8872: 16, // MAX_TEXTURE_IMAGE_UNITS
    0x8b4d: 32, // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    0x8b4c: 16, // MAX_VERTEX_TEXTURE_IMAGE_UNITS
    0x8073: 2048, // MAX_3D_TEXTURE_SIZE (WebGL 2)
    0x88ff: 2048, // MAX_ARRAY_TEXTURE_LAYERS
    0x8d57: 8, // MAX_SAMPLES
    0x8824: 8, // MAX_DRAW_BUFFERS
    0x8cdf: 8, // MAX_COLOR_ATTACHMENTS
    0x8a2f: 24, // MAX_UNIFORM_BUFFER_BINDINGS
  };
  const GL_VIEWPORT = 0x0d3a; // MAX_VIEWPORT_DIMS, deux entiers
  const GL_EXTENSIONS = new Set(
    (
      "ANGLE_instanced_arrays EXT_blend_minmax EXT_color_buffer_float EXT_color_buffer_half_float EXT_float_blend EXT_frag_depth " +
      "EXT_shader_texture_lod EXT_sRGB EXT_texture_compression_bptc EXT_texture_compression_rgtc EXT_texture_filter_anisotropic " +
      "EXT_texture_norm16 EXT_disjoint_timer_query EXT_disjoint_timer_query_webgl2 OES_element_index_uint OES_fbo_render_mipmap " +
      "OES_standard_derivatives OES_texture_float OES_texture_float_linear OES_texture_half_float OES_texture_half_float_linear " +
      "OES_vertex_array_object OVR_multiview2 KHR_parallel_shader_compile WEBGL_color_buffer_float WEBGL_compressed_texture_s3tc " +
      "WEBGL_compressed_texture_s3tc_srgb WEBGL_debug_renderer_info WEBGL_debug_shaders WEBGL_depth_texture WEBGL_draw_buffers " +
      "WEBGL_lose_context WEBGL_multi_draw WEBGL_provoking_vertex EXT_clip_cull_distance"
    ).split(" ")
  );
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!ctor) continue;
    wrapMethod(ctor.prototype, "getParameter", (orig, self, args) => {
      const real = orig.apply(self, args);
      if (!active("webgl")) return real;
      const p = args[0];
      if (p === 0x9245) {
        hit("webgl");
        return GL_VENDOR; // UNMASKED_VENDOR_WEBGL
      }
      if (p === 0x9246) {
        hit("webgl");
        return GL_RENDERER; // UNMASKED_RENDERER_WEBGL
      }
      if (p in GL_LIMITS && typeof real === "number") return Math.min(real, GL_LIMITS[p]);
      if (p === GL_VIEWPORT && real && real.length === 2) return new Int32Array([Math.min(real[0], 16384), Math.min(real[1], 16384)]);
      return real;
    });
    wrapMethod(ctor.prototype, "getSupportedExtensions", (orig, self, args) => {
      const real = orig.apply(self, args);
      if (!active("webgl") || !Array.isArray(real)) return real;
      return real.filter((n) => GL_EXTENSIONS.has(n));
    });
    wrapMethod(ctor.prototype, "getExtension", (orig, self, args) => {
      if (active("webgl") && typeof args[0] === "string" && !GL_EXTENSIONS.has(args[0])) return null;
      return orig.apply(self, args);
    });
    wrapMethod(ctor.prototype, "readPixels", (orig, self, args) => {
      const ret = orig.apply(self, args);
      const buf = args[6];
      if (active("webgl") && buf instanceof window.Uint8Array && buf.length <= 400000) {
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
    wrapMethod(window.AudioBuffer.prototype, "getChannelData", (orig, self, args) => {
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
    wrapMethod(window.AudioBuffer.prototype, "copyFromChannel", (orig, self, args) => {
      const ret = orig.apply(self, args);
      if (active("audio")) {
        noiseFloats(args[0], "audio-copy" + args[1]);
        hit("audio");
      }
      return ret;
    });
  }
  if (window.AnalyserNode) {
    wrapMethod(window.AnalyserNode.prototype, "getFloatFrequencyData", (orig, self, args) => {
      const ret = orig.apply(self, args);
      if (active("audio")) {
        noiseFloats(args[0], "analyser");
        hit("audio");
      }
      return ret;
    });
  }

  // --- matériel -------------------------------------------------------------
  // Les cœurs et la mémoire annoncés sont plafonnés. Ils ne peuvent pas aller avec la vitesse mesurée d'un calcul ou le nombre de workers
  // réellement lancés en parallèle (on ne ralentit pas la machine) : c'est une limite connue, voir le README.
  const navProto = window.WorkerNavigator ? window.WorkerNavigator.prototype : window.Navigator && window.Navigator.prototype;
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

  // --- stockage : le quota dépend de la taille du disque ----------------------------------------------------------
  if (window.StorageManager) {
    wrapMethod(window.StorageManager.prototype, "estimate", (orig, self, args) => {
      const p = orig.apply(self, args);
      if (!active("extra")) return p;
      return p.then((e) => {
        hit("extra");
        const QUOTA = 8 * 1024 ** 3;
        const usage = Math.min(Math.ceil((e.usage || 0) / 1048576) * 1048576, QUOTA);
        return { quota: QUOTA, usage };
      });
    });
  }

  // --- langues (niveau renforcé uniquement) ---------------------------------------------------------------------
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

  if (isWorker) return; // la suite concerne le document : écran, rectangles, voix, batterie

  // --- écran (niveau renforcé uniquement) ------------------------------------------------------------------------
  // Écran arrondi à la taille standard supérieure : jamais plus petit que la fenêtre réelle.
  const SIZES = [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160]];
  // Téléphone (écran tactile étroit) : tailles CSS courantes, jamais plus petites que la vraie. Sinon un 412×915 deviendrait un
  // 1920×1080 avec un doigt pour souris, ce qui se remarque tout de suite.
  const PHONE_SIZES = [[360, 640], [360, 740], [360, 800], [375, 667], [390, 844], [393, 873], [412, 915], [414, 896], [430, 932]];
  const isPhone = (w, h) => window.navigator.maxTouchPoints > 0 && Math.min(w, h) <= 500;
  const pickSize = (w, h) => {
    if (isPhone(w, h)) {
      const portrait = h >= w;
      const [a, b] = portrait ? [w, h] : [h, w];
      const hit = PHONE_SIZES.find(([sw, sh]) => sw >= a && sh >= b);
      if (hit) return portrait ? hit : [hit[1], hit[0]];
      return [w, h];
    }
    return SIZES.find(([sw, sh]) => sw >= w && sh >= h) || [w, h];
  };
  const screenProto = window.Screen && window.Screen.prototype;
  let fakeScreen = null;
  if (screenProto) {
    const origGetters = {};
    for (const n of ["width", "height", "availWidth", "availHeight"]) {
      origGetters[n] = Object.getOwnPropertyDescriptor(screenProto, n).get; // avant emballage
    }
    const real = (n) => origGetters[n].call(window.screen);
    fakeScreen = () => {
      const w = real("width");
      const h = real("height");
      const [fw, fh] = pickSize(w, h);
      return { width: fw, height: fh, availWidth: fw, availHeight: fh - (h - real("availHeight")) };
    };
    for (const name of ["width", "height", "availWidth", "availHeight"]) {
      wrapGetter(screenProto, name, (orig, self, args) => {
        if (!strong("screen")) return orig.apply(self, args);
        hit("screen");
        return fakeScreen()[name];
      });
    }
    for (const name of ["colorDepth", "pixelDepth"]) {
      wrapGetter(screenProto, name, (orig, self, args) => {
        if (!strong("screen")) return orig.apply(self, args);
        return 24;
      });
    }
  }

  // --- requêtes CSS : alignées sur l'écran annoncé ---------------------------------------------------------------
  // `matchMedia("(device-width: 1920px)")` donnait la vraie taille alors que screen.width est arrondi : un site compare les deux.
  // Seules les requêtes simples sont traitées (conditions device-width/height reliées par « and », gamut, plage dynamique) ;
  // le reste passe tel quel. Une feuille de style qui choisit une image selon la taille de l'écran reste hors de portée.
  if (window.MediaQueryList && fakeScreen) {
    const DIM = /\(\s*(min-|max-)?device-(width|height)\s*:\s*([\d.]+)px\s*\)/g;
    const GAMUT = /^\(\s*color-gamut\s*:\s*(srgb|p3|rec2020)\s*\)$/;
    const RANGE = /^\(\s*dynamic-range\s*:\s*(standard|high)\s*\)$/;
    const evaluate = (query) => {
      const q = String(query).trim().toLowerCase();
      const g = GAMUT.exec(q);
      if (g) return g[1] === "srgb";
      const r = RANGE.exec(q);
      if (r) return r[1] === "standard";
      const rest = q.replace(DIM, " ").replace(/\b(only|screen|all|and)\b/g, " ").trim();
      if (rest || !DIM.test(q)) return null;
      DIM.lastIndex = 0;
      const fake = fakeScreen();
      let ok = true;
      for (const m of q.matchAll(DIM)) {
        const v = fake[m[2]];
        const n = parseFloat(m[3]);
        ok = ok && (m[1] === "min-" ? v >= n : m[1] === "max-" ? v <= n : v === n);
      }
      return ok;
    };
    wrapGetter(window.MediaQueryList.prototype, "matches", (orig, self, args) => {
      const real = orig.apply(self, args);
      if (!strong("screen")) return real;
      const v = evaluate(self.media);
      if (v === null) return real;
      hit("screen");
      return v;
    });
  }

  // --- capteurs de mouvement (téléphone) -----------------------------------------------------------------------
  // L'accéléromètre et le gyroscope ont un biais propre à chaque appareil, stable et mesurable : une empreinte qui survit aux
  // réinitialisations. Les valeurs sont arrondies assez grossièrement pour que ce biais disparaisse, pas assez pour gêner un jeu
  // ou une boussole (0,1 m/s², 0,5 degré).
  const roundTo = (v, step) => (typeof v === "number" ? +(Math.round(v / step) * step).toFixed(3) : v);
  if (window.DeviceMotionEvent) {
    const P = window.DeviceMotionEvent.prototype;
    const rounded = (src, step, keys) => {
      if (!src) return src;
      const o = {};
      for (const k of keys) o[k] = roundTo(src[k], step);
      return Object.freeze(o);
    };
    const cache = new WeakMap();
    for (const [name, step, keys] of [
      ["acceleration", 0.1, ["x", "y", "z"]],
      ["accelerationIncludingGravity", 0.1, ["x", "y", "z"]],
      ["rotationRate", 0.5, ["alpha", "beta", "gamma"]],
    ]) {
      wrapGetter(P, name, (orig, self, args) => {
        const real = orig.apply(self, args);
        if (!active("extra") || !real) return real;
        hit("extra");
        let per = cache.get(self);
        if (!per) cache.set(self, (per = {}));
        return per[name] || (per[name] = rounded(real, step, keys));
      });
    }
  }
  if (window.DeviceOrientationEvent) {
    for (const name of ["alpha", "beta", "gamma"]) {
      wrapGetter(window.DeviceOrientationEvent.prototype, name, (orig, self, args) => {
        const real = orig.apply(self, args);
        if (!active("extra") || typeof real !== "number") return real;
        hit("extra");
        return roundTo(real, 0.5);
      });
    }
  }

  // Rectangles DOM : décalage d'environ 0,001 px, invisible mais qui change la signature.
  wrapMethod(window.Element && window.Element.prototype, "getBoundingClientRect", (orig, self, args) => {
    const r = orig.apply(self, args);
    if (!strong("rects")) return r;
    const d = (mulberry32(hash32(env.key() + "|rect|" + r.width.toFixed(2) + r.height.toFixed(2)))() - 0.5) * 0.002;
    return new window.DOMRect(r.x + d, r.y + d, r.width + d, r.height + d);
  });

  // --- divers : voix de synthèse, batterie -----------------------------------
  if (window.SpeechSynthesis) {
    wrapMethod(window.SpeechSynthesis.prototype, "getVoices", (orig, self, args) => {
      if (!active("extra")) return orig.apply(self, args);
      hit("extra");
      return [];
    });
  }
  wrapMethod(navProto, "getBattery", (orig, self, args) => {
    if (!active("extra")) return orig.apply(self, args);
    hit("extra");
    return Promise.reject(new window.DOMException("Battery status is not available.", "NotAllowedError"));
  });
}

// --- workers -----------------------------------------------------------------------------------------------------
// Un worker démarre sans script de contenu. Deux voies, selon l'origine de son script :
//  - script en blob: : inject.js crée un blob qui lance le noyau puis charge l'original (importScripts) ;
//  - script en http(s): : background/workers.js copie le même texte en tête de la réponse. La configuration voyage dans le nom
//    du worker (qui n'est lu que par le worker), que le texte remet ensuite à sa vraie valeur.
// cfg = { k: clé du site, l: niveau, f: { canvas, webgl, ... } }
const CORE_SOURCE = Function.prototype.toString.call(fshCore);
const TAG = "\u0001FSH9d41:";
fshCore.workerName = (cfg, name) => TAG + encodeURIComponent(JSON.stringify(cfg)) + "\u0001" + (name || "");
fshCore.workerSource = (baked) => {
  const read = baked
    ? "var c=" + JSON.stringify(baked) + ";"
    : "var n=self.name;var T=" + JSON.stringify(TAG) + ";if(typeof n!=='string'||n.indexOf(T)!==0)return;" +
      "var e=n.indexOf('\\u0001',T.length);var c=JSON.parse(decodeURIComponent(n.slice(T.length,e)));var o=n.slice(e+1);" +
      "Object.defineProperty(self,'name',{get:function(){return o},configurable:true});";
  return (
    ";(function(){try{" + read + "(" + CORE_SOURCE + ")(self,{key:function(){return c.k},active:function(f){return !!c.f[f]}," +
    "strong:function(f){return !!c.f[f]&&c.l==='renforce'},hit:function(){}});}catch(_){}})();"
  );
};

// Rien ne doit rester dans l'espace global de la page. Le monde de la page reçoit la fonction sous un nom que inject.js reprend
// puis efface ; l'arrière-plan la garde sous `fshCore` et en copie le texte en tête des scripts de worker.
globalThis[typeof browser === "undefined" ? "__fshCore" : "fshCore"] = fshCore;
})();
