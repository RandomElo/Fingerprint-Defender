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
  for (const [src, feats] of flagged) {
    const line = mk("div", undefined, "tracker");
    line.append(mk("span", src), mk("small", feats.map((f) => STAT_LABELS[f] || f).join(", ")));
    rows.push(line);
  }
  out.replaceChildren(...rows);
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

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
  renderStatus(s.enabled, $("siteOff").checked);
  loadPage();
  loadSite();
}

function openDashboard(hash) {
  const q = tab && tab.id != null ? `?tab=${tab.id}` : "";
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") + q + hash });
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

$("level").addEventListener("change", (e) => chrome.storage.local.set({ level: e.target.value }));
$("safetyMode").addEventListener("change", (e) => chrome.storage.local.set({ safetyMode: e.target.value }));
$("dash").addEventListener("click", () => openDashboard("#vue"));
$("view").addEventListener("click", () => openDashboard("#empreinte"));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pageStats && tab) renderPage(changes.pageStats.newValue[tab.id]);
});

init();
