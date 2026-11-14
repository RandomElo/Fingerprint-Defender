// Tests dans un vrai Firefox : tes identifiants envoyés à un tiers (hachés ou en clair). Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { HOSTS, startServer, startFirefox, measureAt, storageGet, storageSet, inExtensionPage, sleep, hitsSince, fetchFrom } = require("./harness");

// Un prestataire de paiement (payplug.com, dans la liste des domaines jamais bloqués) résolu vers la machine locale.
// Pas stripe.com : Firefox le force en HTTPS (liste HSTS), la requête n'arriverait jamais au serveur de test.
const PAIEMENT = "api.payplug.com";
const PREFS = { "network.dns.localDomains": PAIEMENT };

let server;
let port;
let hits;
let plain;
let withExt;

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const PROBE = "?noearly=1";

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

// --- identifiants envoyés à un tiers ----------------------------------------------------------------------
const EMAIL = "eloi@example.com";
const PHONE = "06 12 34 56 78";

// Envoie `payload` à `target` depuis le site a, et renvoie combien de requêtes ont atteint le serveur.
async function send(driver, kind, target, payload) {
  const avant = hits.beacon;
  const page = url(HOSTS.a, "probe.html", PROBE);
  if ((await driver.getCurrentUrl()) !== page) await measureAt(driver, page); // déjà sur la page : pas de rechargement
  if (kind === "image") {
    await driver.executeScript("const i = new Image(); i.src = arguments[0];", `${target}?e=${payload}`);
  } else if (kind === "get") {
    await fetchFrom(driver, `${target}?h=${payload}`);
  } else {
    await fetchFrom(driver, target, { method: "POST", body: JSON.stringify({ x: payload }) });
  }
  return hitsSince(hits, "beacon", avant);
}

test("le haché de mon adresse envoyé à un tiers est coupé (témoin : Firefox seul le laisse passer)", async () => {
  const cible = url(HOSTS.e, "beacon");
  assert.equal(await send(plain, "post", cible, sha256(EMAIL)), 1, "témoin : l'envoi doit arriver sans l'extension");

  await setSettings({ identifiers: { emails: [EMAIL], phones: [PHONE] } });
  assert.equal(await send(withExt, "post", cible, sha256(EMAIL)), 0, "le haché SHA-256 dans un corps de requête aurait dû être coupé");
  assert.equal(await send(withExt, "get", cible, sha256(EMAIL)), 0, "le haché dans l'adresse aurait dû être coupé");
  assert.equal(await send(withExt, "post", cible, sha1(EMAIL)), 0, "le haché SHA-1 aussi");
});

test("le haché de mon numéro est coupé sous ses deux écritures (06... et 336...)", async () => {
  const cible = url(HOSTS.e, "beacon");
  assert.equal(await send(withExt, "post", cible, sha256("0612345678")), 0);
  assert.equal(await send(withExt, "post", cible, sha256("33612345678")), 0);
});

test("mon adresse en clair est coupée dans une balise de suivi, mais pas dans un formulaire que j'envoie moi-même", async () => {
  const cible = url(HOSTS.e, "beacon");
  assert.equal(await send(withExt, "image", cible, EMAIL), 0, "une image de suivi qui porte mon adresse doit être coupée");
  assert.equal(await send(withExt, "post", cible, EMAIL), 1, "un envoi volontaire (corps de formulaire) doit passer");
});

test("une valeur sans rapport avec mes identifiants passe", async () => {
  assert.equal(await send(withExt, "post", url(HOSTS.e, "beacon"), sha256("quelquun@autre.fr")), 1);
});

test("un envoi vers le site lui-même passe (connexion, formulaire)", async () => {
  assert.equal(await send(withExt, "post", url(HOSTS.a, "beacon"), sha256(EMAIL)), 1);
});

test("un prestataire de paiement reçoit mes identifiants normalement", async () => {
  const cible = `http://${PAIEMENT}:${port}/beacon`;
  assert.equal(await send(plain, "post", cible, sha256(EMAIL)), 1, "témoin : la cible doit être joignable sans l'extension");
  assert.equal(await send(withExt, "post", cible, sha256(EMAIL)), 1, "le paiement doit pouvoir recevoir l'adresse");
});

test("l'exception d'un site et le réglage laissent passer les identifiants", async () => {
  const cible = url(HOSTS.e, "beacon");
  await setSettings({ identifiersAllow: [HOSTS.a] });
  assert.equal(await send(withExt, "post", cible, sha256(EMAIL)), 1, "exception du site");
  await setSettings({ identifiersAllow: [] });
  assert.equal(await send(withExt, "post", cible, sha256(EMAIL)), 0, "exception retirée : coupé de nouveau");

  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, identifiers: false } });
  assert.equal(await send(withExt, "post", cible, sha256(EMAIL)), 1, "réglage coupé");
  await setSettings({ features: { ...features, identifiers: true } });
});

test("sans identifiant saisi, rien n'est cherché", async () => {
  await setSettings({ identifiers: { emails: [], phones: [] } });
  assert.equal(await send(withExt, "post", url(HOSTS.e, "beacon"), sha256(EMAIL)), 1);
});

test("le popup apprend combien d'envois d'identifiants ont été coupés", async () => {
  await setSettings({ identifiers: { emails: [EMAIL], phones: [] } });
  await send(withExt, "post", url(HOSTS.e, "beacon"), sha256(EMAIL));
  const { pageStats } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageStats').then(done)")
  );
  const pages = Object.values(pageStats);
  assert.ok(pages.some((t) => t.blocked && t.blocked.identifiers >= 1), JSON.stringify(pageStats));
  assert.ok(pages.some((t) => t.domains && t.domains[HOSTS.e] >= 1), "le domaine visé doit figurer dans la liste : " + JSON.stringify(pageStats));
});
