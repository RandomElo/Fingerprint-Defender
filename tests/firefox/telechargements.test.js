// Tests dans un vrai Firefox : fichiers à double extension et exécutables. Les téléchargements vont dans un dossier temporaire.
// Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { By } = require("selenium-webdriver");
const { HOSTS, startServer, startFirefox, storageGet, storageSet, sleep, waitFor } = require("./harness");

const DIR_PLAIN = fs.mkdtempSync(path.join(os.tmpdir(), "fsh-dl-plain-"));
const DIR_EXT = fs.mkdtempSync(path.join(os.tmpdir(), "fsh-dl-ext-"));
const prefs = (dir) => ({
  "browser.download.folderList": 2,
  "browser.download.dir": dir,
  "browser.download.useDownloadDir": true,
  "browser.helperApps.neverAsk.saveToDisk": "application/octet-stream",
  "browser.download.alwaysOpenPanel": false,
});

let server;
let port;
let plain;
let withExt;

const url = (page, query = "") => `http://${HOSTS.a}:${port}/${page}${query}`;
const has = (dir, name) => fs.existsSync(path.join(dir, name));

async function setSettings(values) {
  await storageSet(withExt, values);
  await sleep(300);
}

// Clique un lien vers /files/<nom>.
async function download(driver, name) {
  await driver.get(url("lien.html", "?to=" + encodeURIComponent(url("files/" + name))));
  await driver.findElement(By.id("go")).click();
}

const appears = (dir, name, ms = 6000) => waitFor(() => has(dir, name), ms, `${name} n'est pas apparu`).then(() => true, () => false);

before(async () => {
  ({ server, port } = await startServer());
  [plain, withExt] = await Promise.all([startFirefox({ extension: false, prefs: prefs(DIR_PLAIN) }), startFirefox({ extension: true, prefs: prefs(DIR_EXT) })]);
});

after(async () => {
  if (plain) await plain.quit();
  if (withExt) await withExt.quit();
  if (server) server.close();
  for (const d of [DIR_PLAIN, DIR_EXT]) fs.rmSync(d, { recursive: true, force: true });
});

test("un document ordinaire est enregistré normalement (témoin : Firefox seul télécharge aussi)", async () => {
  await download(plain, "rapport.pdf");
  assert.ok(await appears(DIR_PLAIN, "rapport.pdf"), "témoin : le téléchargement doit marcher sans l'extension");
  await download(withExt, "rapport.pdf");
  assert.ok(await appears(DIR_EXT, "rapport.pdf"), "un document ordinaire ne doit pas être touché");
});

test("facture.pdf.exe : arrêté, effacé, et une page explique (témoin : Firefox seul l'enregistre)", async () => {
  await download(plain, "facture.pdf.exe");
  assert.ok(await appears(DIR_PLAIN, "facture.pdf.exe"), "témoin : sans l'extension le fichier est enregistré");

  await download(withExt, "facture.pdf.exe");
  const ouverte = await waitFor(async () => (await withExt.getAllWindowHandles()).length > 1, 6000, "aucune page d'avertissement").then(() => true, () => false);
  assert.ok(ouverte, "une page d'avertissement doit s'ouvrir");
  await sleep(1200);
  assert.equal(has(DIR_EXT, "facture.pdf.exe"), false, "le fichier doit être effacé");
  const { alerts } = await storageGet(withExt, "alerts");
  assert.ok(alerts.some((a) => a.reasons.some((r) => /Téléchargement dangereux/.test(r)) && a.reasons.includes("facture.pdf.exe")), JSON.stringify(alerts));
});

test("« Télécharger quand même » enregistre le fichier", async () => {
  const handles = await withExt.getAllWindowHandles();
  await withExt.switchTo().window(handles[handles.length - 1]);
  assert.match(await withExt.executeScript("return document.body.innerText"), /Téléchargement arrêté/);
  await withExt.findElement(By.id("continue")).click();
  assert.ok(await appears(DIR_EXT, "facture.pdf.exe"), "le fichier doit être enregistré après la confirmation");
  for (const h of (await withExt.getAllWindowHandles()).slice(1)) {
    await withExt.switchTo().window(h);
    await withExt.close();
  }
  await withExt.switchTo().window((await withExt.getAllWindowHandles())[0]);
});

test("un programme d'un site de bonne réputation n'est pas touché", async () => {
  await download(withExt, "installateur.exe");
  assert.ok(await appears(DIR_EXT, "installateur.exe"), "un exécutable depuis un site local doit passer");
});

test("le réglage laisse passer un fichier à double extension", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, downloads: false } });
  try {
    await download(withExt, "releve.xlsx.bat");
    assert.ok(await appears(DIR_EXT, "releve.xlsx.bat"));
  } finally {
    await setSettings({ features: { ...features, downloads: true } });
  }
});
