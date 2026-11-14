// Tests dans un vrai Firefox : Referer, paramètres de suivi dans les requêtes, réseau local, balises d'un worker,
// WebRTC en relais, faux mineur et page de blocage. Lancer avec : npm run test:firefox
//
// Pour avoir de « vrais » sites publics sans réseau, Firefox résout deux noms en .example.com vers la machine
// locale (préférence network.dns.localDomains) : l'extension les voit comme des sites d'Internet.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { By } = require("selenium-webdriver");
const { HOSTS, startServer, startFirefox, measureAt, storageGet, storageSet, inExtensionPage, sleep, fetchFrom } = require("./harness");

const PUBLIC = "public-site.example.com";
const PHISH = "phish-test.example.com";
const PREFS = { "network.dns.localDomains": `${PUBLIC},${PHISH}`, "browser.send_pings": true };

let server;
let port;
let hits;
let plain;
let withExt;

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;
const PROBE = "?noearly=1";

// Les réglages sont relus par l'arrière-plan à chaque changement du stockage : on lui laisse un instant.
async function setSettings(values) {
  await storageSet(withExt, values);
  await sleep(300);
}

before(async () => {
  ({ server, port, hits } = await startServer());
  // les deux navigateurs démarrent en même temps
  [plain, withExt] = await Promise.all([startFirefox({ extension: false, prefs: PREFS }), startFirefox({ extension: true, prefs: PREFS })]);
});

after(async () => {
  if (plain) await plain.quit();
  if (withExt) await withExt.quit();
  if (server) server.close();
});

// --- Referer ------------------------------------------------------------------------------------------
// Firefox réduit déjà le Referer des requêtes fetch vers un autre site, mais pas celui d'une navigation : une page
// qui demande « unsafe-url » envoie alors le chemin et les paramètres au site suivant. C'est ce cas qu'on teste.

// Clique sur un lien de la page `lien.html` (politique unsafe-url) et renvoie les en-têtes vus par le site d'arrivée.
async function clickThrough(driver, from, to, extra = "") {
  await driver.get(url(from, "lien.html", "?to=" + encodeURIComponent(to) + extra));
  await driver.findElement(By.id("go")).click();
  await driver.wait(async () => (await driver.getCurrentUrl()).startsWith(to.split("?")[0]), 5000);
  return JSON.parse(await driver.executeScript("return document.body.innerText"));
}

test("Referer : réduit à l'origine vers un autre site, complet sans l'extension", async () => {
  const to = url(HOSTS.b, "headers");
  const sans = await clickThrough(plain, HOSTS.a, to);
  assert.match(sans.referer, /lien\.html\?to=/, "témoin : Firefox seul envoie le chemin et les paramètres");
  const avec = await clickThrough(withExt, HOSTS.a, to);
  assert.equal(avec.referer, `http://${HOSTS.a}:${port}/`);
});

test("Referer : inchangé pour le même site", async () => {
  const r = await clickThrough(withExt, HOSTS.a, url(HOSTS.a, "headers"));
  assert.match(r.referer, /lien\.html\?to=/);
});

test("Referer : le réglage le coupe", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, referer: false } });
  try {
    const r = await clickThrough(withExt, HOSTS.a, url(HOSTS.b, "headers"));
    assert.match(r.referer, /lien\.html\?to=/);
  } finally {
    await setSettings({ features: { ...features, referer: true } });
  }
});

// --- paramètres de suivi dans les requêtes ---------------------------------------------------------

test("les paramètres de suivi sont retirés des requêtes fetch, pas seulement des pages", async () => {
  const target = url(HOSTS.a, "headers", "?utm_source=a&gclid=b&keep=1");
  await measureAt(plain, url(HOSTS.a, "probe.html", PROBE));
  assert.match(JSON.parse((await fetchFrom(plain, target)).body)["x-test-url"], /utm_source=a/, "témoin");

  await measureAt(withExt, url(HOSTS.a, "probe.html", PROBE));
  const vu = JSON.parse((await fetchFrom(withExt, target)).body)["x-test-url"];
  assert.doesNotMatch(vu, /utm_source|gclid/);
  assert.match(vu, /keep=1/, "un paramètre ordinaire doit rester");
});

// --- réseau local ----------------------------------------------------------------------------------------

const LOCAL_TARGET = () => url(HOSTS.a, "headers");

test("un site public ne peut pas joindre le réseau local (témoin : Firefox seul y arrive)", async () => {
  await measureAt(plain, url(PUBLIC, "probe.html", PROBE));
  const libre = await fetchFrom(plain, LOCAL_TARGET());
  assert.equal(libre.ok, true, "témoin : sans l'extension la requête devrait passer : " + libre.error);

  await measureAt(withExt, url(PUBLIC, "probe.html", PROBE));
  const bloque = await fetchFrom(withExt, LOCAL_TARGET());
  assert.equal(bloque.ok, false, "la requête vers le réseau local aurait dû être coupée");
});

test("le popup apprend combien de requêtes ont été coupées sur la page", async () => {
  await measureAt(withExt, url(PUBLIC, "probe.html", PROBE));
  await fetchFrom(withExt, LOCAL_TARGET());
  await fetchFrom(withExt, LOCAL_TARGET());
  await sleep(500);
  const { pageStats } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageStats').then(done)")
  );
  const total = Object.values(pageStats).reduce((n, t) => n + ((t.blocked && t.blocked.localnet) || 0), 0);
  assert.ok(total >= 2, "compteur de blocages : " + JSON.stringify(pageStats));
});

test("l'exception en un clic laisse passer le site, et seulement lui", async () => {
  await setSettings({ localnetAllow: [PUBLIC] });
  try {
    await measureAt(withExt, url(PUBLIC, "probe.html", PROBE));
    assert.equal((await fetchFrom(withExt, LOCAL_TARGET())).ok, true);
  } finally {
    await setSettings({ localnetAllow: [] });
  }
  await measureAt(withExt, url(PUBLIC, "probe.html", PROBE));
  assert.equal((await fetchFrom(withExt, LOCAL_TARGET())).ok, false, "l'exception retirée doit rebloquer");
});

test("le réglage « réseau local » le coupe pour tous les sites", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, localnet: false } });
  try {
    await measureAt(withExt, url(PUBLIC, "probe.html", PROBE));
    assert.equal((await fetchFrom(withExt, LOCAL_TARGET())).ok, true);
  } finally {
    await setSettings({ features: { ...features, localnet: true } });
  }
});

test("un appareil local parle à un autre sans être gêné", async () => {
  await measureAt(withExt, url(HOSTS.a, "probe.html", PROBE));
  assert.equal((await fetchFrom(withExt, url(HOSTS.b, "headers"))).ok, true);
});

// --- balises ----------------------------------------------------------------------------------------------
// L'attribut ping d'un lien prévient un autre site du clic. Firefox le désactive par défaut (browser.send_pings),
// mais pas toujours selon la configuration : l'extension le coupe au niveau du réseau.

async function pingByClick(driver) {
  const avant = hits.beacon;
  await driver.get(url(HOSTS.a, "lien.html", "?to=" + encodeURIComponent(url(HOSTS.a, "probe.html", PROBE)) + "&ping=" + encodeURIComponent(url(HOSTS.b, "beacon"))));
  await driver.findElement(By.id("go")).click();
  await sleep(1000);
  return hits.beacon - avant;
}

test("un ping vers un autre site est coupé (témoin : Firefox seul l'envoie)", async () => {
  assert.equal(await pingByClick(plain), 1, "témoin : le ping doit arriver sans l'extension");
  assert.equal(await pingByClick(withExt), 0, "le ping aurait dû être coupé");
});

test("le réglage des balises laisse passer le ping", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, beacon: false } });
  try {
    assert.equal(await pingByClick(withExt), 1);
  } finally {
    await setSettings({ features: { ...features, beacon: true } });
  }
});

// --- WebRTC en relais -------------------------------------------------------------------------------------

test("WebRTC : en relais seulement quand le réglage est activé", async () => {
  const policy = () => withExt.executeScript("return new RTCPeerConnection().getConfiguration().iceTransportPolicy");
  await measureAt(withExt, url(HOSTS.a, "probe.html", PROBE));
  assert.equal(await policy(), "all", "désactivé par défaut : Meet et Teams doivent marcher");

  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, webrtcRelay: true } });
  try {
    await measureAt(withExt, url(HOSTS.a, "probe.html", PROBE));
    assert.equal(await policy(), "relay");
  } finally {
    await setSettings({ features: { ...features, webrtcRelay: false } });
  }
});

// --- faux mineur ----------------------------------------------------------------------------------------

test("un script d'un autre site qui lance beaucoup de workers est signalé", async () => {
  await measureAt(withExt, url(HOSTS.a, "probe.html", "?noearly=1&tracker=" + encodeURIComponent(url(HOSTS.tiers, "miner.js"))));
  let surfaces = [];
  for (let i = 0; i < 12 && !surfaces.includes("workers"); i++) {
    await sleep(500);
    const { stats } = await storageGet(withExt, "stats");
    surfaces = (stats && stats.pisteurs && stats.pisteurs[HOSTS.tiers] && stats.pisteurs[HOSTS.tiers].f) || [];
  }
  assert.ok(surfaces.includes("workers"), "le faux mineur n'a pas été signalé : " + JSON.stringify(surfaces));
});

test("quelques workers lancés par le site lui-même ne sont pas un signal", async () => {
  const avant = (await storageGet(withExt, "stats")).stats;
  await measureAt(withExt, url(HOSTS.a, "probe.html", PROBE));
  await withExt.executeScript(
    "const u = URL.createObjectURL(new Blob(['self.onmessage=()=>{}'])); for (let i = 0; i < 10; i++) new Worker(u);"
  );
  await sleep(2500);
  const apres = (await storageGet(withExt, "stats")).stats;
  assert.equal(
    Object.keys((apres && apres.pisteurs) || {}).includes(HOSTS.a),
    Object.keys((avant && avant.pisteurs) || {}).includes(HOSTS.a),
    "un site n'est pas son propre pisteur"
  );
});

// --- page de blocage (vérifie aussi que les chemins de l'extension rangée en sous-dossiers sont bons) ----------

test("une page de la liste de phishing est remplacée par la page d'avertissement", async () => {
  await storageSet(withExt, { feeds: { openphish: "", phishing: PHISH, malware: "" } });
  await sleep(500);
  try {
    await withExt.get(url(PHISH, "probe.html"));
    const courante = await withExt.getCurrentUrl();
    assert.match(courante, /^moz-extension:\/\/.*\/src\/pages\/blocked\/blocked\.html/, "pas de page d'avertissement : " + courante);
    const texte = await withExt.executeScript("return document.body.innerText");
    assert.ok(texte.length > 20, "la page d'avertissement est vide");
    assert.ok(texte.includes(PHISH), "la page doit citer le site bloqué");
  } finally {
    await storageSet(withExt, { feeds: {} });
  }
});
