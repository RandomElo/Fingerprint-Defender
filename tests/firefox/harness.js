// Banc de test : serveur local, Firefox piloté par Selenium, extension installée avec accès à tous les sites.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Builder, Browser } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const { download } = require("geckodriver");

process.env.SE_AVOID_STATS = "true";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures");
const ADDON_ID = "fingerprint-defender@eloi.local";

// Les trois adresses de bouclage sont trois « sites » différents pour Firefox : une seule instance du serveur
// suffit. Ce sont des adresses locales, donc l'analyse de réputation de l'extension ne les envoie nulle part.
const HOSTS = { a: "127.0.0.1", b: "127.0.0.2", tiers: "127.0.0.3" };

function startServer() {
  const lib = fs.readFileSync(path.join(FIXTURES, "lib.js"), "utf8");
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  const server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url, "http://x").pathname) || "probe.html";
    // Renvoie les en-têtes reçus, pour vérifier ce que le serveur d'un site voit réellement.
    if (name === "headers") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return res.end(JSON.stringify(req.headers));
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
  return new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve({ server, port: server.address().port })));
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

async function startFirefox({ extension, prefs = {} }) {
  const options = new firefox.Options().addArguments("-headless");
  for (const [k, v] of Object.entries(prefs)) options.setPreference(k, v);
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  // --allow-system-access : sans lui, Firefox refuse le contexte « chrome » (nécessaire pour accorder l'accès
  // aux sites à l'extension et pour lire l'adresse interne de ses pages).
  const service = new firefox.ServiceBuilder(await download()).addArguments("--allow-system-access");
  const driver = await new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
  if (extension) {
    await driver.installAddon(ROOT, true);
    await grantAllSites(driver);
    await driver.sleep(1500); // laisse l'extension poser ses réglages et sa graine
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
async function inExtensionPage(driver, fn, page = "popup.html") {
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
const storageSet = (driver, values) =>
  inExtensionPage(driver, () =>
    driver.executeAsyncScript("const v = arguments[0]; const done = arguments[arguments.length - 1]; chrome.storage.local.set(v).then(() => done(true))", values)
  );

module.exports = { HOSTS, startServer, startFirefox, measureAt, storageGet, storageSet, inExtensionPage };
