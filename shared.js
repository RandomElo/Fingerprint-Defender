// Éléments d'interface partagés par le popup et le tableau de bord.
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("fr-FR");
const SVG_NS = "http://www.w3.org/2000/svg";

function mk(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function randomSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const GROUPS = [
  {
    title: "Anonymisation",
    items: [
      ["canvas", "Canvas"],
      ["webgl", "WebGL"],
      ["audio", "Audio"],
      ["fonts", "Polices"],
      ["hardware", "Matériel (cœurs, mémoire)"],
      ["screen", "Écran et langues (niveau renforcé)"],
      ["rects", "Rectangles DOM (niveau renforcé)"],
      ["extra", "Voix de synthèse, batterie"],
      ["webrtc", "WebRTC : masquer l'IP locale (peut gêner les appels)"],
    ],
  },
  {
    title: "Fuites vers les sites",
    items: [
      ["beacon", "Balises d'analyse tierces (sendBeacon)"],
      ["cleanUrls", "Retirer utm_, fbclid, gclid des URL visitées"],
      ["cleanLinks", "Nettoyer les liens de la page en direct"],
      ["gpc", "Envoyer le signal « ne pas vendre mes données » (Sec-GPC)"],
    ],
  },
  {
    title: "Nuisances",
    items: [
      ["perms", "Refuser notifications et géolocalisation"],
      ["popups", "Bloquer les popups sans clic"],
      ["banners", "Masquer bandeaux de cookies et d'appli"],
    ],
  },
];

const STAT_LABELS = {
  canvas: "Canvas", webgl: "WebGL", audio: "Audio", fonts: "Polices", hardware: "Matériel",
  screen: "Écran", extra: "Divers", webrtc: "WebRTC", beacon: "Balises", perms: "Permissions",
  popups: "Popups", banners: "Bandeaux", cleanLinks: "Liens", cleanUrls: "URL", rects: "Rectangles",
};

const VERDICTS = {
  safe: { label: "Fiable", color: "#16a34a" },
  doubtful: { label: "Douteux", color: "#d97706" },
  dangerous: { label: "Dangereux", color: "#dc2626" },
  local: { label: "Réseau local", color: "#6b7280" },
};

// --- réglages : interrupteurs groupés -----------------------------------------------
function buildToggles(container, features, { collapsible = false } = {}) {
  container.replaceChildren(
    ...GROUPS.map((g) => {
      const wrap = collapsible ? mk("details") : mk("div", undefined, "group");
      wrap.append(mk(collapsible ? "summary" : "h3", g.title));
      for (const [key, label] of g.items) {
        const row = mk("label", undefined, "row");
        const input = mk("input");
        input.type = "checkbox";
        input.dataset.feature = key;
        input.checked = !!features[key];
        input.addEventListener("change", async () => {
          const { features: current } = await chrome.storage.local.get({ features: FSH_DEFAULTS.features });
          current[key] = input.checked;
          await chrome.storage.local.set({ features: current });
        });
        row.append(mk("span", label), input);
        wrap.append(row);
      }
      return wrap;
    })
  );
}

// --- résultat d'analyse d'un site -------------------------------------------------------
const STATUS_ICON = { ok: "✓", warn: "!", bad: "✕", info: "–" };

// Jauge ronde : note sur 100, "?" si l'analyse est incomplète, maison pour le réseau local.
function makeGauge(d, size = 84) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const value = d.kind === "score" ? d.value : 100;
  const g = svgEl("svg", { viewBox: "0 0 84 84", width: size, height: size, class: "gauge" });
  g.append(
    svgEl("circle", { cx: 42, cy: 42, r: R, fill: "none", stroke: "rgba(127,127,127,.25)", "stroke-width": 8 }),
    svgEl("circle", {
      cx: 42, cy: 42, r: R, fill: "none", stroke: d.color, "stroke-width": 8, "stroke-linecap": "round",
      "stroke-dasharray": `${(value / 100) * C} ${C}`, transform: "rotate(-90 42 42)",
    })
  );
  if (d.kind === "local") {
    g.append(
      svgEl("path", {
        d: "M28 44 42 31 56 44 M32 41v14h20V41", fill: "none", "stroke-width": 4, "stroke-linecap": "round",
        "stroke-linejoin": "round", style: "stroke:var(--fg)",
      })
    );
  } else {
    const num = svgEl("text", { x: 42, y: 42, "text-anchor": "middle", "dominant-baseline": "central", class: "gauge-num" });
    num.textContent = d.text;
    g.append(num);
  }
  return g;
}

// Problèmes d'abord, puis vérifications réussies, puis ce qui n'a pas pu être vérifié.
function renderFindings(card, res) {
  const sections = [
    ["Problèmes détectés", (f) => f.status === "bad" || f.status === "warn"],
    ["Vérifications réussies", (f) => f.status === "ok"],
    ["Non disponible", (f) => f.status === "info"],
  ];
  for (const [title, test] of sections) {
    const list = res.findings.filter(test);
    if (!list.length) continue;
    card.append(mk("h4", title));
    for (const f of list) {
      const row = mk("div", undefined, "frow");
      const text = mk("div");
      text.append(mk("b", f.label), mk("span", f.detail));
      row.append(mk("div", STATUS_ICON[f.status], "ico " + f.status), text);
      card.append(row);
    }
  }
}

function renderResult(container, res) {
  const d = fshDisplay(res);
  const card = mk("div", undefined, "result");
  const head = mk("div", undefined, "result-head");
  const titles = mk("div");
  titles.append(mk("div", res.host, "result-host"), mk("span", d.label, "pill"));
  titles.lastChild.style.background = d.color;
  head.append(makeGauge(d), titles);
  card.append(head);
  renderFindings(card, res);
  container.replaceChildren(card);
}
