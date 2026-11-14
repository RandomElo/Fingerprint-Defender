// Tests dans un vrai Firefox : canal entre content.js et inject.js, clé par site principal, clé provisoire.
// Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { By } = require("selenium-webdriver");
const { HOSTS, startServer, startFirefox, measureAt, storageGet, storageSet, inExtensionPage } = require("./harness");

let server;
let port;
let withExt; // Firefox avec l'extension
let natural; // valeurs de ce même Firefox quand l'extension est désactivée (elles varient d'une instance à l'autre)

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;
const frameUrl = (top) =>
  url(top, "top-with-frame.html", "?frame=" + encodeURIComponent(url(HOSTS.tiers, "frame.html")));

before(async () => {
  ({ server, port } = await startServer());
  withExt = await startFirefox({ extension: true });
  await storageSet(withExt, { enabled: false });
  natural = await measureAt(withExt, url(HOSTS.a, "probe.html", "?noearly=1"));
  await storageSet(withExt, { enabled: true });
});

after(async () => {
  if (withExt) await withExt.quit();
  if (server) server.close();
});

test("l'extension est active : les valeurs diffèrent de celles de Firefox seul", async () => {
  const r = await measureAt(withExt, url(HOSTS.a, "probe.html", "?noearly=1"));
  assert.notEqual(r.late, natural.late, "canvas non brouillé : l'extension n'a probablement pas accès au site");
  assert.notEqual(r.measure, natural.measure);
  assert.notEqual(r.rect, natural.rect);
});

test("les valeurs sont stables entre deux chargements du même site", async () => {
  const a = await measureAt(withExt, url(HOSTS.a, "probe.html", "?noearly=1"));
  const b = await measureAt(withExt, url(HOSTS.a, "probe.html", "?noearly=1"));
  assert.equal(a.late, b.late);
  assert.equal(a.measure, b.measure);
  assert.equal(a.rect, b.rect);
});

test("deux sites différents reçoivent des valeurs différentes", async () => {
  const a = await measureAt(withExt, url(HOSTS.a, "probe.html", "?noearly=1"));
  const b = await measureAt(withExt, url(HOSTS.b, "probe.html", "?noearly=1"));
  assert.notEqual(a.late, b.late);
  assert.notEqual(a.measure, b.measure);
});

test("une lecture dès le début de la page égale une lecture faite après le chargement", async () => {
  const r = await measureAt(withExt, url(HOSTS.a, "probe.html"));
  assert.equal(r.early[0], r.early[1]);
  assert.equal(r.early[0], r.late, "la valeur a changé quand la clé du site est arrivée");
});

test("un pisteur intégré dans deux sites voit deux empreintes différentes", async () => {
  const sousA = await measureAt(withExt, frameUrl(HOSTS.a));
  const sousB = await measureAt(withExt, frameUrl(HOSTS.b));
  assert.notEqual(sousA.hash, sousB.hash, "le cadre tiers a la même empreinte sur les deux sites : il peut les relier");
  assert.notEqual(sousA.measure, sousB.measure);
});

test("le pisteur garde la même empreinte quand on revient sur le même site", async () => {
  const a1 = await measureAt(withExt, frameUrl(HOSTS.a));
  const a2 = await measureAt(withExt, frameUrl(HOSTS.a));
  assert.equal(a1.hash, a2.hash);
});

test("le cadre tiers n'a pas la même empreinte intégré que seul sur son propre site", async () => {
  const integre = await measureAt(withExt, frameUrl(HOSTS.a));
  const seul = await measureAt(withExt, url(HOSTS.tiers, "probe.html"));
  assert.notEqual(integre.hash, seul.late);
});

test("la page ne reçoit aucun message de l'extension, et les réglages arrivent bien", async () => {
  await withExt.get(url(HOSTS.a, "probe.html", "?noearly=1"));
  await withExt.wait(() => withExt.executeScript("return window.__ready === true"), 10000);
  const avant = await withExt.executeScript("return window.measureNow().canvas");
  assert.notEqual(avant, natural.late);

  // Un changement de réglage fait renvoyer la configuration à la page : l'écouteur de la page ne doit rien voir.
  await storageSet(withExt, { enabled: false });
  await withExt.sleep(700);
  const coupe = await withExt.executeScript("return window.measureNow().canvas");
  await storageSet(withExt, { enabled: true });
  await withExt.sleep(700);
  const remis = await withExt.executeScript("return window.measureNow().canvas");
  const vus = await withExt.executeScript("return window.__events.length");

  assert.equal(coupe, natural.late, "la désactivation n'est pas arrivée jusqu'à la page");
  assert.equal(remis, avant, "la réactivation n'est pas arrivée jusqu'à la page");
  assert.equal(vus, 0, "la page a pu écouter des messages de l'extension");
});

test("la page ne peut pas couper la protection avec de faux messages", async () => {
  await withExt.get(url(HOSTS.a, "probe.html", "?noearly=1"));
  await withExt.wait(() => withExt.executeScript("return window.__ready === true"), 10000);
  const avant = await withExt.executeScript("return window.measureNow().canvas");
  await withExt.executeScript(`
    const send = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
    const off = { enabled: false, siteOff: true, level: "prudent", features: { canvas: false, fonts: false, rects: false }, key: "0".repeat(32) };
    send("fsh-config-9d41", off);
    send("fsh-config-9d41", { ...off, n: "a".repeat(32) });
    send("fsh-config-9d41-hello", { n: "a".repeat(32) });
    send("fsh-config-9d41", { ...off, n: "a".repeat(32) });
  `);
  const apres = await withExt.executeScript("return window.measureNow()");
  assert.equal(apres.canvas, avant, "un faux message a changé le brouillage");
  assert.notEqual(apres.canvas, natural.late);
});

test("la page ne peut pas fausser la liste des pisteurs, et un vrai pisteur est bien repéré", async () => {
  await measureAt(withExt, url(HOSTS.a, "probe.html", "?tracker=" + encodeURIComponent(url(HOSTS.tiers, "tracker.js"))));
  await withExt.executeScript(`
    window.dispatchEvent(new CustomEvent("fsh-config-9d41-stats", {
      detail: JSON.stringify({ n: "a".repeat(32), t: [{ src: "evil.example", f: ["canvas", "audio"] }] }),
    }));
    window.dispatchEvent(new CustomEvent("fsh-config-9d41-stats", {
      detail: JSON.stringify({ t: [{ src: "evil.example", f: ["canvas", "audio"] }] }),
    }));
  `);
  await withExt.sleep(3000); // inject.js regroupe les envois par lots de 1,5 s
  const { stats } = await storageGet(withExt, "stats");
  const pisteurs = Object.keys((stats && stats.pisteurs) || {});
  assert.ok(pisteurs.includes(HOSTS.tiers), `le faux pisteur n'a pas été repéré (vus : ${pisteurs.join(", ") || "aucun"})`);
  assert.ok(!pisteurs.includes("evil.example"), "un faux message a ajouté un pisteur");
});

test("l'auto-test du tableau de bord s'exécute dans l'onglet et ne trouve aucune incohérence grave", async () => {
  await withExt.get(url(HOSTS.a, "probe.html", "?noearly=1"));
  await withExt.wait(() => withExt.executeScript("return window.__ready === true"), 10000);
  const tabId = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.tabs.query({ url: 'http://127.0.0.1/*' }).then((t) => done(t[0].id))")
  );
  const lignes = await inExtensionPage(
    withExt,
    async () => {
      await withExt.findElement(By.id("selftest")).click();
      await withExt.wait(async () => (await withExt.findElements(By.css("#selftestOut .pill"))).length >= 4, 15000, "l'auto-test n'a rien affiché");
      const items = await withExt.findElements(By.css("#selftestOut li"));
      return Promise.all(items.map((li) => li.getText()));
    },
    `src/pages/dashboard/dashboard.html?tab=${tabId}#empreinte`
  );
  const texte = lignes.join("\n");
  assert.match(texte, /OK\s*Canvas stable/);
  assert.match(texte, /OK\s*Fonctions natives/);
  assert.match(texte, /Page et cadre cohérents/);
  assert.match(texte, /Workers non couverts|Page et worker cohérents/);
  assert.doesNotMatch(texte, /Problème/, "l'auto-test signale un problème :\n" + texte);
});
