// Tests dans un vrai Firefox : contenus intégrés chargés au clic, et paramètres de suivi propres à chaque site.
// Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { By } = require("selenium-webdriver");
const { HOSTS, startServer, startFirefox, measureAt, storageGet, storageSet, inExtensionPage, sleep, hitsSince, fetchFrom } = require("./harness");

// Noms de fournisseurs résolus vers la machine locale. Firefox force le HTTPS pour youtube.com (liste HSTS) : on la désactive
// pour que la requête arrive au serveur de test.
const YT = "www.youtube.com";
const YT_NOCOOKIE = "www.youtube-nocookie.com";
const AMAZON = "www.amazon.fr";
const PREFS = {
  "network.dns.localDomains": `${YT},${YT_NOCOOKIE},${AMAZON}`,
  "network.stricttransportsecurity.preloadlist": false,
};

let server;
let port;
let hits;
let plain;
let withExt;

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;
const embedUrl = (host = YT) => `http://${host}:${port}/embed/abc123`;
const articleUrl = (host = HOSTS.a) => url(host, "embed.html", "?src=" + encodeURIComponent(embedUrl()));
const PROBE = "?noearly=1";

async function setSettings(values) {
  await storageSet(withExt, values);
  await sleep(300);
}

// Ouvre l'article, et renvoie combien de fois le fournisseur a été contacté.
async function openArticle(driver, host = HOSTS.a) {
  const avant = hits.embed;
  await driver.get(articleUrl(host));
  return hitsSince(hits, "embed", avant, 900);
}

// Dans le cadre de la vidéo : le texte affiché.
async function frameText(driver) {
  await driver.switchTo().frame(await driver.findElement(By.id("video")));
  try {
    return await driver.executeScript("return document.body.innerText");
  } finally {
    await driver.switchTo().defaultContent();
  }
}

before(async () => {
  ({ server, port, hits } = await startServer());
  [plain, withExt] = await Promise.all([startFirefox({ extension: false, prefs: PREFS }), startFirefox({ extension: true, prefs: PREFS })]);
});

after(async () => {
  if (plain) await plain.quit();
  if (withExt) await withExt.quit();
  if (server) server.close();
});

// --- contenus intégrés -----------------------------------------------------------------------------------

test("une vidéo intégrée n'est pas chargée tant qu'on n'a pas cliqué (témoin : Firefox seul la charge)", async () => {
  assert.equal(await openArticle(plain), 1, "témoin : sans l'extension le fournisseur est contacté");
  assert.equal(await openArticle(withExt), 0, "le fournisseur ne doit pas être contacté avant le clic");
  const texte = await frameText(withExt);
  assert.match(texte, /YouTube/);
  assert.match(texte, /bloqué/);
  assert.doesNotMatch(texte, /contenu intégré chargé/);
});

test("« Charger ce contenu » charge la vidéo, par youtube-nocookie.com", async () => {
  await openArticle(withExt);
  const avant = hits.embed;
  await withExt.switchTo().frame(await withExt.findElement(By.id("video")));
  await withExt.findElement(By.id("load")).click();
  await withExt.switchTo().defaultContent();
  assert.equal(await hitsSince(hits, "embed", avant, 2500), 1);
  assert.ok(hits.lastEmbedHost.startsWith(YT_NOCOOKIE), "hôte contacté : " + hits.lastEmbedHost);
});

test("« Toujours charger sur ce site » retient le site, et les vidéos suivantes se chargent seules", async () => {
  await openArticle(withExt);
  await withExt.switchTo().frame(await withExt.findElement(By.id("video")));
  await withExt.findElement(By.id("always")).click();
  await withExt.findElement(By.id("load")).click();
  await withExt.switchTo().defaultContent();
  await sleep(800);
  const { embedAllow } = await storageGet(withExt, "embedAllow");
  assert.ok(embedAllow.includes(HOSTS.a), "le site doit être retenu : " + JSON.stringify(embedAllow));
  try {
    assert.equal(await openArticle(withExt), 1, "le fournisseur est contacté directement");
    assert.match(await frameText(withExt), /contenu intégré chargé/);
  } finally {
    await setSettings({ embedAllow: [] });
  }
  assert.equal(await openArticle(withExt), 0, "exception retirée : bloqué de nouveau");
});

test("l'exception du popup, le réglage et la protection coupée laissent passer", async () => {
  await setSettings({ embedAllow: [HOSTS.a] });
  assert.equal(await openArticle(withExt), 1, "exception du site");
  await setSettings({ embedAllow: [] });

  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, embeds: false } });
  assert.equal(await openArticle(withExt), 1, "réglage coupé");
  await setSettings({ features: { ...features, embeds: true } });

  await setSettings({ allowlist: [HOSTS.a] });
  assert.equal(await openArticle(withExt), 1, "site en exception");
  await setSettings({ allowlist: [] });
});

test("sur le site du fournisseur lui-même, la vidéo se charge sans demander", async () => {
  assert.equal(await openArticle(withExt, YT), 1);
});

test("le popup apprend qu'un contenu intégré attend le clic", async () => {
  await openArticle(withExt);
  const { pageStats } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageStats').then(done)")
  );
  const pages = Object.values(pageStats);
  assert.ok(pages.some((t) => t.blocked && t.blocked.embeds >= 1), JSON.stringify(pageStats));
  assert.ok(pages.some((t) => t.domains && t.domains.YouTube >= 1));
});

test("la page de remplacement ne charge rien qui ne soit pas un contenu intégré connu", async () => {
  const texte = await inExtensionPage(
    withExt,
    async () => ({
      titre: await withExt.executeScript("return document.getElementById('title').textContent"),
      bouton: await withExt.executeScript("return document.getElementById('load').hidden"),
    }),
    "src/pages/embed/embed.html?u=" + encodeURIComponent("http://evil.example/x")
  );
  assert.match(texte.titre, /non reconnu/);
  assert.equal(texte.bouton, true, "pas de bouton pour une adresse inconnue");
});

// --- paramètres de suivi propres à un site --------------------------------------------------------------

const amazon = (query) => `http://${AMAZON}:${port}/headers/dp/B0ABC/ref=sr_1_1${query}`;
const seen = async (driver, target) => JSON.parse((await fetchFrom(driver, target)).body)["x-test-url"];

test("Amazon : paramètres de session et segment /ref= retirés des requêtes, la recherche gardée (témoin : Firefox seul)", async () => {
  const cible = amazon("?keywords=chaussures&qid=1700000000&sr=8-1&pd_rd_r=abc");
  await measureAt(plain, url(HOSTS.a, "probe.html", PROBE));
  assert.match(await seen(plain, cible), /ref=sr_1_1.*qid=1700000000/, "témoin : Firefox seul envoie tout");
  await measureAt(withExt, url(HOSTS.a, "probe.html", PROBE));
  const vu = await seen(withExt, cible);
  assert.equal(vu, "/headers/dp/B0ABC?keywords=chaussures");
});

test("les mêmes paramètres sur un autre site ne sont pas touchés", async () => {
  await measureAt(withExt, url(HOSTS.a, "probe.html", PROBE));
  assert.equal(await seen(withExt, url(HOSTS.a, "headers", "?qid=1&sr=2&s=3")), "/headers?qid=1&sr=2&s=3");
});

test("les liens de la page sont nettoyés selon les règles du site", async () => {
  await measureAt(withExt, url(HOSTS.a, "probe.html", PROBE));
  await withExt.executeScript(
    "const a = document.createElement('a'); a.id = 'l'; a.href = arguments[0]; a.textContent = 'x'; document.body.append(a);",
    `http://${AMAZON}:${port}/dp/B0ABC/ref=sr_1_1?qid=1&keywords=chaussures`
  );
  await sleep(700);
  assert.equal(await withExt.executeScript("return document.getElementById('l').href"), `http://${AMAZON}:${port}/dp/B0ABC?keywords=chaussures`);
});
