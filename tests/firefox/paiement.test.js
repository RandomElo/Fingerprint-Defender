// Tests dans un vrai Firefox : à qui part la carte, et quelle réputation a-t-il ? Lancer avec : npm run test:firefox
//
// Les « sites publics » sont des noms en .example.com résolus vers la machine locale. Le mauvais prestataire est inscrit dans
// la liste de phishing de l'extension, ce qui rend son verdict certain sans dépendre du réseau.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { By } = require("selenium-webdriver");
const { startServer, startFirefox, storageGet, storageSet, inExtensionPage, sleep, waitFor } = require("./harness");

const SHOP = "shop-test.example.com";
const BAD = "bad-gateway.example.com";
const STRIPE = "js.stripe.com";
const PREFS = { "network.dns.localDomains": `${SHOP},${BAD},${STRIPE}`, "network.stricttransportsecurity.preloadlist": false };

let server;
let port;
let withExt;

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;

async function setSettings(values) {
  await storageSet(withExt, values);
  await sleep(300);
}

// Les destinataires de carte retenus pour les onglets ouverts.
async function receivers() {
  const { pageStats } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageStats').then(done)")
  );
  return Object.values(pageStats).flatMap((t) => t.payment || []);
}
const paymentAlerts = async () => ((await storageGet(withExt, "alerts")).alerts || []).filter((a) => a.reasons.some((r) => /Prestataire de paiement/.test(r)));

before(async () => {
  ({ server, port } = await startServer());
  withExt = await startFirefox({ extension: true, prefs: PREFS });
  await storageSet(withExt, { feeds: { openphish: "", phishing: BAD, malware: "" } });
  await sleep(300);
});

after(async () => {
  if (withExt) await withExt.quit();
  if (server) server.close();
});

test("un formulaire de carte qui part vers un prestataire de la liste de menaces : tu es averti", async () => {
  await withExt.get(url(SHOP, "boutique.html", "?action=" + encodeURIComponent(url(BAD, "pay"))));
  await withExt.findElement(By.id("cc")).click();
  const item = await waitFor(async () => (await receivers()).find((p) => p.host === BAD), 8000, "le destinataire n'a pas été analysé");
  assert.equal(item.known, false);
  assert.equal(item.verdict, "dangerous");
  assert.ok(item.reasons.length > 0, "la raison doit être donnée");
  assert.ok((await paymentAlerts()).length >= 1, "l'alerte doit figurer au tableau de bord");
});

test("un site de la liste de menaces est bloqué avant d'afficher sa page de paiement", async () => {
  await withExt.get(url(BAD, "boutique.html"));
  assert.match(await withExt.getCurrentUrl(), /blocked\.html/, "la garde de navigation doit remplacer la page");
});

test("si on continue quand même (contournement d'une heure), la saisie de carte avertit aussi", async () => {
  // Ce que fait « Continuer quand même » sur la page d'avertissement.
  await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.set({ bypass: { [arguments[0]]: Date.now() } }).then(done)", BAD)
  );
  await withExt.get(url(BAD, "boutique.html"));
  await withExt.findElement(By.id("cc")).click();
  const item = await waitFor(async () => (await receivers()).find((p) => p.host === BAD), 8000, "le site n'a pas été analysé");
  assert.equal(item.verdict, "dangerous");
});

test("Stripe dans un cadre : connu, aucun avertissement", async () => {
  const avant = (await paymentAlerts()).length;
  await withExt.get(url(SHOP, "boutique.html", "?frame=" + encodeURIComponent(url(STRIPE, "carte-iframe.html"))));
  await withExt.switchTo().frame(await withExt.findElement(By.id("pay")));
  await withExt.findElement(By.id("cc")).click();
  await withExt.switchTo().defaultContent();
  const item = await waitFor(async () => (await receivers()).find((p) => p.host === STRIPE), 8000, "Stripe n'a pas été reconnu");
  assert.equal(item.name, "Stripe");
  assert.equal(item.known, true);
  assert.equal((await paymentAlerts()).length, avant, "un prestataire connu ne déclenche pas d'alerte");
});

test("sans cliquer dans le champ de carte, rien n'est vérifié", async () => {
  await withExt.get(url(SHOP, "boutique.html", "?action=" + encodeURIComponent(url(BAD, "pay"))));
  await sleep(1500);
  assert.equal((await receivers()).find((p) => p.host === BAD), undefined);
});

test("un champ qui n'est pas une carte ne déclenche rien", async () => {
  await withExt.get(url(SHOP, "boutique.html", "?action=" + encodeURIComponent(url(BAD, "pay"))));
  await withExt.findElement(By.id("nom")).click();
  await sleep(1500);
  assert.equal((await receivers()).find((p) => p.host === BAD), undefined);
});

test("le réglage et l'exception d'un site coupent la vérification", async () => {
  const { features } = await storageGet(withExt, "features");
  const essai = async () => {
    await withExt.get(url(SHOP, "boutique.html", "?action=" + encodeURIComponent(url(BAD, "pay"))));
    await withExt.findElement(By.id("cc")).click();
    await sleep(1800);
    return (await receivers()).find((p) => p.host === BAD);
  };
  await setSettings({ features: { ...features, payment: false } });
  try {
    assert.equal(await essai(), undefined, "réglage coupé");
  } finally {
    await setSettings({ features: { ...features, payment: true } });
  }
  await setSettings({ allowlist: [SHOP] });
  try {
    assert.equal(await essai(), undefined, "site en exception");
  } finally {
    await setSettings({ allowlist: [] });
  }
});
