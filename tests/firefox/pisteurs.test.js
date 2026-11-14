// Tests dans un vrai Firefox : pisteurs appris d'après leur comportement. Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { HOSTS, startServer, startFirefox, measureAt, storageGet, storageSet, inExtensionPage, sleep } = require("./harness");

let server;
let port;
let withExt;

const url = (host, page, query = "") => `http://${host}:${port}/${page}${query}`;
const PROBE = "?noearly=1";
const trackerUrl = () => encodeURIComponent(url(HOSTS.tiers, "tracker.js"));
const withTracker = (host) => url(host, "probe.html", `${PROBE}&tracker=${trackerUrl()}`);

async function setSettings(values) {
  await storageSet(withExt, values);
  await sleep(300);
}

before(async () => {
  ({ server, port } = await startServer());
  withExt = await startFirefox({ extension: true });
});

after(async () => {
  if (withExt) await withExt.quit();
  if (server) server.close();
});

// --- pisteurs appris ---------------------------------------------------------------------------------------

// Charge la page de `host` avec le faux pisteur (canvas + audio) et dit si son script s'est exécuté.
async function trackerRuns(host) {
  await measureAt(withExt, withTracker(host));
  return withExt.executeScript("return window.__trackerRan === true");
}

async function learnedCount() {
  const { stats } = await storageGet(withExt, "stats");
  const p = (stats && stats.pisteurs && stats.pisteurs[HOSTS.tiers] && stats.pisteurs[HOSTS.tiers].p) || [];
  return p.length;
}

test("un script qui lit l'empreinte sur trois sites est bloqué ensuite sur un quatrième", async () => {
  for (const host of [HOSTS.a, HOSTS.b, HOSTS.c]) {
    assert.equal(await trackerRuns(host), true, "avant d'être appris, le script doit s'exécuter sur " + host);
    for (let i = 0; i < 12 && (await learnedCount()) < [HOSTS.a, HOSTS.b, HOSTS.c].indexOf(host) + 1; i++) await sleep(500);
  }
  assert.ok((await learnedCount()) >= 3, "le pisteur n'a pas été vu sur trois sites");
  await sleep(600);
  assert.equal(await trackerRuns(HOSTS.d), false, "le script aurait dû être bloqué sur un nouveau site");
});

test("le popup apprend combien de requêtes de pisteurs ont été coupées, et lesquelles", async () => {
  await trackerRuns(HOSTS.d);
  await sleep(400);
  const { pageStats } = await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.storage.session.get('pageStats').then(done)")
  );
  const pages = Object.values(pageStats);
  assert.ok(pages.some((t) => t.blocked && t.blocked.trackers >= 1), JSON.stringify(pageStats));
  assert.ok(pages.some((t) => t.domains && t.domains[HOSTS.tiers] >= 1), "le domaine bloqué doit figurer dans la liste");
});

test("l'exception d'un site laisse le pisteur s'exécuter, et seulement là", async () => {
  await setSettings({ trackerAllow: [HOSTS.d] });
  assert.equal(await trackerRuns(HOSTS.d), true, "exception du site");
  assert.equal(await trackerRuns(HOSTS.e), false, "un autre site reste protégé");
  await setSettings({ trackerAllow: [] });
  assert.equal(await trackerRuns(HOSTS.d), false, "exception retirée : bloqué de nouveau");
});

test("le réglage coupe le blocage des pisteurs appris", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, trackers: false } });
  try {
    assert.equal(await trackerRuns(HOSTS.d), true);
  } finally {
    await setSettings({ features: { ...features, trackers: true } });
  }
});

test("un site en exception (protection coupée) n'est pas touché", async () => {
  await setSettings({ allowlist: [HOSTS.d] });
  try {
    assert.equal(await trackerRuns(HOSTS.d), true);
  } finally {
    await setSettings({ allowlist: [] });
  }
});

test("« statistiques à zéro » fait oublier les pisteurs appris", async () => {
  await setSettings({ stats: null });
  await withExt.executeScript("return 1"); // le navigateur reste vivant
  await storageSet(withExt, { stats: { v: 3, since: Date.now(), flagged: 0, pisteurs: {}, safety: { checked: 0, alerts: 0 } } });
  await sleep(600);
  assert.equal(await trackerRuns(HOSTS.e), true, "sans statistiques, plus rien n'est appris donc rien n'est bloqué");
});
