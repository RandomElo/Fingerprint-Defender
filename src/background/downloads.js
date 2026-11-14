// Téléchargements dangereux : un fichier à double extension (facture.pdf.exe) est toujours arrêté, un programme ou un script
// seulement quand le site d'où il vient a mauvaise réputation. Le téléchargement est annulé et effacé, puis une page explique
// et propose « Télécharger quand même ». Firefox ne laisse pas d'extension refuser avant le début : le fichier est supprimé
// aussitôt après.
const seenDownloads = new Set();

const baseName = (p) => String(p || "").split(/[\\/]/).pop();
const urlName = (u) => {
  try {
    return decodeURIComponent(new URL(u).pathname.split("/").pop());
  } catch (_) {
    return "";
  }
};

async function allowDownloadOnce(url) {
  const { downloadOnce } = await chrome.storage.session.get({ downloadOnce: {} });
  downloadOnce[url] = Date.now() + 60000;
  await chrome.storage.session.set({ downloadOnce });
  return true;
}

async function takeDownloadAllowance(url) {
  const { downloadOnce } = await chrome.storage.session.get({ downloadOnce: {} });
  if (!(downloadOnce[url] > Date.now())) return false;
  delete downloadOnce[url];
  await chrome.storage.session.set({ downloadOnce });
  return true;
}

// Réputation la plus mauvaise parmi le site de la page et celui du fichier.
async function worstVerdict(item, s) {
  let worst = null;
  for (const u of [item.referrer, item.url]) {
    if (!u || !/^https?:/.test(u)) continue;
    const r = await Reputation.checkSite(u, { online: s.safetyOnline });
    if (r && (r.verdict === "dangerous" || (r.verdict === "doubtful" && !worst))) worst = r;
  }
  return worst;
}

async function inspectDownload(item) {
  if (seenDownloads.has(item.id)) return;
  const known = baseName(item.filename);
  const name = known || urlName(item.url);
  // Le nom définitif n'arrive parfois qu'après : tant qu'on ne l'a pas, on ne juge que sur l'adresse, et on ne retient pas ce téléchargement.
  if (known) seenDownloads.add(item.id);
  const kind = fshDownloadRisk(name);
  if (!kind) return;
  seenDownloads.add(item.id);

  const s = await settings();
  if (!s.enabled || !s.features.downloads || (await takeDownloadAllowance(item.url))) return;

  let reason = kind === "double" ? "Le nom ressemble à un document mais se termine par une extension de programme." : null;
  if (kind === "executable") {
    const worst = await worstVerdict(item, s);
    if (!worst) return; // un programme d'un site qui a bonne réputation : normal
    reason = `Un programme téléchargé depuis un site de réputation ${worst.verdict === "dangerous" ? "dangereuse" : "douteuse"} (${worst.host}).`;
  }

  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.removeFile(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  recordScam({ kind: "download", host: fshPageHost(item.url) || "", level: kind === "double" ? "dangerous" : "doubtful", reasons: [name] });
  chrome.tabs.create({
    url: chrome.runtime.getURL("src/pages/blocked/blocked.html") + "?kind=download&u=" + encodeURIComponent(item.url) + "&n=" + encodeURIComponent(name) + "&why=" + encodeURIComponent(reason),
  });
}

// Firefox Android n'offre qu'une partie de l'API des téléchargements : sans ces événements, rien n'est inspecté.
if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(inspectDownload);
  chrome.downloads.onChanged.addListener(async (delta) => {
    if (!delta.filename) return;
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item) inspectDownload(item);
  });
}
