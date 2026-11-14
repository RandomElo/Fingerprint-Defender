// Tests dans un vrai Firefox : fausse fenêtre de connexion dessinée dans la page, et onglet qui change pendant ton absence.
// Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, startFirefox, storageGet, storageSet, inExtensionPage, sleep, waitFor, HOSTS } = require("./harness");

const GOOGLE = "accounts.google.com";
const PREFS = { "network.dns.localDomains": GOOGLE, "network.stricttransportsecurity.preloadlist": false };

let server;
let port;
let withExt;

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;
const alertsMatching = async (re) => ((await storageGet(withExt, "alerts")).alerts || []).filter((a) => a.reasons.some((r) => re.test(r)));

before(async () => {
  ({ server, port } = await startServer());
  withExt = await startFirefox({ extension: true, prefs: PREFS });
});

after(async () => {
  if (withExt) await withExt.quit();
  if (server) server.close();
});

// --- fausse fenêtre de connexion -------------------------------------------------------------------------

test("une fausse fenêtre qui affiche l'adresse de Google avec un champ mot de passe : alerte", async () => {
  await withExt.get(url(HOSTS.a, "bitb.html"));
  const a = await waitFor(async () => (await alertsMatching(/Fausse fenêtre de connexion/))[0], 6000, "aucune alerte");
  assert.ok(a.reasons.some((r) => /accounts\.google\.com/.test(r)), JSON.stringify(a));
});

test("le finding pèse sur le score de la page", async () => {
  await withExt.get(url(HOSTS.a, "bitb.html"));
  const finding = await waitFor(async () => {
    const { pageSignals } = await inExtensionPage(withExt, () =>
      withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageSignals').then(done)")
    );
    return Object.values(pageSignals).flatMap((x) => x.findings || []).find((f) => f.label === "Fausse fenêtre de connexion");
  }, 6000, "aucune observation sur la page");
  assert.equal(finding.cap, 30, "la note doit être plafonnée");
});

test("une page d'aide qui cite l'adresse dans une phrase ou un lien n'est pas signalée", async () => {
  const avant = (await alertsMatching(/Fausse fenêtre de connexion/)).length;
  await withExt.get(url(HOSTS.a, "bitb-doc.html"));
  await sleep(3500);
  assert.equal((await alertsMatching(/Fausse fenêtre de connexion/)).length, avant);
});

test("la vraie page du service (même nom d'hôte) n'est pas signalée", async () => {
  const avant = (await alertsMatching(/Fausse fenêtre de connexion/)).length;
  await withExt.get(url(GOOGLE, "bitb.html"));
  await sleep(3500);
  assert.equal((await alertsMatching(/Fausse fenêtre de connexion/)).length, avant);
});

// --- onglet qui se déguise ---------------------------------------------------------------------------------

// Charge la page, passe sur un autre onglet pendant `away` ms, puis revient.
async function leaveAndReturn(query, away) {
  await withExt.get(url(HOSTS.a, "tabnab.html", query));
  const original = await withExt.getWindowHandle();
  await withExt.switchTo().newWindow("tab");
  await sleep(away);
  await withExt.close();
  await withExt.switchTo().window(original);
  await sleep(800);
}

test("une page qui devient une page de connexion pendant ton absence : alerte", async () => {
  await leaveAndReturn("?mode=login", 3500);
  const a = await alertsMatching(/Onglet qui change d'apparence/);
  assert.ok(a.length >= 1, "aucune alerte");
  assert.ok(a[0].reasons.some((r) => /Connexion à votre compte/.test(r)), JSON.stringify(a[0]));
});

test("un simple compteur de messages dans le titre n'est pas signalé", async () => {
  const avant = (await alertsMatching(/Onglet qui change d'apparence/)).length;
  await leaveAndReturn("?mode=compteur", 3500);
  assert.equal((await alertsMatching(/Onglet qui change d'apparence/)).length, avant);
});

test("une absence trop courte pour piéger n'est pas signalée", async () => {
  const avant = (await alertsMatching(/Onglet qui change d'apparence/)).length;
  await leaveAndReturn("?mode=login&delay=100", 900);
  assert.equal((await alertsMatching(/Onglet qui change d'apparence/)).length, avant);
});

test("le réglage coupe ces deux alertes", async () => {
  const { features } = await storageGet(withExt, "features");
  await storageSet(withExt, { features: { ...features, scams: false } });
  await sleep(300);
  try {
    const avant = (await alertsMatching(/Onglet qui change d'apparence|Fausse fenêtre/)).length;
    await withExt.get(url(HOSTS.a, "bitb.html"));
    await sleep(3500);
    await leaveAndReturn("?mode=login", 3500);
    assert.equal((await alertsMatching(/Onglet qui change d'apparence|Fausse fenêtre/)).length, avant);
  } finally {
    await storageSet(withExt, { features: { ...features, scams: true } });
  }
});
