const TABS = ["vue", "empreinte", "securite", "bilan", "reglages"];
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

// --- bilan ---------------------------------------------------------------------------------------
const WEEK_LABELS = {
  trackers: "requêtes de pisteurs appris", localnet: "requêtes vers ton réseau local", identifiers: "envois de tes identifiants",
  beacons: "balises d'analyse", embeds: "contenus intégrés en attente de clic", consent: "bandeaux de cookies refusés", clipboard: "copies nettoyées",
};

function renderBilan(daily, graph, stats) {
  const week = fshWeekTotals(daily);
  const total = week.blocked || 0;
  const learned = Object.keys((stats && stats.pisteurs) || {}).length;
  $("weekText").textContent = total
    ? `${nf.format(total)} requête${total > 1 ? "s" : ""} ou envoi${total > 1 ? "s" : ""} bloqué${total > 1 ? "s" : ""} ces 7 derniers jours. ${nf.format(learned)} pisteur${learned > 1 ? "s" : ""} repéré${learned > 1 ? "s" : ""} au total.`
    : "Rien n'a été bloqué ces 7 derniers jours.";
  $("weekList").replaceChildren(...Object.entries(WEEK_LABELS).filter(([k]) => week[k]).map(([k, label]) => mk("li", `${nf.format(week[k])} ${label}`)));
  const top = fshTopThirdParties(graph);
  $("topThird").replaceChildren(...(top.length ? top.map((t) => mk("li", `${t.domain} : ${t.sites} site${t.sites > 1 ? "s" : ""}`)) : [mk("li", "Pas encore de données : navigue un peu.", "empty")]));
  const chatty = fshChattiestSites(graph);
  $("chatty").replaceChildren(...(chatty.length ? chatty.map((c) => mk("li", `${c.site} : ${c.third} tiers`)) : [mk("li", "Pas encore de données.", "empty")]));
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
  await chrome.scripting.executeScript({ target, files: ["/src/pages/dashboard/collector.js"], world: "MAIN" });
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
    await chrome.scripting.executeScript({ target, files: ["/src/pages/dashboard/autotest.js"], world: "MAIN" });
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

// Fuseau horaire contre pays de sortie : à la demande seulement, jamais en tâche de fond.
async function runTimezoneCheck() {
  const out = $("selftestOut");
  const row = (status, label, detail) => {
    const li = mk("li");
    const pill = mk("span", SELFTEST_STATUS[status].label, "pill");
    pill.style.background = SELFTEST_STATUS[status].color;
    li.append(pill, mk("b", " " + label + " "), mk("span", detail, "muted"));
    return li;
  };
  $("tzcheck").disabled = true;
  out.replaceChildren(mk("li", "Recherche du pays de sortie…", "empty"));
  try {
    const trace = await (await fetch("https://1.1.1.1/cdn-cgi/trace", { cache: "no-store" })).text();
    const country = (/^loc=([A-Z]{2})$/m.exec(trace) || [])[1];
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const verdict = fshTimezoneVsCountry(tz, country);
    if (verdict === "match") out.replaceChildren(row("ok", "Fuseau et pays cohérents", `Fuseau ${tz}, sortie par ${country}.`));
    else if (verdict === "mismatch")
      out.replaceChildren(
        row("warn", "Fuseau différent du pays de sortie", `Ton fuseau est ${tz} mais tu sors par ${country} (VPN ?). Les sites recoupent les deux. Le fuseau n'est pas modifié : ton agenda en a besoin.`)
      );
    else out.replaceChildren(row("info", "Comparaison impossible", `Fuseau ${tz}, sortie par ${country || "pays inconnu"} : ce fuseau n'est pas dans la table.`));
  } catch (_) {
    out.replaceChildren(row("info", "Pays de sortie introuvable", "Cloudflare n'a pas répondu depuis ce réseau."));
  } finally {
    $("tzcheck").disabled = false;
  }
}
$("tzcheck").addEventListener("click", runTimezoneCheck);

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
      tr.append(mk("td", ago(a.t), "key"), mk("td", a.host, "val"), vtd, mk("td", a.score == null ? "·" : String(a.score)), mk("td", a.reasons.join(", ")));
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

// Mes identifiants : une valeur par ligne, enregistrées quand on quitte le champ.
const lines = (id) => $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);
for (const id of ["idEmails", "idPhones"]) {
  $(id).addEventListener("change", () => chrome.storage.local.set({ identifiers: { emails: lines("idEmails"), phones: lines("idPhones") } }));
}
$("rotate").addEventListener("click", async () => {
  await chrome.storage.local.set({ seed: randomSeed(), seedAt: Date.now() });
  $("note").textContent = "Nouvelle identité générée. Recharge les onglets ouverts.";
});
// Export et import des réglages : un fichier JSON, relu avec les mêmes règles que celles de l'export (fshImportSettings).
$("exportSettings").addEventListener("click", async () => {
  const stored = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(fshExportSettings(stored), null, 2)], { type: "application/json" });
  const a = mk("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fingerprint-shield-reglages.json";
  document.body.append(a);
  a.click();
  a.remove();
});
$("importButton").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = fshImportSettings(await file.text());
  if (!r.ok) {
    $("importNote").textContent = "Import refusé : " + r.rejected.join(", ") + ".";
    return;
  }
  await chrome.storage.local.set(r.values);
  const n = Object.keys(r.values).length;
  $("importNote").textContent = `${n} réglage${n > 1 ? "s" : ""} importé${n > 1 ? "s" : ""}.` + (r.rejected.length ? ` Ignoré : ${r.rejected.join(", ")}.` : "");
  e.target.value = "";
});

$("cleanOnClose").addEventListener("change", (e) => chrome.storage.local.set({ cleanOnClose: e.target.checked }));
$("cleanKeep").addEventListener("change", () => chrome.storage.local.set({ cleanKeep: lines("cleanKeep") }));
$("forgetHabits").addEventListener("click", () => chrome.storage.local.remove("habits"));
$("resetStats").addEventListener("click", async () => {
  await chrome.storage.local.remove(["stats", "alerts", "graph", "daily"]);
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
  const s = await chrome.storage.local.get({ ...FSH_DEFAULTS, stats: null, alerts: [], feedsMeta: null, habits: {}, daily: {}, graph: {} });
  renderStats(s.stats);
  renderFeeds(s.feedsMeta);
  renderAlerts(s.alerts);
  renderBilan(s.daily, s.graph, s.stats);
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
  const habits = Object.values(s.habits);
  $("habitsInfo").textContent = habits.length
    ? `${habits.length} site${habits.length > 1 ? "s" : ""} retenu${habits.length > 1 ? "s" : ""}, dont ${habits.filter((h) => h.n >= 4).length} visité${habits.filter((h) => h.n >= 4).length > 1 ? "s" : ""} au moins 4 jours. Ils restent sur cet appareil et servent seulement à reconnaître une faute de frappe dans une adresse. Rien n'est retenu en navigation privée.`
    : "Aucun site retenu pour le moment. L'extension retient en local les sites que tu visites, pour te prévenir devant une adresse qui s'écrit presque comme l'un d'eux.";
  $("cleanOnClose").checked = s.cleanOnClose;
  $("cleanKeep").value = s.cleanKeep.join("\n");
  $("idEmails").value = s.identifiers.emails.join("\n");
  $("idPhones").value = s.identifiers.phones.join("\n");
  $("enabled").checked = s.enabled;
  buildToggles($("toggles"), { ...FSH_DEFAULTS.features, ...s.features });
}

chrome.storage.onChanged.addListener((changes) => {
  // Les statistiques bougent souvent : on ne recharge pas les interrupteurs pour elles.
  if (Object.keys(changes).every((k) => ["stats", "repCache", "daily", "graph", "habits", "alerts", "certRoots", "__sync"].includes(k))) {
    if (changes.stats) renderStats(changes.stats.newValue);
    if (changes.daily || changes.graph) chrome.storage.local.get({ daily: {}, graph: {}, stats: null }).then((s) => renderBilan(s.daily, s.graph, s.stats));
    return;
  }
  refresh();
});

refresh();
showTab(location.hash.slice(1));
