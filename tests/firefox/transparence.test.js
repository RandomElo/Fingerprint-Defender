// Tests dans un vrai Firefox : tiers contactés, note de vie privée, bilan de la semaine, export et import des réglages.
// Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { By } = require("selenium-webdriver");
const { HOSTS, startServer, startFirefox, storageGet, inExtensionPage, sleep, waitFor, extensionOrigin } = require("./harness");

const SITE = "trans-site.example.com"; // un site « public » : les adresses locales ne sont pas comptées
const THIRDS = [HOSTS.tiers, HOSTS.c, HOSTS.d, HOSTS.e, HOSTS.b];
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fsh-export-"));
const PREFS = {
  "network.dns.localDomains": SITE,
  "browser.download.folderList": 2,
  "browser.download.dir": DIR,
  "browser.download.useDownloadDir": true,
  "browser.helperApps.neverAsk.saveToDisk": "application/json",
};

let server;
let port;
let withExt;

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;
const stats = async () => {
  const { pageStats } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageStats').then(done)")
  );
  return Object.values(pageStats);
};

before(async () => {
  ({ server, port } = await startServer());
  withExt = await startFirefox({ extension: true, prefs: PREFS });
});

after(async () => {
  if (withExt) await withExt.quit();
  if (server) server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
});

test("les tiers contactés par une page sont comptés (pas ceux d'une adresse locale)", async () => {
  await withExt.get(url(SITE, "tiers.html", `?port=${port}&hosts=${THIRDS.join(",")}`));
  const t = await waitFor(async () => (await stats()).find((x) => x.third && Object.keys(x.third).length >= THIRDS.length), 8000, "tiers non comptés");
  assert.deepEqual(Object.keys(t.third).sort(), [...THIRDS].sort());

  await withExt.get(url(HOSTS.a, "tiers.html", `?port=${port}&hosts=${THIRDS.join(",")}`));
  await sleep(2500);
  const local = (await stats()).filter((x) => x.third && Object.keys(x.third).length);
  assert.equal(local.length, 0, "une page locale ne doit rien compter : " + JSON.stringify(local));
});

test("le popup affiche la note de vie privée", async () => {
  await withExt.get(url(SITE, "tiers.html", `?port=${port}&hosts=${THIRDS.join(",")}`));
  await waitFor(async () => (await stats()).some((x) => x.third && Object.keys(x.third).length >= THIRDS.length), 8000, "tiers non comptés");
  const tabId = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript(`const done = arguments[arguments.length - 1]; chrome.tabs.query({ url: 'http://${SITE}/*' }).then((t) => done(t[0].id))`)
  );
  const texte = await inExtensionPage(
    withExt,
    async () => {
      await sleep(1300);
      return withExt.executeScript("return document.body.innerText");
    },
    `src/pages/popup/popup.html?tab=${tabId}`
  );
  assert.match(texte, /Vie privée : \d+\/100, (discret|bavard|envahissant) \(5 tiers contactés\)/);
});

test("le graphe retient les tiers du site, et le bilan compte ce qui a été bloqué", async () => {
  const { graph } = await waitFor(async () => {
    const r = await storageGet(withExt, "graph");
    return r.graph && r.graph["example.com"] ? r : null;
  }, 8000, "graphe vide");
  for (const h of THIRDS) assert.ok(graph["example.com"].includes(h), `${h} absent : ${JSON.stringify(graph)}`);

  // Un blocage : une page publique qui tente de joindre le réseau local.
  await withExt.get(url(SITE, "probe.html", "?noearly=1"));
  await withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; fetch(arguments[0]).then(() => done(1), () => done(0))", url(HOSTS.a, "headers"));
  const { daily } = await waitFor(async () => {
    const r = await storageGet(withExt, "daily");
    const today = new Date().toISOString().slice(0, 10);
    return r.daily && r.daily[today] && r.daily[today].localnet ? r : null;
  }, 8000, "aucun blocage compté");
  assert.ok(Object.values(daily).some((d) => d.blocked >= 1));

  const texte = await inExtensionPage(
    withExt,
    async () => {
      await sleep(1000);
      return withExt.executeScript("return document.getElementById('weekText').innerText + '\\n' + document.getElementById('weekList').innerText + '\\n' + document.getElementById('topThird').innerText");
    },
    "src/pages/dashboard/dashboard.html#bilan"
  );
  assert.match(texte, /bloquée?s? ces 7 derniers jours/);
  assert.match(texte, /requêtes? vers ton réseau local/);
  assert.match(texte, /: 1 site/);
});

test("export puis import : un vrai fichier, sans graine ni identifiants, relu par l'extension", async () => {
  await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.local.set({ identifiers: { emails: ['secret@exemple.fr'], phones: [] }, allowlist: ['meet.google.com'] }).then(done)")
  );
  const origin = await extensionOrigin(withExt);
  await withExt.get(origin + "/src/pages/dashboard/dashboard.html#reglages");
  await sleep(800);
  await withExt.findElement(By.id("exportSettings")).click();
  const file = path.join(DIR, "fingerprint-shield-reglages.json");
  await waitFor(() => fs.existsSync(file), 6000, "fichier non exporté");
  const text = fs.readFileSync(file, "utf8");
  const data = JSON.parse(text);
  assert.equal(data.app, "fingerprint-shield");
  assert.deepEqual(data.settings.allowlist, ["meet.google.com"]);
  for (const secret of ["secret@exemple.fr", '"seed"']) assert.ok(!text.includes(secret), secret);

  // On modifie le fichier, puis on l'importe.
  data.settings.level = "prudent";
  data.settings.allowlist = ["exemple.org"];
  data.settings.seed = "pirate";
  const edited = path.join(DIR, "modifie.json");
  fs.writeFileSync(edited, JSON.stringify(data));
  await withExt.findElement(By.id("importFile")).sendKeys(edited);
  const imported = await waitFor(async () => {
    const r = await storageGet(withExt, ["level", "allowlist", "seed"]);
    return r.level === "prudent" ? r : null;
  }, 6000, "import non appliqué");
  assert.deepEqual(imported.allowlist, ["exemple.org"]);
  assert.notEqual(imported.seed, "pirate", "la graine d'un fichier n'est jamais importée");
  assert.match(await withExt.findElement(By.id("importNote")).getText(), /importé/);
});
