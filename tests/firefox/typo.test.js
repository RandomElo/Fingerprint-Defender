// Tests dans un vrai Firefox : un site dont le nom ressemble à un site habituel, et la mémoire des sites habituels.
// Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { By } = require("selenium-webdriver");
const { HOSTS, startServer, startFirefox, measureAt, storageGet, storageSet, sleep, waitFor } = require("./harness");

const HABIT = "mabanque.fr";
const NAMES = ["mabanque.fr", "mabanqe.fr", "mabanque-secure.fr", "mabanque.shop", "mabanque.com", "amazon.fr", "amazon.de", "boutique-habit.example.com"];
const PREFS = { "network.dns.localDomains": NAMES.join(","), "network.stricttransportsecurity.preloadlist": false };
const LONG_AGO = "2026-01-01";

let server;
let port;
let withExt;

const url = (host, page = "probe.html", query = "?noearly=1") => `http://${host}:${port}/${page}${query}`;

async function setSettings(values) {
  await storageSet(withExt, values);
  await sleep(300);
}

before(async () => {
  ({ server, port } = await startServer());
  withExt = await startFirefox({ extension: true, prefs: PREFS });
  await storageSet(withExt, { habits: { [HABIT]: { n: 9, last: LONG_AGO }, "amazon.fr": { n: 30, last: LONG_AGO } } });
  await sleep(300);
});

after(async () => {
  if (withExt) await withExt.quit();
  if (server) server.close();
});

test("une lettre de moins dans le nom d'un site habituel : la page est arrêtée avec un avertissement", async () => {
  await withExt.get(url("mabanqe.fr"));
  const courante = await withExt.getCurrentUrl();
  assert.match(courante, /blocked\.html\?kind=typo&like=mabanque\.fr/, courante);
  const texte = await withExt.executeScript("return document.body.innerText");
  assert.match(texte, /ressemble à un site que tu visites souvent/);
  assert.match(texte, /mabanque\.fr/);
  assert.match(await withExt.findElement(By.id("back")).getText(), /Aller sur mabanque\.fr/);
});

test("un mot ajouté, ou une extension à risque, sont arrêtés aussi", async () => {
  for (const host of ["mabanque-secure.fr", "mabanque.shop"]) {
    await withExt.get(url(host));
    assert.match(await withExt.getCurrentUrl(), /kind=typo&like=mabanque\.fr/, host);
  }
});

test("le site habituel lui-même et le même nom en .com ou chez Amazon ne sont pas arrêtés", async () => {
  for (const host of ["mabanque.fr", "mabanque.com", "amazon.de"]) {
    await withExt.get(url(host));
    assert.doesNotMatch(await withExt.getCurrentUrl(), /blocked\.html/, host);
  }
});

test("« Continuer quand même » ouvre la page demandée", async () => {
  await withExt.get(url("mabanqe.fr"));
  await withExt.findElement(By.id("continue")).click();
  await waitFor(async () => /^http:\/\/mabanqe\.fr/.test(await withExt.getCurrentUrl()), 5000, "la page n'a pas été ouverte");
});

test("l'alerte est enregistrée dans le tableau de bord", async () => {
  const { alerts } = await storageGet(withExt, "alerts");
  assert.ok(alerts.some((a) => a.reasons.some((r) => /ressemble à mabanque\.fr/.test(r))), JSON.stringify(alerts));
});

test("le réglage coupe l'avertissement", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, typo: false } });
  try {
    await withExt.get(url("mabanque-secure.fr"));
    assert.doesNotMatch(await withExt.getCurrentUrl(), /blocked\.html/);
  } finally {
    await setSettings({ features: { ...features, typo: true } });
  }
});

test("sans historique, rien n'est signalé", async () => {
  await setSettings({ habits: {} });
  await withExt.get(url("mabanqe.fr"));
  assert.doesNotMatch(await withExt.getCurrentUrl(), /blocked\.html/);
});

test("un site visité deux fois le même jour compte une seule fois, et une adresse locale n'est jamais retenue", async () => {
  await setSettings({ habits: {} });
  await measureAt(withExt, url("boutique-habit.example.com"));
  await measureAt(withExt, url("boutique-habit.example.com"));
  await measureAt(withExt, url(HOSTS.a));
  const { habits } = await waitFor(async () => {
    const r = await storageGet(withExt, "habits");
    return r.habits && r.habits["example.com"] ? r : null;
  }, 5000, "la visite n'a pas été retenue");
  assert.equal(habits["example.com"].n, 1, "un jour de visite compte une fois : " + JSON.stringify(habits));
  assert.equal(habits[HOSTS.a], undefined, "une adresse locale ne doit pas être retenue");
});
