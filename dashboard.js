const TABS = ["vue", "empreinte", "securite", "reglages"];
const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

function ago(ts) {
  if (!ts) return "jamais";
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 60) return rtf.format(-min, "minute");
  if (min < 1440) return rtf.format(-Math.round(min / 60), "hour");
  return rtf.format(-Math.round(min / 1440), "day");
}

// --- onglets ---------------------------------------------------------------------------
let fingerprintLoaded = false;

function showTab(name) {
  if (!TABS.includes(name)) name = "vue";
  for (const t of TABS) $("tab-" + t).hidden = t !== name;
  for (const b of document.querySelectorAll("[data-tab]")) {
    b.classList.toggle("active", b.dataset.tab === name);
    b.setAttribute("aria-selected", String(b.dataset.tab === name));
  }
  if (location.hash !== "#" + name) history.replaceState(null, "", location.search + "#" + name);
  if (name === "empreinte" && !fingerprintLoaded) {
    fingerprintLoaded = true;
    loadFingerprint();
  }
}

for (const b of document.querySelectorAll("[data-tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

// --- vue d'ensemble -----------------------------------------------------------------------
function renderPisteurs(list, pisteurs) {
  const top = Object.entries(pisteurs || {}).sort((a, b) => b[1].n - a[1].n).slice(0, 20);
  list.replaceChildren(
    ...(top.length
      ? top.map(([src, info]) => {
          const li = mk("li");
          const name = mk("span", src);
          name.append(mk("small", " " + info.f.map((f) => STAT_LABELS[f] || f).join(", ") + (info.p && info.p.length ? " · vu sur " + info.p.slice(0, 3).join(", ") : ""), "muted"));
          li.append(name, mk("b", `${nf.format(info.n)} page${info.n > 1 ? "s" : ""}`));
          return li;
        })
      : [mk("li", "Aucun pisteur tiers repéré pour le moment", "empty")])
  );
}

function renderStats(stats) {
  const s = stats && stats.v === 3 ? stats : { flagged: 0, pisteurs: {}, safety: stats && stats.safety };
  $("sFlagged").textContent = nf.format(s.flagged);
  $("sChecked").textContent = nf.format((s.safety && s.safety.checked) || 0);
  $("sAlerts").textContent = nf.format((s.safety && s.safety.alerts) || 0);
  renderPisteurs($("top"), s.pisteurs);
}

// --- empreinte ------------------------------------------------------------------------------
async function collectInTab(tabId) {
  const target = { tabId, allFrames: false };
  await chrome.scripting.executeScript({ target, files: ["collector.js"], world: "MAIN" });
  const [res] = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: async () => {
      const r = await window.__fshCollect();
      delete window.__fshCollect;
      return r;
    },
  });
  return res.result;
}

function renderFingerprint(real, prot) {
  const out = $("fp");
  out.replaceChildren();
  real.sections.forEach((sec, i) => {
    const protSec = prot && prot.sections[i];
    out.append(mk("h3", sec.title));
    const table = mk("table");
    const head = mk("tr");
    ["", "Réelle", "Vue par les sites"].forEach((t) => head.append(mk("th", t)));
    table.append(head);
    sec.rows.forEach(([k, v], j) => {
      const pv = protSec && protSec.rows[j] ? protSec.rows[j][1] : "";
      const tr = mk("tr");
      if (prot && pv !== v) tr.className = "diff";
      tr.append(mk("td", k, "key"), mk("td", v, "val"), mk("td", prot ? pv : "n/a", "val prot"));
      table.append(tr);
    });
    out.append(table);
  });
}

async function loadFingerprint() {
  const real = await window.__fshCollect();
  $("idReal").textContent = real.id;

  const tabId = Number(new URLSearchParams(location.search).get("tab"));
  let prot = null;
  if (tabId) {
    try {
      prot = await collectInTab(tabId);
      $("idProt").textContent = prot.id;
    } catch (_) {
      $("idProt").textContent = "indisponible";
    }
  } else {
    $("idProt").textContent = "ouvre cette page depuis le popup";
  }
  if (!prot) $("idProt").style.fontSize = "14px";
  renderFingerprint(real, prot);
}

// --- auto-test de cohérence ----------------------------------------------------------------
const SELFTEST_STATUS = {
  ok: { label: "OK", color: VERDICTS.safe.color },
  warn: { label: "À surveiller", color: VERDICTS.doubtful.color },
  bad: { label: "Problème", color: VERDICTS.dangerous.color },
  info: { label: "Info", color: VERDICTS.local.color },
};

async function runSelfTest() {
  const out = $("selftestOut");
  const tabId = Number(new URLSearchParams(location.search).get("tab"));
  if (!tabId) {
    out.replaceChildren(mk("li", "Ouvre cette page depuis le popup pour tester l'onglet en cours.", "empty"));
    return;
  }
  $("selftest").disabled = true;
  out.replaceChildren(mk("li", "Test en cours…", "empty"));
  try {
    const target = { tabId, allFrames: false };
    await chrome.scripting.executeScript({ target, files: ["autotest.js"], world: "MAIN" });
    const [res] = await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: async () => {
        const r = await window.__fshSelfTest();
        delete window.__fshSelfTest;
        return r;
      },
    });
    const { host, checks } = res.result;
    out.replaceChildren(
      mk("li", "Page testée : " + host, "muted"),
      ...checks.map((c) => {
        const li = mk("li");
        const pill = mk("span", SELFTEST_STATUS[c.status].label, "pill");
        pill.style.background = SELFTEST_STATUS[c.status].color;
        li.append(pill, mk("b", " " + c.label + " "), mk("span", c.detail, "muted"));
        return li;
      })
    );
  } catch (_) {
    out.replaceChildren(mk("li", "Impossible de tester cet onglet (page interne du navigateur, ou accès aux sites non accordé).", "empty"));
  } finally {
    $("selftest").disabled = false;
  }
}
$("selftest").addEventListener("click", runSelfTest);

// --- sécurité des sites --------------------------------------------------------------------
function renderFeeds(meta) {
  const c = (meta && meta.counts) || {};
  const line = (label, n) => mk("li", `${label} : ${n ? nf.format(n) + " entrées" : "pas encore téléchargée"}`);
  $("feedInfo").replaceChildren(
    line("OpenPhish (pages de phishing)", c.openphish),
    line("Domaines de phishing", c.phishing),
    line("Domaines de malware (URLhaus)", c.malware),
    mk("li", "Dernière mise à jour : " + ago(meta && meta.updated), "muted")
  );
}

function renderAlerts(alerts) {
  const table = $("alerts");
  if (!alerts.length) {
    table.replaceChildren(mk("caption", "Aucune alerte pour le moment.", "empty"));
    return;
  }
  const head = mk("tr");
  ["Quand", "Site", "Verdict", "Score", "Raisons"].forEach((t) => head.append(mk("th", t)));
  table.replaceChildren(
    head,
    ...alerts.slice(0, 30).map((a) => {
      const tr = mk("tr");
      const verdict = mk("span", VERDICTS[a.verdict].label, "pill");
      verdict.style.background = VERDICTS[a.verdict].color;
      const vtd = mk("td");
      vtd.append(verdict);
      tr.append(mk("td", ago(a.t), "key"), mk("td", a.host, "val"), vtd, mk("td", String(a.score)), mk("td", a.reasons.join(", ")));
      return tr;
    })
  );
}

function renderRemovable(list, items, onRemove, emptyText) {
  list.replaceChildren(
    ...(items.length
      ? items.map((item) => {
          const li = mk("li");
          const btn = mk("button", "Retirer", "link");
          btn.addEventListener("click", () => onRemove(item));
          li.append(mk("span", item), btn);
          return li;
        })
      : [mk("li", emptyText, "empty")])
  );
}

$("checkForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  let raw = $("checkInput").value.trim();
  if (!raw) return;
  if (!/^[a-z]+:\/\//i.test(raw)) raw = "https://" + raw;
  $("checkOut").replaceChildren(mk("p", "Analyse en cours…", "msg"));
  try {
    const res = await browser.runtime.sendMessage({ type: "check", url: raw });
    if (!res) throw new Error("adresse invalide");
    renderResult($("checkOut"), res);
  } catch (err) {
    $("checkOut").replaceChildren(mk("p", "Impossible d'analyser cette adresse.", "msg"));
  }
});

$("feedUpdate").addEventListener("click", async () => {
  $("feedUpdate").disabled = true;
  $("feedUpdate").textContent = "Téléchargement…";
  await browser.runtime.sendMessage({ type: "feeds-update" });
  $("feedUpdate").disabled = false;
  $("feedUpdate").textContent = "Mettre à jour maintenant";
});

$("safetyMode").addEventListener("change", (e) => chrome.storage.local.set({ safetyMode: e.target.value }));
$("safetyAuto").addEventListener("change", (e) => chrome.storage.local.set({ safetyAuto: e.target.checked }));
$("linkBadges").addEventListener("change", (e) => chrome.storage.local.set({ linkBadges: e.target.checked }));
$("safetyOnline").addEventListener("change", (e) => chrome.storage.local.set({ safetyOnline: e.target.checked }));

// --- réglages ----------------------------------------------------------------------------------
$("level").addEventListener("change", (e) => chrome.storage.local.set({ level: e.target.value }));
$("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$("seedRotation").addEventListener("change", (e) => chrome.storage.local.set({ seedRotation: e.target.value }));
$("rotate").addEventListener("click", async () => {
  await chrome.storage.local.set({ seed: randomSeed(), seedAt: Date.now() });
  $("note").textContent = "Nouvelle identité générée. Recharge les onglets ouverts.";
});
$("resetStats").addEventListener("click", async () => {
  await chrome.storage.local.remove(["stats", "alerts"]);
});

$("allowForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = $("allowInput").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d) return;
  const { allowlist } = await chrome.storage.local.get({ allowlist: [] });
  if (!allowlist.includes(d)) await chrome.storage.local.set({ allowlist: [...allowlist, d] });
  $("allowInput").value = "";
});

// --- chargement et mises à jour ------------------------------------------------------------------
async function refresh() {
  const s = await chrome.storage.local.get({ ...FSH_DEFAULTS, stats: null, alerts: [], feedsMeta: null });
  renderStats(s.stats);
  renderFeeds(s.feedsMeta);
  renderAlerts(s.alerts);
  renderRemovable(
    $("trusted"),
    s.trusted,
    async (d) => chrome.storage.local.set({ trusted: s.trusted.filter((x) => x !== d) }),
    "Aucun site de confiance."
  );
  renderRemovable(
    $("allowlist"),
    s.allowlist,
    async (d) => chrome.storage.local.set({ allowlist: s.allowlist.filter((x) => x !== d) }),
    "Aucune exception."
  );
  $("safetyMode").value = s.safetyMode;
  $("safetyOnline").checked = s.safetyOnline;
  $("linkBadges").checked = s.linkBadges;
  $("safetyAuto").checked = s.safetyAuto;
  $("level").value = s.level;
  $("seedRotation").value = s.seedRotation;
  $("enabled").checked = s.enabled;
  buildToggles($("toggles"), { ...FSH_DEFAULTS.features, ...s.features });
}

chrome.storage.onChanged.addListener((changes) => {
  // Les statistiques bougent souvent : on ne recharge pas les interrupteurs pour elles.
  if (Object.keys(changes).every((k) => k === "stats" || k === "repCache")) {
    if (changes.stats) renderStats(changes.stats.newValue);
    return;
  }
  refresh();
});

refresh();
showTab(location.hash.slice(1));
