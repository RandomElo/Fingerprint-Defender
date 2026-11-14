const ALL_SITES = { origins: ["<all_urls>"] };

const TAGLINES = {
  safe: "Aucun signal inquiétant.",
  doubtful: "Quelques signaux inquiétants, prudence.",
  dangerous: "Site à risque : n'y saisis rien.",
  unverified: "Analyse incomplète : l'âge du domaine n'a pas pu être vérifié, donc pas de note.",
  local: "Appareil de ton réseau : non analysé, rien n'est envoyé sur Internet.",
};

let tab = null;
let host = "";
// Exceptions en un clic : liste de sites mémorisée dans le stockage, une case et une ligne du popup par protection.
const ALLOWS = {
  localnet: { key: "localnetAllow", box: "localnetOk", row: "localnetRow", list: [] },
  trackers: { key: "trackerAllow", box: "trackersOk", row: "trackersRow", list: [] },
  identifiers: { key: "identifiersAllow", box: "identifiersOk", row: "identifiersRow", list: [] },
  embeds: { key: "embedAllow", box: "embedsOk", row: "embedsRow", list: [] },
};

const matches = (list) => list.some((d) => host === d || host.endsWith("." + d));
const isWeb = () => tab && /^https?:/.test(tab.url || "");

// --- score du site affiché ------------------------------------------------------------
function renderSite(res) {
  const d = fshDisplay(res);
  const box = $("site");
  const info = mk("div");
  const pill = mk("span", d.label, "pill");
  pill.style.background = d.color;
  info.append(mk("div", res.host, "site-host"), pill, mk("p", TAGLINES[d.kind === "unverified" ? "unverified" : res.verdict], "site-tag"));
  const more = mk("button", "Détails", "link");
  more.addEventListener("click", () => {
    const d = $("siteDetails");
    d.hidden = !d.hidden;
    more.textContent = d.hidden ? "Détails" : "Masquer";
  });
  info.append(more);
  box.replaceChildren(makeGauge(d, 72), info);
  box.style.setProperty("--c", d.color);

  const details = mk("div", undefined, "result");
  renderFindings(details, res);
  $("siteDetails").replaceChildren(details);
}

async function loadSite() {
  const box = $("site");
  if (!isWeb()) {
    box.replaceChildren(mk("p", "Pas de score pour cette page (page interne du navigateur).", "msg"));
    return;
  }
  box.replaceChildren(mk("p", "Analyse du site en cours…", "msg"));
  try {
    const res = await browser.runtime.sendMessage({ type: "check", url: tab.url, tabId: tab.id });
    if (res) renderSite(res);
    else box.replaceChildren(mk("p", "Adresse non analysable.", "msg"));
  } catch (_) {
    box.replaceChildren(mk("p", "Analyse indisponible pour le moment.", "msg"));
  }
}

// --- pisteurs repérés sur la page affichée ------------------------------------------------------
function renderPage(t) {
  const out = $("page");
  if (!isWeb()) {
    out.replaceChildren(mk("p", "—", "msg"));
    return;
  }
  const flagged = Object.entries((t && t.flagged) || {});
  const rows = [mk("b", flagged.length ? `${flagged.length} pisteur${flagged.length > 1 ? "s" : ""} probable${flagged.length > 1 ? "s" : ""} bloqué${flagged.length > 1 ? "s" : ""}` : "Aucun pisteur probable sur cette page")];
  // Note de vie privée : la fiabilité dit si le site est honnête, celle-ci dit ce qu'il fait de toi.
  const thirds = Object.keys((t && t.third) || {}).length;
  const bl = (t && t.blocked) || {};
  const p = fshPrivacy({ third: thirds, flagged: flagged.length, identifiers: bl.identifiers || 0, blocked: (bl.trackers || 0) + (bl.beacons || 0) + (bl.localnet || 0) });
  rows.push(mk("p", `Vie privée : ${p.score}/100, ${p.label} (${thirds} tiers contactés)`, p.score >= 80 ? "msg" : "msg warn-line"));
  for (const [src, feats] of flagged) {
    const line = mk("div", undefined, "tracker");
    line.append(mk("span", src), mk("small", feats.map((f) => STAT_LABELS[f] || f).join(", ")));
    rows.push(line);
  }
  // Requêtes coupées sur cette page : balises vers un autre site, appels vers ton réseau local.
  const blocked = (t && t.blocked) || {};
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  if (blocked.localnet) rows.push(mk("p", `${plural(blocked.localnet, "requête", "requêtes")} vers ton réseau local bloquée${blocked.localnet > 1 ? "s" : ""} : ce site essayait de joindre ton routeur ou tes appareils.`, "msg"));
  if (blocked.beacons) rows.push(mk("p", `${plural(blocked.beacons, "balise", "balises")} d'analyse vers un autre site bloquée${blocked.beacons > 1 ? "s" : ""}.`, "msg"));
  if (blocked.trackers) rows.push(mk("p", `${plural(blocked.trackers, "requête", "requêtes")} de pisteurs repérés sur plusieurs sites bloquée${blocked.trackers > 1 ? "s" : ""}.`, "msg"));
  if (blocked.identifiers) rows.push(mk("p", `${plural(blocked.identifiers, "envoi", "envois")} de tes identifiants à un tiers bloqué${blocked.identifiers > 1 ? "s" : ""}.`, "msg"));
  if (blocked.clipboard) rows.push(mk("p", `${plural(blocked.clipboard, "copie nettoyée", "copies nettoyées")} d'un lien de suivi ajouté par le site.`, "msg"));
  if (blocked.consent) rows.push(mk("p", `${plural(blocked.consent, "bandeau de cookies refusé", "bandeaux de cookies refusés")} automatiquement.`, "msg"));
  if (blocked.embeds) rows.push(mk("p", `${plural(blocked.embeds, "contenu intégré attend", "contenus intégrés attendent")} ton clic pour se charger.`, "msg"));
  for (const p of (t && t.payment) || []) {
    const verdict = p.known ? "prestataire connu" : p.verdict === "safe" ? "réputation correcte" : `${p.verdict === "dangerous" ? "dangereux" : "douteux"}, ${p.score}/100`;
    rows.push(mk("p", `Paiement : ${p.name} (${verdict})`, p.known || p.verdict === "safe" ? "msg" : "msg warn-line"));
  }
  if (t && t.tls) {
    const days = t.tls.validFrom ? Math.floor((Date.now() - t.tls.validFrom) / 86400000) : null;
    const parts = [t.tls.protocol, t.tls.hsts ? "HSTS" : "", t.tls.ech ? "nom du site chiffré (ECH)" : "", t.tls.issuer ? "émis par " + t.tls.issuer : "", days !== null && days >= 0 ? `il y a ${days} jour${days > 1 ? "s" : ""}` : ""];
    rows.push(mk("small", "Connexion : " + parts.filter(Boolean).join(" · ")));
  }
  const domains = Object.entries((t && t.domains) || {}).sort((a, b) => b[1] - a[1]);
  if (domains.length) rows.push(mk("small", "Bloqués : " + domains.slice(0, 6).map(([d, n]) => `${d} (${n})`).join(", ") + (domains.length > 6 ? "…" : "")));
  out.replaceChildren(...rows);

  // Chaque exception reste visible tant qu'elle existe, pour pouvoir la retirer.
  for (const [name, a] of Object.entries(ALLOWS)) {
    const allowed = matches(a.list);
    $(a.box).checked = allowed;
    $(a.row).hidden = !(blocked[name] || allowed);
  }
}

async function loadPage() {
  const { pageStats } = await chrome.storage.session.get({ pageStats: {} });
  renderPage(tab ? pageStats[tab.id] : null);
}

function renderStatus(enabled, siteOff) {
  const el = $("status");
  el.textContent = !enabled ? "Protection coupée" : siteOff ? "Coupée sur ce site" : "Protection active";
  el.className = "status" + (enabled && !siteOff ? "" : " off");
}

async function init() {
  $("perm").hidden = await browser.permissions.contains(ALL_SITES);

  // `?tab=ID` : l'onglet à analyser. Le popup de la barre d'outils ne le reçoit pas (c'est l'onglet actif), mais ouvert
  // dans un onglet de test il permet de voir le popup pour une page précise, sans le menu du navigateur.
  const wanted = Number(new URLSearchParams(location.search).get("tab"));
  tab = wanted ? await chrome.tabs.get(wanted) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  try {
    host = new URL(tab.url).hostname;
  } catch (_) {}

  const s = await chrome.storage.local.get(FSH_DEFAULTS);
  $("enabled").checked = s.enabled;
  $("level").value = s.level;
  $("safetyMode").value = s.safetyMode;
  $("host").textContent = host || "ce site";
  $("siteOff").checked = matches(s.allowlist);
  $("siteOff").disabled = !isWeb();
  for (const a of Object.values(ALLOWS)) a.list = s[a.key];
  renderStatus(s.enabled, $("siteOff").checked);
  loadPage();
  loadSite();
}

function openDashboard(hash) {
  const q = tab && tab.id != null ? `?tab=${tab.id}` : "";
  chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/dashboard/dashboard.html") + q + hash });
  window.close();
}

$("grant").addEventListener("click", async () => {
  if (await browser.permissions.request(ALL_SITES)) $("perm").hidden = true;
});

$("enabled").addEventListener("change", (e) => {
  chrome.storage.local.set({ enabled: e.target.checked });
  renderStatus(e.target.checked, $("siteOff").checked);
});

$("siteOff").addEventListener("change", async (e) => {
  const { allowlist } = await chrome.storage.local.get({ allowlist: [] });
  const rest = allowlist.filter((d) => d !== host);
  await chrome.storage.local.set({ allowlist: e.target.checked ? [...rest, host] : rest });
  renderStatus($("enabled").checked, e.target.checked);
});

for (const a of Object.values(ALLOWS)) {
  $(a.box).addEventListener("change", async (e) => {
    const rest = a.list.filter((d) => d !== host);
    a.list = e.target.checked ? [...rest, host] : rest;
    await chrome.storage.local.set({ [a.key]: a.list });
  });
}

// Bouton d'urgence : une confirmation avant, car c'est irréversible.
$("panic").addEventListener("click", () => ($("panicConfirm").hidden = false));
$("panicNo").addEventListener("click", () => ($("panicConfirm").hidden = true));
$("panicYes").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "panic", hours: Number($("panicHours").value) }).catch(() => {});
  window.close();
});

$("level").addEventListener("change", (e) => chrome.storage.local.set({ level: e.target.value }));
$("safetyMode").addEventListener("change", (e) => chrome.storage.local.set({ safetyMode: e.target.value }));
$("dash").addEventListener("click", () => openDashboard("#vue"));
$("view").addEventListener("click", () => openDashboard("#empreinte"));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pageStats && tab) renderPage(changes.pageStats.newValue[tab.id]);
});

init();
