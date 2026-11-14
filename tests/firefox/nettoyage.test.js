// Tests dans un vrai Firefox : nettoyage à la fermeture d'un site, bouton d'urgence, conteneur jetable et copie du lien propre.
// Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { HOSTS, startServer, startFirefox, storageGet, storageSet, inExtensionPage, sleep, waitFor, readClipboard, extensionOrigin } = require("./harness");

const A = "clean-a.example.com";
const B = "clean-b.example.org";
const PREFS = { "network.dns.localDomains": `${A},${B}`, "privacy.userContext.enabled": true };

let server;
let port;
let withExt;
let home; // l'onglet qui reste ouvert pendant les tests, sur un autre site

const url = (host, page = "probe.html") => `http://${host}:${port}/${page}?noearly=1`;
const cookie = () => withExt.executeScript("return document.cookie");

before(async () => {
  ({ server, port } = await startServer());
  withExt = await startFirefox({ extension: true, prefs: PREFS });
  await withExt.get(url(B));
  home = await withExt.getWindowHandle();
});

after(async () => {
  if (withExt) await withExt.quit();
  if (server) server.close();
});

async function setSettings(values) {
  await storageSet(withExt, values);
}

// Ouvre le site dans un nouvel onglet, y pose un cookie, le ferme, et renvoie le cookie vu en rouvrant le site.
async function cookieAfterClosing(host, { alsoOpen = false } = {}) {
  await withExt.switchTo().newWindow("tab");
  await withExt.get(url(host));
  await withExt.executeScript("document.cookie = 'sid=secret; path=/; max-age=3600'");
  let second = null;
  if (alsoOpen) {
    const first = await withExt.getWindowHandle();
    await withExt.switchTo().newWindow("tab");
    await withExt.get(url(host, "headers"));
    second = await withExt.getWindowHandle();
    await withExt.switchTo().window(first);
  }
  await withExt.close();
  await withExt.switchTo().window(second || home);
  await sleep(4500); // le nettoyage attend quelques secondes
  if (second) {
    await withExt.close();
    await withExt.switchTo().window(home);
  }
  await withExt.switchTo().newWindow("tab");
  await withExt.get(url(host));
  const seen = await cookie();
  await withExt.close();
  await withExt.switchTo().window(home);
  return seen;
}

test("par défaut, rien n'est effacé à la fermeture d'un onglet", async () => {
  assert.match(await cookieAfterClosing(A), /sid=secret/);
});

test("réglage activé : le cookie du site est effacé quand son dernier onglet se ferme", async () => {
  await setSettings({ cleanOnClose: true });
  assert.equal(await cookieAfterClosing(A), "");
});

test("un autre onglet du même site, ou un site de la liste « reste connecté » : rien n'est effacé", async () => {
  assert.match(await cookieAfterClosing(A, { alsoOpen: true }), /sid=secret/, "un onglet du site est resté ouvert");
  await setSettings({ cleanKeep: [A] });
  assert.match(await cookieAfterClosing(A), /sid=secret/, "site de la liste");
  await setSettings({ cleanKeep: [] });
});

test("une adresse locale n'est jamais nettoyée", async () => {
  assert.match(await cookieAfterClosing(HOSTS.a), /sid=secret/);
});

test("« copier le lien propre » met l'adresse nettoyée dans le presse-papiers", async () => {
  const sent = "https://www.amazon.fr/dp/B0ABC/ref=sr_1_1?keywords=chaussures&qid=1700000000&utm_source=x";
  await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const u = arguments[0], done = arguments[arguments.length - 1]; chrome.runtime.sendMessage({ type: 'copy-clean-link', url: u }).then(done)", sent)
  );
  await waitFor(async () => (await readClipboard(withExt)) === "https://www.amazon.fr/dp/B0ABC?keywords=chaussures", 3000, "adresse propre non copiée").catch(() => {});
  assert.equal(await readClipboard(withExt), "https://www.amazon.fr/dp/B0ABC?keywords=chaussures");
});

test("conteneur jetable : cookies séparés du reste, et conteneur supprimé à la fermeture de son onglet", async () => {
  await withExt.switchTo().newWindow("tab");
  await withExt.get(url(A));
  await withExt.executeScript("document.cookie = 'sid=defaut; path=/; max-age=3600'");
  const normal = await withExt.getWindowHandle();

  const before = (await withExt.getAllWindowHandles()).length;
  await inExtensionPage(withExt, () =>
    withExt.executeAsyncScript("const u = arguments[0], done = arguments[arguments.length - 1]; chrome.runtime.sendMessage({ type: 'open-disposable', url: u }).then(done)", url(A))
  );
  await waitFor(async () => (await withExt.getAllWindowHandles()).length > before, 5000, "aucun onglet ouvert");
  const handles = await withExt.getAllWindowHandles();
  await withExt.switchTo().window(handles[handles.length - 1]);
  await waitFor(async () => (await withExt.getCurrentUrl()).includes(A), 5000, "l'onglet jetable n'a pas chargé la page");
  assert.equal(await cookie(), "", "le conteneur jetable ne voit pas les cookies du reste");

  const names = () =>
    inExtensionPage(withExt, () =>
      withExt.executeAsyncScript("const done = arguments[arguments.length - 1]; browser.contextualIdentities.query({}).then((c) => done(c.map((x) => x.name)))")
    );
  assert.ok((await names()).some((n) => /^Jetable \d+$/.test(n)), "le conteneur doit exister");
  await withExt.close();
  await withExt.switchTo().window(normal);
  await waitFor(async () => !(await names()).some((n) => /^Jetable \d+$/.test(n)), 6000, "le conteneur n'a pas été supprimé");
  await withExt.close();
  await withExt.switchTo().window(home);
});

test("bouton d'urgence : onglets fermés, cookies effacés, nouvelle identité", async () => {
  await withExt.switchTo().newWindow("tab");
  await withExt.get(url(A));
  await withExt.executeScript("document.cookie = 'sid=secret; path=/; max-age=3600'");
  const seedBefore = (await storageGet(withExt, "seed")).seed;
  await storageSet(withExt, { habits: { "banque.fr": { n: 9, last: "2026-01-01" } } });

  // La page de l'extension qui envoie l'ordre est elle-même fermée : on envoie sans attendre la réponse.
  const origin = await extensionOrigin(withExt);
  await withExt.get(origin + "/src/pages/popup/popup.html");
  await withExt.executeScript("chrome.runtime.sendMessage({ type: 'panic', hours: 0 }).catch(() => {});");
  await waitFor(async () => (await withExt.getAllWindowHandles()).length === 1, 10000, "les onglets n'ont pas été fermés");
  await withExt.switchTo().window((await withExt.getAllWindowHandles())[0]);
  home = await withExt.getWindowHandle();

  await withExt.get(url(A));
  assert.equal(await cookie(), "", "les cookies doivent être effacés");
  const after = await waitFor(async () => {
    const s = await storageGet(withExt, ["seed", "habits"]);
    return s.seed !== seedBefore ? s : null;
  }, 5000, "l'identité n'a pas changé");
  assert.equal(after.habits["banque.fr"], undefined, "les sites habituels d'avant sont oubliés");
});
