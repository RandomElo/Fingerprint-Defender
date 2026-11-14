// Tests dans un vrai Firefox : informations de connexion chiffrée sur un VRAI site HTTPS (la chaîne de confiance est celle de
// Firefox). Ignorés hors ligne. Il n'y a pas de test avec un certificat local : voir la recette. Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const { startFirefox, inExtensionPage, sleep, waitFor } = require("./harness");

const SITE = "https://example.com/";
let online = false;
let withExt;

// Joignable depuis cette machine ? Sinon les tests sont ignorés plutôt que d'échouer.
const reachable = () =>
  new Promise((resolve) => {
    const req = https.get(SITE, { timeout: 4000 }, (r) => (r.resume(), resolve(r.statusCode < 500)));
    req.on("timeout", () => (req.destroy(), resolve(false)));
    req.on("error", () => resolve(false));
  });

before(async () => {
  [online, withExt] = await Promise.all([reachable(), startFirefox({ extension: true })]);
});

after(async () => {
  if (withExt) await withExt.quit();
});

const tlsOfTabs = async () => {
  const { pageStats } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageStats').then(done)")
  );
  return Object.values(pageStats).map((t) => t.tls).filter(Boolean);
};

test("une connexion HTTPS : version de TLS, émetteur et autorité reconnue sont lus", async (t) => {
  if (!online) return t.skip("hors ligne");
  await withExt.get(SITE);
  const tls = await waitFor(async () => (await tlsOfTabs()).find((x) => x.host === "example.com"), 8000, "aucune information de connexion retenue");
  assert.match(tls.protocol, /TLS/i, JSON.stringify(tls));
  assert.ok(tls.issuer.length > 0, "l'émetteur doit être lu : " + JSON.stringify(tls));
  assert.ok(tls.validFrom > 0, "la date d'émission doit être lue");
  assert.equal(tls.builtInRoot, true, "le certificat d'un vrai site vient d'une autorité reconnue par Firefox");
});

test("le popup affiche la ligne « Connexion »", async (t) => {
  if (!online) return t.skip("hors ligne");
  await withExt.get(SITE);
  await waitFor(async () => (await tlsOfTabs()).length, 8000, "pas de connexion retenue");
  const tabId = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.tabs.query({ url: 'https://example.com/*' }).then((t) => done(t[0].id))")
  );
  const texte = await inExtensionPage(
    withExt,
    async () => {
      await sleep(1200);
      return withExt.executeScript("return document.body.innerText");
    },
    `src/pages/popup/popup.html?tab=${tabId}`
  );
  assert.match(texte, /Connexion : .*TLS/);
});

test("le réglage coupe la lecture du certificat", async (t) => {
  if (!online) return t.skip("hors ligne");
  const { features } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.local.get('features').then(done)")
  );
  await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const f = arguments[0], done = arguments[arguments.length - 1]; chrome.storage.local.set({ features: { ...f, tls: false } }).then(() => done(true))", features)
  );
  await sleep(400);
  await withExt.get("https://example.org/");
  await sleep(2500);
  assert.equal((await tlsOfTabs()).find((x) => x.host === "example.org"), undefined);
});
