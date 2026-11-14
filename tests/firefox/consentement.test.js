// Tests dans un vrai Firefox : refus automatique des bandeaux de cookies. Lancer avec : npm run test:firefox
//
// Les pages de test reproduisent la structure de plusieurs outils de consentement (OneTrust, Usercentrics dans un shadow DOM,
// Sourcepoint dans un cadre d'un autre domaine) et un bandeau inconnu. Elles ne sont pas les vrais sites : voir la recette.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { HOSTS, startServer, startFirefox, storageGet, storageSet, inExtensionPage, sleep, waitFor } = require("./harness");

// Le cadre Sourcepoint vient de son propre domaine, résolu ici vers la machine locale.
const SP_HOST = "cdn.privacy-mgmt.com";
const PREFS = { "network.dns.localDomains": SP_HOST };

let server;
let port;
let plain;
let withExt;

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;
const read = (driver) => driver.executeScript("return { refused: window.__refused || null, accepted: window.__accepted === true }");

// Charge la page et attend le refus (jusqu'à `ms`). Renvoie ce qui a été cliqué.
async function refusal(driver, page, query = "", ms = 4500) {
  await driver.get(url(HOSTS.a, page, query));
  try {
    await waitFor(async () => (await read(driver)).refused, ms);
  } catch (_) {}
  return read(driver);
}

// Charge la page et laisse passer les premières tentatives : rien ne doit avoir été cliqué.
async function untouched(driver, page, query = "") {
  await driver.get(url(HOSTS.a, page, query));
  await sleep(3200);
  return read(driver);
}

before(async () => {
  ({ server, port } = await startServer());
  [plain, withExt] = await Promise.all([startFirefox({ extension: false, prefs: PREFS }), startFirefox({ extension: true, prefs: PREFS })]);
});

after(async () => {
  if (plain) await plain.quit();
  if (withExt) await withExt.quit();
  if (server) server.close();
});

test("OneTrust : « Tout refuser » est cliqué, « Tout accepter » jamais (témoin : Firefox seul ne clique rien)", async () => {
  const sans = await untouched(plain, "cmp-onetrust.html");
  assert.deepEqual(sans, { refused: null, accepted: false }, "témoin : sans l'extension personne ne clique");
  const avec = await refusal(withExt, "cmp-onetrust.html");
  assert.equal(avec.refused, "onetrust");
  assert.equal(avec.accepted, false, "le bouton d'acceptation ne doit jamais être cliqué");
});

test("Usercentrics : le bouton dans un shadow DOM est trouvé", async () => {
  const r = await refusal(withExt, "cmp-shadow.html");
  assert.equal(r.refused, "usercentrics");
  assert.equal(r.accepted, false);
});

test("Sourcepoint : le bouton dans un cadre d'un autre domaine est trouvé", async () => {
  const inner = encodeURIComponent(`http://${SP_HOST}:${port}/cmp-sp-inner.html`);
  const r = await refusal(withExt, "cmp-sourcepoint.html", "?inner=" + inner);
  assert.equal(r.refused, "sourcepoint");
});

test("bandeau inconnu : un bouton « Tout refuser » dans une zone qui parle de cookies est cliqué", async () => {
  const r = await refusal(withExt, "cmp-generic.html");
  assert.equal(r.refused, "generique");
  assert.equal(r.accepted, false);
});

test("un dialogue qui propose « Refuser » sans parler de cookies n'est pas touché", async () => {
  const r = await untouched(withExt, "cmp-autre-dialogue.html");
  assert.deepEqual(r, { refused: null, accepted: false });
});

test("le réglage et l'exception d'un site coupent le refus automatique", async () => {
  const { features } = await storageGet(withExt, "features");
  await storageSet(withExt, { features: { ...features, consent: false } });
  await sleep(300);
  try {
    assert.equal((await untouched(withExt, "cmp-onetrust.html")).refused, null, "réglage coupé");
  } finally {
    await storageSet(withExt, { features: { ...features, consent: true } });
    await sleep(300);
  }
  await storageSet(withExt, { allowlist: [HOSTS.a] });
  await sleep(300);
  try {
    assert.equal((await untouched(withExt, "cmp-onetrust.html")).refused, null, "site en exception");
  } finally {
    await storageSet(withExt, { allowlist: [] });
    await sleep(300);
  }
});

test("le popup apprend qu'un bandeau a été refusé", async () => {
  await refusal(withExt, "cmp-onetrust.html");
  await sleep(300);
  const { pageStats } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageStats').then(done)")
  );
  const pages = Object.values(pageStats);
  assert.ok(pages.some((t) => t.blocked && t.blocked.consent >= 1), JSON.stringify(pageStats));
  assert.ok(pages.some((t) => t.domains && t.domains.OneTrust >= 1), "l'outil refusé doit figurer dans la liste");
});
