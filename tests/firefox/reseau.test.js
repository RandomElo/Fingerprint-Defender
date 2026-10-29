// Tests dans un vrai Firefox : en-têtes envoyés aux sites (Accept-Language, Sec-GPC) et changement
// automatique d'identité. Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { HOSTS, startServer, startFirefox, storageGet, storageSet } = require("./harness");

// Un Firefox configuré avec quatre langues : l'en-tête d'origine est long, et c'est ce que le serveur ne doit plus voir.
const PREFS = { "intl.accept_languages": "fr-FR, fr, en-US, en" };

let server;
let port;
let plain;
let withExt;

const url = (host, page) => `http://${host}:${port}/${page}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function headersAt(driver, host = HOSTS.a) {
  await driver.get(url(host, "headers"));
  return JSON.parse(await driver.executeScript("return document.body.innerText"));
}

// Les réglages sont relus par l'arrière-plan à chaque changement du stockage : on lui laisse un instant.
async function setSettings(values) {
  await storageSet(withExt, values);
  await sleep(500);
}

before(async () => {
  ({ server, port } = await startServer());
  plain = await startFirefox({ extension: false, prefs: PREFS });
  withExt = await startFirefox({ extension: true, prefs: PREFS });
});

after(async () => {
  if (plain) await plain.quit();
  if (withExt) await withExt.quit();
  if (server) server.close();
});

test("Firefox seul envoie la liste complète des langues et aucun signal GPC", async () => {
  const h = await headersAt(plain);
  assert.ok(h["accept-language"].split(",").length >= 4, h["accept-language"]);
  assert.equal(h["sec-gpc"], undefined);
});

test("avec l'extension, Accept-Language est réduit comme navigator.languages", async () => {
  const h = await headersAt(withExt);
  assert.equal(h["accept-language"], "fr-FR,fr;q=0.9");
  const langs = await withExt.executeScript("return Array.from(navigator.languages)");
  assert.deepEqual(langs, ["fr-FR", "fr"], "l'en-tête et la page doivent annoncer la même chose");
});

test("Sec-GPC est envoyé et navigator.globalPrivacyControl est vrai", async () => {
  const h = await headersAt(withExt);
  assert.equal(h["sec-gpc"], "1");
  assert.equal(await withExt.executeScript("return navigator.globalPrivacyControl"), true);
});

test("niveau prudent : la liste des langues reste complète", async () => {
  await setSettings({ level: "prudent" });
  try {
    const h = await headersAt(withExt);
    assert.ok(h["accept-language"].split(",").length >= 4, h["accept-language"]);
  } finally {
    await setSettings({ level: "renforce" });
  }
});

test("désactiver le signal GPC retire l'en-tête", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, gpc: false } });
  try {
    assert.equal((await headersAt(withExt))["sec-gpc"], undefined);
    assert.notEqual(await withExt.executeScript("return navigator.globalPrivacyControl"), true);
  } finally {
    await setSettings({ features: { ...features, gpc: true } });
  }
});

test("un site en exception ne reçoit aucune modification", async () => {
  await setSettings({ allowlist: [HOSTS.b] });
  try {
    const h = await headersAt(withExt, HOSTS.b);
    assert.equal(h["sec-gpc"], undefined);
    assert.ok(h["accept-language"].split(",").length >= 4, h["accept-language"]);
  } finally {
    await setSettings({ allowlist: [] });
  }
});

test("protection coupée : aucun en-tête modifié", async () => {
  await setSettings({ enabled: false });
  try {
    const h = await headersAt(withExt);
    assert.equal(h["sec-gpc"], undefined);
    assert.ok(h["accept-language"].split(",").length >= 4);
  } finally {
    await setSettings({ enabled: true });
  }
});

test("changement automatique d'identité : une graine trop ancienne est renouvelée tout de suite", async () => {
  const { seed: avant } = await storageGet(withExt, "seed");
  await storageSet(withExt, { seedAt: 0 }); // graine « très ancienne »
  await setSettings({ seedRotation: "weekly" });
  await sleep(500);
  const apres = await storageGet(withExt, ["seed", "seedAt"]);
  assert.notEqual(apres.seed, avant, "la graine aurait dû être renouvelée");
  assert.ok(Date.now() - apres.seedAt < 60000, "la date de la graine doit être mise à jour");
});

test("changement automatique d'identité : jamais, ou graine récente, ne change rien", async () => {
  const { seed: avant } = await storageGet(withExt, "seed");
  await setSettings({ seedRotation: "weekly" }); // graine récente : rien à faire
  assert.equal((await storageGet(withExt, "seed")).seed, avant);
  await storageSet(withExt, { seedAt: 0 });
  await setSettings({ seedRotation: "never" }); // jamais : rien à faire même avec une date ancienne
  assert.equal((await storageGet(withExt, "seed")).seed, avant);
});
