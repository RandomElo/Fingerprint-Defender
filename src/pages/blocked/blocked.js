const params = new URLSearchParams(location.search);
const target = params.get("u") || "";
const kind = params.get("kind") || "phishing"; // phishing, typo (ressemble à un site habituel) ou download
let host = "";
try {
  const u = new URL(target);
  host = u.hostname;
  $("url").textContent = u.origin + u.pathname + (u.search ? "?…" : "");
} catch (_) {}
$("host").textContent = host;

async function go() {
  location.replace(target);
}

// Les deux autres sortes d'avertissement : moins graves que le phishing, donc en orange, et un texte qui dit pourquoi.
function explain(text) {
  $("explain").textContent = text;
  $("explain").hidden = false;
}
if (kind === "typo") {
  const like = params.get("like") || "";
  $("head").classList.add("soft");
  $("title").textContent = "Ce site ressemble à un site que tu visites souvent";
  $("sub").textContent = "Fingerprint Shield a arrêté cette page avant son chargement.";
  explain(`Tu vas souvent sur ${like}. Cette adresse (${host}) s'écrit presque pareil : c'est une technique courante pour voler des mots de passe.`);
  $("back").textContent = "Aller sur " + like;
  $("back").onclick = () => location.replace("https://" + like + "/");
} else if (kind === "download") {
  $("head").classList.add("soft");
  $("title").textContent = "Téléchargement arrêté";
  $("sub").textContent = "Fingerprint Shield a annulé et effacé ce fichier.";
  $("host").textContent = params.get("n") || "";
  explain(params.get("why") || "");
  $("back").textContent = "Fermer";
  $("continue").textContent = "Télécharger quand même";
  $("trust").hidden = true;
}

$("back").addEventListener("click", async () => {
  if (kind === "typo") return;
  if (kind !== "download" && history.length > 1) history.back();
  else {
    const tab = await browser.tabs.getCurrent();
    browser.tabs.remove(tab.id);
  }
});

$("continue").addEventListener("click", async () => {
  if (kind === "download") {
    await browser.runtime.sendMessage({ type: "download-allow", url: target });
    await browser.downloads.download({ url: target });
    $("continue").disabled = true;
    $("continue").textContent = "Téléchargement relancé";
    return;
  }
  const { bypass } = await chrome.storage.session.get({ bypass: {} });
  bypass[host] = Date.now(); // une heure
  await chrome.storage.session.set({ bypass });
  go();
});

$("trust").addEventListener("click", async () => {
  const { trusted } = await chrome.storage.local.get({ trusted: [] });
  if (!trusted.includes(host)) await chrome.storage.local.set({ trusted: [...trusted, host] });
  go();
});

(async () => {
  if (kind === "download") return;
  try {
    const res = await browser.runtime.sendMessage({ type: "check", url: target });
    if (!res) return;
    const box = mk("div");
    const head = mk("div", undefined, "result-head");
    const d = fshDisplay(res);
    const pill = mk("span", d.kind === "score" ? `${d.label} · ${res.score}/100` : d.label, "pill");
    pill.style.background = d.color;
    head.append(makeGauge(d, 72), pill);
    box.append(head);
    renderFindings(box, res);
    $("why").replaceChildren(box);
  } catch (_) {
    $("why").replaceChildren(mk("p", "Détails indisponibles pour le moment.", "msg"));
  }
})();
