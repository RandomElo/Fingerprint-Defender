// Banc de test : serveur local, Firefox piloté par Selenium, extension installée avec accès à tous les sites.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Builder, Browser } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const { download } = require("geckodriver");

process.env.SE_AVOID_STATS = "true";

const ROOT = path.resolve(__dirname, "../..");
const GECKODRIVER = "0.37.1"; // version figée : pas de question à GitHub à chaque lancement

// Firefox analyse tout le dossier d'une extension installée à la main : avec node_modules et les tests, l'installation
// prenait 3,4 s au lieu de 0,15 s. On lui donne un dossier temporaire qui ne contient que l'extension (des liens).
let extDir = null;
function extensionDir() {
  if (extDir) return extDir;
  extDir = fs.mkdtempSync(path.join(os.tmpdir(), "fingerprint-shield-ext-"));
  const names = ["manifest.json", "icons", "src"];
  for (const n of names) fs.symlinkSync(path.join(ROOT, n), path.join(extDir, n));
  process.on("exit", () => {
    try {
      for (const n of names) fs.unlinkSync(path.join(extDir, n)); // on retire les liens, jamais ce vers quoi ils pointent
      fs.rmdirSync(extDir);
    } catch (_) {}
  });
  return extDir;
}
const FIXTURES = path.join(__dirname, "fixtures");
const ADDON_ID = "fingerprint-defender@eloi.local";

// Les trois adresses de bouclage sont trois « sites » différents pour Firefox : une seule instance du serveur
// suffit. Ce sont des adresses locales, donc l'analyse de réputation de l'extension ne les envoie nulle part.
// c, d et e servent aux tests qui ont besoin de plusieurs sites distincts (un pisteur vu sur trois sites, une cible de balises).
const HOSTS = { a: "127.0.0.1", b: "127.0.0.2", tiers: "127.0.0.3", c: "127.0.0.4", d: "127.0.0.5", e: "127.0.0.6" };

function startServer() {
  // requêtes reçues : /beacon (balises) et /embed/... (contenus intégrés), pour vérifier ce qui est coupé ou chargé
  const hits = { beacon: 0, embed: 0, lastEmbedHost: "", files: 0 };
  const lib = fs.readFileSync(path.join(FIXTURES, "lib.js"), "utf8");
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    // Un fichier à télécharger : /files/<nom> répond comme un téléchargement, sous le nom demandé.
    if (pathname.startsWith("/files/")) {
      hits.files += 1;
      const name = decodeURIComponent(pathname.slice(7));
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" });
      return res.end("contenu du fichier de test");
    }
    // Un contenu intégré (cadre de vidéo) : on compte qui l'a demandé, sous quel nom d'hôte.
    if (pathname.startsWith("/embed/")) {
      hits.embed += 1;
      hits.lastEmbedHost = req.headers.host || "";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end("<!doctype html><meta charset=utf-8><body>contenu intégré chargé");
    }
    const name = path.basename(pathname) || "probe.html";
    // Renvoie les en-têtes reçus et l'adresse demandée, pour vérifier ce que le serveur d'un site voit réellement.
    if (pathname.split("/")[1] === "headers") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ ...req.headers, "x-test-url": req.url }));
    }
    // Reçoit les balises d'analyse (sendBeacon, ping).
    if (name === "beacon") {
      hits.beacon += 1;
      res.writeHead(204, { "access-control-allow-origin": "*" });
      return res.end();
    }
    const file = path.join(FIXTURES, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    const body = fs.readFileSync(file, "utf8").replace("/*LIB*/", () => lib);
    res.writeHead(200, { "content-type": types[path.extname(file)] || "text/plain", "cache-control": "no-store" });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve({ server, port: server.address().port, hits })));
}

// Firefox n'accorde pas l'accès aux sites à une extension MV3 installée temporairement : on le fait comme
// le bouton « Autoriser sur tous les sites » du popup, par le module de permissions du navigateur.
async function grantAllSites(driver) {
  driver.setContext(firefox.Context.CHROME);
  try {
    const out = await driver.executeAsyncScript(
      `const id = arguments[0];
       const done = arguments[arguments.length - 1];
       (async () => {
         const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
         const policy = WebExtensionPolicy.getByID(id);
         await ExtensionPermissions.add(id, { permissions: [], origins: ["<all_urls>"] }, policy.extension);
         return "ok";
       })().then(done, (e) => done("erreur : " + e));`,
      ADDON_ID
    );
    if (out !== "ok") throw new Error("Permissions non accordées : " + out);
  } finally {
    driver.setContext(firefox.Context.CONTENT);
  }
}

// Neuf Firefox qui démarrent en même temps se disputent parfois un port (Marionette) : un démarrage raté est repris
// quelques fois, avec une courte pause au hasard pour qu'ils ne se heurtent pas de nouveau. Chaque échec est écrit
// sur la sortie d'erreur, pour savoir si cela arrive souvent.
async function startFirefox(options) {
  let derniere;
  for (let essai = 1; essai <= 3; essai++) {
    try {
      return await startFirefoxOnce(options);
    } catch (e) {
      derniere = e;
      console.error(`démarrage de Firefox raté (essai ${essai}/3) : ${String(e.message).split("\n")[0]}`);
      await sleep(300 + Math.random() * 900);
    }
  }
  throw derniere;
}

async function startFirefoxOnce({ extension, prefs = {} }) {
  const options = new firefox.Options().addArguments("-headless");
  for (const [k, v] of Object.entries(prefs)) options.setPreference(k, v);
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  // --allow-system-access : sans lui, Firefox refuse le contexte « chrome » (nécessaire pour accorder l'accès
  // aux sites à l'extension et pour lire l'adresse interne de ses pages).
  const service = new firefox.ServiceBuilder(await download(GECKODRIVER)).addArguments("--allow-system-access");
  const driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
  if (extension) {
    try {
      await driver.installAddon(extensionDir(), true);
      await grantAllSites(driver);
      await waitFor(async () => (await storageGet(driver, "seed")).seed, 8000, "l'extension n'a pas posé sa graine"); // réglages initiaux posés
      // À l'installation, l'extension télécharge les listes de menaces et écrase celles qu'un test y aurait posées : on attend la
      // fin du téléchargement (environ une seconde ; hors ligne il échoue aussitôt). Sans réponse au bout de 20 s, on continue.
      await waitFor(async () => (await storageGet(driver, "feedsMeta")).feedsMeta, 20000, "listes non téléchargées").catch(() => {});
    } catch (e) {
      await driver.quit().catch(() => {});
      throw e;
    }
  }
  return driver;
}

// Charge une page de test et renvoie ce qu'elle a mesuré (window.__result), une fois `__ready` posé.
async function measureAt(driver, url) {
  await driver.get(url);
  await driver.wait(() => driver.executeScript("return window.__ready === true"), 10000, "page de test pas prête : " + url);
  return driver.executeScript("return window.__result");
}

// Accès au stockage de l'extension depuis une page de l'extension, ouverte dans un onglet à part.
async function inExtensionPage(driver, fn, page = "src/pages/popup/popup.html") {
  driver.setContext(firefox.Context.CHROME);
  const host = await driver.executeScript("return WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname", ADDON_ID);
  driver.setContext(firefox.Context.CONTENT);
  const main = await driver.getWindowHandle();
  await driver.switchTo().newWindow("tab");
  try {
    await driver.get(`moz-extension://${host}/${page}`);
    return await fn();
  } finally {
    await driver.close();
    await driver.switchTo().window(main);
  }
}
const storageGet = (driver, keys) =>
  inExtensionPage(driver, () =>
    driver.executeAsyncScript("const k = arguments[0]; const done = arguments[arguments.length - 1]; chrome.storage.local.get(k).then(done)", keys)
  );
// Écrit des réglages, puis attend que l'arrière-plan les ait pris en compte (un marqueur écrit avec eux, qu'il doit avoir vu),
// y compris ce qui en dépend : pisteurs appris, identifiants. Plus de délai fixe qui échoue quand la machine est chargée.
const storageSet = (driver, values) =>
  inExtensionPage(driver, () =>
    driver.executeAsyncScript(
      `const v = arguments[0], done = arguments[arguments.length - 1];
       (async () => {
         const marker = String(Math.random());
         await chrome.storage.local.set({ ...v, __sync: marker });
         for (let i = 0; i < 100; i++) {
           if ((await chrome.runtime.sendMessage({ type: "sync-marker" })) === marker) return true;
           await new Promise((r) => setTimeout(r, 40));
         }
         return "marqueur non vu";
       })().then(done, (e) => done("erreur : " + e));`,
      values
    )
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Compte les requêtes reçues par le serveur depuis `avant`. Une requête attendue arrive en quelques millisecondes : on
// s'arrête dès qu'elle est là. Une requête qui ne doit PAS arriver exige d'attendre toute la fenêtre `ms`.
async function hitsSince(hits, key, avant, ms = 500) {
  const fin = Date.now() + ms;
  while (Date.now() < fin && hits[key] <= avant) await sleep(30);
  if (hits[key] > avant) await sleep(80); // laisse arriver une éventuelle deuxième requête
  return hits[key] - avant;
}

// Attend qu'une condition devienne vraie (sans délai fixe) ; la renvoie, ou échoue après `ms`.
async function waitFor(fn, ms = 5000, message = "condition non remplie") {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fin) throw new Error(message);
    await sleep(80);
  }
}

// fetch lancé depuis la page ouverte dans `driver` : { ok, body } ou { ok: false, error }.
function fetchFrom(driver, target, init = {}) {
  return driver.executeAsyncScript(
    `const target = arguments[0], init = arguments[1], done = arguments[arguments.length - 1];
     fetch(target, init).then(async (r) => done({ ok: true, body: await r.text() }), (e) => done({ ok: false, error: String(e) }));`,
    target,
    init
  );
}

// Ce que contient le presse-papiers de Firefox, lu depuis le contexte « chrome » (null s'il est vide).
async function readClipboard(driver) {
  driver.setContext(firefox.Context.CHROME);
  try {
    return await driver.executeScript(`
      const clip = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
      const t = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
      t.init(null);
      t.addDataFlavor("text/plain");
      try {
        clip.getData(t, Ci.nsIClipboard.kGlobalClipboard, null);
        const o = {};
        t.getTransferData("text/plain", o);
        return o.value.QueryInterface(Ci.nsISupportsString).data;
      } catch (e) {
        return null;
      }`);
  } finally {
    driver.setContext(firefox.Context.CONTENT);
  }
}

// L'adresse interne de l'extension (moz-extension://...), pour ouvrir ses pages à la main.
async function extensionOrigin(driver) {
  driver.setContext(firefox.Context.CHROME);
  try {
    return "moz-extension://" + (await driver.executeScript("return WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname", ADDON_ID));
  } finally {
    driver.setContext(firefox.Context.CONTENT);
  }
}

module.exports = { HOSTS, startServer, startFirefox, measureAt, storageGet, storageSet, inExtensionPage, sleep, waitFor, hitsSince, fetchFrom, readClipboard, extensionOrigin };
