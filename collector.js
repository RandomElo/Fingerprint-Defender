// Calcule une empreinte. Exécuté dans la page d'extension (valeurs réelles) et injecté dans
// l'onglet actif (valeurs vues par les sites, donc après brouillage).
window.__fshCollect = async function () {
  function hash(str) {
    // cyrb53
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  }
  const safe = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      return "indisponible";
    }
  };

  const nav = navigator;
  const sections = [];

  sections.push({
    title: "Navigateur",
    rows: [
      ["User-Agent", nav.userAgent],
      ["Plateforme", nav.platform],
      ["Langues", (nav.languages || [nav.language]).join(", ")],
      ["Fuseau horaire", Intl.DateTimeFormat().resolvedOptions().timeZone],
      ["Décalage UTC (min)", String(new Date().getTimezoneOffset())],
      ["Cœurs CPU", String(nav.hardwareConcurrency)],
      ["Mémoire (Go)", String(nav.deviceMemory)],
      ["Points tactiles", String(nav.maxTouchPoints)],
      ["Do Not Track", String(nav.doNotTrack)],
      ["Cookies activés", String(nav.cookieEnabled)],
      ["Plugins", String(nav.plugins ? nav.plugins.length : 0)],
      ["webdriver", String(nav.webdriver)],
    ],
  });

  sections.push({
    title: "Écran",
    rows: [
      ["Résolution", `${screen.width}x${screen.height}`],
      ["Zone disponible", `${screen.availWidth}x${screen.availHeight}`],
      ["Profondeur couleur", String(screen.colorDepth)],
      ["Ratio de pixels", String(window.devicePixelRatio)],
      ["Thème sombre", String(matchMedia("(prefers-color-scheme: dark)").matches)],
    ],
  });

  const canvasHash = await safe(() => {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 60;
    const g = c.getContext("2d");
    g.textBaseline = "alphabetic";
    g.fillStyle = "#f60";
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = "#069";
    g.font = "15px Arial";
    g.fillText("Fingerprint Shield, ça brouille 🛡", 2, 15);
    g.fillStyle = "rgba(102, 204, 0, 0.7)";
    g.font = "18px Times New Roman";
    g.fillText("Fingerprint Shield, ça brouille 🛡", 4, 40);
    return hash(c.toDataURL());
  });
  const textWidth = await safe(() => {
    const g = document.createElement("canvas").getContext("2d");
    g.font = "16px Arial";
    return String(g.measureText("mmmmmmmmmmlli").width);
  });
  sections.push({
    title: "Canvas",
    rows: [
      ["Hash image", canvasHash],
      ["Largeur de texte", textWidth],
    ],
  });

  const gl = await safe(() => {
    const c = document.createElement("canvas");
    const g = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!g) return null;
    const ext = g.getExtension("WEBGL_debug_renderer_info");
    g.viewport(0, 0, 16, 16);
    g.clearColor(0.2, 0.4, 0.6, 1);
    g.clear(g.COLOR_BUFFER_BIT);
    const px = new Uint8Array(16 * 16 * 4);
    g.readPixels(0, 0, 16, 16, g.RGBA, g.UNSIGNED_BYTE, px);
    return {
      vendor: ext ? g.getParameter(ext.UNMASKED_VENDOR_WEBGL) : g.getParameter(g.VENDOR),
      renderer: ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
      version: g.getParameter(g.VERSION),
      maxTex: g.getParameter(g.MAX_TEXTURE_SIZE),
      pixels: hash(Array.from(px).join(",")),
    };
  });
  sections.push({
    title: "WebGL",
    rows: gl && typeof gl === "object"
      ? [
          ["Fabricant", gl.vendor],
          ["Carte graphique", gl.renderer],
          ["Version", gl.version],
          ["Texture max", String(gl.maxTex)],
          ["Hash pixels", gl.pixels],
        ]
      : [["WebGL", "indisponible"]],
  });

  const audio = await safe(async () => {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);
    const buf = await ctx.startRendering();
    const data = buf.getChannelData(0);
    let sum = 0;
    for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
    return { sum: String(sum), hash: hash(Array.from(data.slice(4500)).join(",")) };
  });
  sections.push({
    title: "Audio",
    rows: audio && typeof audio === "object"
      ? [["Somme des échantillons", audio.sum], ["Hash", audio.hash]]
      : [["Audio", "indisponible"]],
  });

  const fonts = await safe(() => {
    const candidates = [
      "Arial", "Arial Black", "Calibri", "Cambria", "Comic Sans MS", "Consolas", "Courier New",
      "DejaVu Sans", "Futura", "Garamond", "Georgia", "Helvetica", "Impact", "Liberation Sans",
      "Lucida Console", "Menlo", "Monaco", "Noto Sans", "Palatino Linotype", "Roboto",
      "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Ubuntu", "Verdana",
    ];
    const bases = ["monospace", "sans-serif", "serif"];
    const span = document.createElement("span");
    span.style.cssText = "position:absolute;left:-9999px;font-size:72px;visibility:hidden";
    span.textContent = "mmmmmmmmmmlliWQ@";
    document.body.appendChild(span);
    const baseW = {};
    for (const b of bases) {
      span.style.fontFamily = b;
      baseW[b] = span.offsetWidth;
    }
    const found = candidates.filter((f) =>
      bases.some((b) => {
        span.style.fontFamily = `'${f}',${b}`;
        return span.offsetWidth !== baseW[b];
      })
    );
    span.remove();
    return found;
  });
  sections.push({
    title: "Polices",
    rows: Array.isArray(fonts)
      ? [["Détectées", `${fonts.length} / 26`], ["Liste", fonts.join(", ") || "aucune"]]
      : [["Polices", "indisponible"]],
  });

  const id = hash(JSON.stringify(sections));
  return { id, sections };
};
