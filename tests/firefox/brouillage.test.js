// Phase 2 : brouillage complet. Workers (http et blob), cadres lus dès leur création, surfaces ajoutées, cohérence écran et WebGL.
// Lancer avec : node --test tests/firefox/brouillage.test.js
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const firefox = require("selenium-webdriver/firefox");
const { HOSTS, startServer, startFirefox, storageSet, inExtensionPage } = require("./harness");

let server;
let port;
let ff;
const url = (host, page = "worker-page.html", q = "") => `http://${host}:${port}/${page}${q}`;

async function open(host, q = "") {
  await ff.get(url(host, "worker-page.html", q));
  await ff.wait(() => ff.executeScript("return window.__ready === true"), 10000);
  await new Promise((r) => setTimeout(r, 800)); // la clé du site arrive après le démarrage de la page
}
const call = (expr) => ff.executeAsyncScript(`const done = arguments[arguments.length - 1]; Promise.resolve(${expr}).then(done, (e) => done({ error: String(e) }))`);

before(async () => {
  ({ server, port } = await startServer());
  ff = await startFirefox({ extension: true, prefs: { "extensions.allowPrivateBrowsingByDefault": true } });
  await storageSet(ff, { enabled: true, level: "renforce" });
});
after(async () => {
  if (ff) await ff.quit();
  if (server) server.close();
});

for (const [label, src] of [
  ["dont le script vient d'une adresse http", `"worker-probe.js"`],
  ["dont le script est un blob", `URL.createObjectURL(new Blob([await (await fetch("worker-probe.js")).text()], { type: "text/javascript" }))`],
]) {
  test(`un worker ${label} voit les mêmes valeurs que la page`, async () => {
    await open(HOSTS.a);
    const r = await call(`(async () => run(${src}))()`);
    assert.ok(!r.error, r.error);
    assert.equal(r.worker.error, undefined, "le worker n'a pas pu dessiner : " + r.worker.error);
    assert.equal(r.worker.cores, r.page.cores, "nombre de cœurs différent");
    assert.equal(r.worker.langs, r.page.langs, "langues différentes");
    assert.equal(r.worker.png, r.page.png, "le canvas du worker diffère de celui de la page");
  });
}

test("le worker n'est pas laissé avec les vraies valeurs quand la protection est coupée pour le site", async () => {
  await storageSet(ff, { enabled: false });
  await open(HOSTS.a);
  const off = await call(`run("worker-probe.js")`);
  await storageSet(ff, { enabled: true });
  await open(HOSTS.a);
  const on = await call(`run("worker-probe.js")`);
  assert.notEqual(off.worker.png, on.worker.png, "le worker donne la même image avec et sans l'extension");
});

test("le worker garde son nom, son adresse, et ne montre aucune trace", async () => {
  await open(HOSTS.a);
  const r = await call(`run("worker-probe.js", { name: "mon-worker" })`);
  assert.equal(r.worker.name, "mon-worker");
  assert.match(r.worker.href, /\/worker-probe\.js$/);
  assert.deepEqual(r.worker.keys, []);
  const sans = await call(`run("worker-probe.js")`);
  assert.equal(sans.worker.name, "", "le nom vide doit rester vide");
});

test("deux sites différents donnent deux empreintes de worker différentes, un même site la même", async () => {
  await open(HOSTS.a);
  const a1 = await call(`run("worker-probe.js")`);
  await open(HOSTS.b);
  const b = await call(`run("worker-probe.js")`);
  await open(HOSTS.a);
  const a2 = await call(`run("worker-probe.js")`);
  assert.notEqual(a1.worker.png, b.worker.png);
  assert.equal(a1.worker.png, a2.worker.png);
});

test("un worker dédié en module est brouillé aussi", async () => {
  await open(HOSTS.a);
  const r = await call(`run("worker-probe.js", { type: "module" })`);
  assert.ok(!r.error, r.error);
  assert.equal(r.worker.cores, r.page.cores);
  assert.equal(r.worker.png, r.page.png);
});

test("un cadre créé par la page et lu aussitôt donne la même valeur que la page, et reste natif", async () => {
  await open(HOSTS.a);
  const r = await call(`frameNow()`);
  assert.equal(r.canvas, r.page, "le cadre lu tout de suite n'est pas brouillé comme la page");
  assert.equal(r.cores, 4);
  assert.equal(r.native, true, "la fonction du cadre ne se présente plus comme native");
  const srcdoc = await call(`frameNow("<p>x</p>")`);
  assert.equal(srcdoc.canvas, srcdoc.page);
});

test("un cadre n'est jamais brouillé deux fois (même valeur que la page, lu tout de suite puis plus tard)", async () => {
  await open(HOSTS.a);
  const r = await call(`(async () => {
    const f = document.createElement("iframe");
    document.body.append(f);
    const early = frameNow();
    await new Promise((r) => setTimeout(r, 600));
    const w = f.contentWindow;
    const c = w.document.createElement("canvas"); c.width = 240; c.height = 70;
    const x = c.getContext("2d"); x.textBaseline = "top"; x.font = "16px Arial"; x.fillStyle = "#f60"; x.fillRect(10, 10, 120, 34);
    x.fillStyle = "#069"; x.fillText("Fingerprint Shield 😀", 4, 22); x.fillStyle = "rgba(102,204,0,.7)"; x.fillText("Fingerprint Shield 😀", 6, 24);
    const late = fnv(c.toDataURL());
    return { early, late, page: early.page };
  })()`);
  assert.equal(r.late, r.page, "le cadre, une fois chargé, ne donne plus la même valeur que la page (double bruit ?)");
});

test("les requêtes CSS d'écran suivent les valeurs annoncées", async () => {
  await open(HOSTS.a);
  const s = await call(`surfaces()`);
  assert.equal(s.mqExact, true, "device-width/height ne correspondent pas à screen");
  assert.equal(s.mqMin, false, "min-device-width au-dessus de screen.width ne doit pas correspondre");
  assert.equal(s.mqMax, true);
  assert.equal(s.gamutSrgb, true);
  assert.equal(s.gamutP3, false, "le gamut large ne doit pas être annoncé");
});

test("le quota de stockage est fixe et l'usage arrondi", async () => {
  await open(HOSTS.a);
  const s = await call(`surfaces()`);
  assert.equal(s.quota, 8 * 1024 ** 3);
  assert.equal(s.usageMo, true);
});

test("WebGL : limites d'un profil Intel et extensions rares retirées", async () => {
  await open(HOSTS.a);
  const s = await call(`surfaces()`);
  if (!s.gl) return; // pas de WebGL dans ce Firefox sans carte graphique
  assert.ok(s.gl.tex <= 16384);
  assert.ok(s.gl.vertexUniforms <= 1024);
  assert.ok(s.gl.viewport.every((v) => v <= 16384));
  assert.equal(s.gl.vendor, "Intel");
  assert.equal(s.gl.rare, null);
  assert.ok(!s.gl.ext.includes("WEBGL_compressed_texture_astc"));
});

test("une police uniquement locale et rare n'est pas trouvée, une police courante oui", async () => {
  await open(HOSTS.a);
  const s = await call(`surfaces()`);
  assert.equal(s.fontRare, false);
  assert.equal(s.fontCommon !== undefined, true);
});

test("le noyau ne laisse aucun nom dans la page", async () => {
  await open(HOSTS.a);
  const names = await ff.executeScript(`return Object.getOwnPropertyNames(window).filter(n => /fsh|FSH|fshCore/i.test(n))`);
  assert.deepEqual(names, []);
});

test("une page ne peut pas se faire donner la clé du site par la demande réservée aux cadres", async () => {
  await open(HOSTS.a);
  const r = await ff.executeScript(`
    const get = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency").get;
    const v = get.call(navigator, Symbol.for("fsh-key-9d41"));
    return typeof v === "object" ? JSON.stringify(v) : v;`);
  assert.equal(typeof r, "number", "la page a obtenu autre chose que le nombre de cœurs : " + r);
});

// Une page ouverte par l'extension dans un contexte donné (conteneur, fenêtre privée), et la largeur de texte qu'elle y mesure. On mesure
// du texte plutôt qu'un canvas : Firefox bruite lui-même le canvas selon le conteneur, ce qui masquerait notre propre clé.
const FINGERPRINT = `() => {
  const x = document.createElement("canvas").getContext("2d");
  x.font = "16px Arial";
  return String(x.measureText("Fingerprint Shield").width);
}`;
const fingerprintIn = (pageUrl, how) =>
  inExtensionPage(ff, () =>
    ff.executeAsyncScript(
      `const [pageUrl, how, fn] = arguments; const done = arguments[arguments.length - 1];
       (async () => {
         let tab, win;
         if (how === "private") { win = await chrome.windows.create({ url: pageUrl, incognito: true }); tab = win.tabs[0]; }
         else if (how === "default") tab = await chrome.tabs.create({ url: pageUrl, active: false });
         else {
           const list = await browser.contextualIdentities.query({ name: how });
           const id = list[0] || (await browser.contextualIdentities.create({ name: how, color: "blue", icon: "fingerprint" }));
           tab = await chrome.tabs.create({ url: pageUrl, active: false, cookieStoreId: id.cookieStoreId });
         }
         for (let i = 0; i < 100; i++) { const t = await chrome.tabs.get(tab.id); if (t.status === "complete" && t.url.startsWith("http")) break; await new Promise((r) => setTimeout(r, 100)); }
         await new Promise((r) => setTimeout(r, 900));
         let out;
         try { out = (await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: eval("(" + fn + ")") }))[0].result; }
         catch (e) { out = "erreur : " + e.message; }
         if (win) await chrome.windows.remove(win.id); else await chrome.tabs.remove(tab.id);
         return out;
       })().then(done, (e) => done("erreur : " + e));`,
      pageUrl, how, FINGERPRINT
    )
  );

test("un même site a une empreinte différente dans un conteneur et dans l'onglet normal, stable dans chacun", async () => {
  const u = url(HOSTS.a, "worker-page.html");
  const normal = await fingerprintIn(u, "default");
  const normalBis = await fingerprintIn(u, "default");
  const travail = await fingerprintIn(u, "Travail");
  const travailBis = await fingerprintIn(u, "Travail");
  const perso = await fingerprintIn(u, "Perso");
  assert.match(normal, /^[0-9.]+$/, normal);
  assert.equal(normal, normalBis, "l'onglet normal n'est pas stable");
  assert.equal(travail, travailBis, "le conteneur n'est pas stable");
  assert.notEqual(normal, travail, "un conteneur partage l'empreinte de l'onglet normal");
  assert.notEqual(travail, perso, "deux conteneurs partagent la même empreinte");
});

// Autorise l'extension en navigation privée, comme la case du gestionnaire de modules.
async function allowPrivate() {
  ff.setContext(firefox.Context.CHROME);
  try {
    return await ff.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       (async () => {
         const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
         const policy = WebExtensionPolicy.getByID("fingerprint-shield@eloi.local");
         await ExtensionPermissions.add("fingerprint-shield@eloi.local", { permissions: ["internal:privateBrowsingAllowed"], origins: [] }, policy.extension);
         return "ok";
       })().then(done, (e) => done("erreur : " + e));`
    );
  } finally {
    ff.setContext(firefox.Context.CONTENT);
  }
}

test("une fenêtre privée a sa propre empreinte, différente à chaque nouvelle fenêtre", async () => {
  assert.equal(await allowPrivate(), "ok");
  const u = url(HOSTS.a, "worker-page.html");
  const normal = await fingerprintIn(u, "default");
  const p1 = await fingerprintIn(u, "private");
  const p2 = await fingerprintIn(u, "private");
  assert.match(p1, /^[0-9.]+$/, "le script de contenu ne tourne pas en navigation privée : " + p1);
  assert.notEqual(p1, normal, "la fenêtre privée partage l'empreinte de l'onglet normal");
  assert.notEqual(p1, p2, "deux fenêtres privées successives ont la même empreinte");
});

test("capteurs de mouvement : accéléromètre, gyroscope et orientation arrondis", async () => {
  await open(HOSTS.a);
  const r = await ff.executeScript(`
    const m = new DeviceMotionEvent("devicemotion", {
      accelerationIncludingGravity: { x: 1.2345, y: -0.0412, z: 9.8123 },
      rotationRate: { alpha: 0.7321, beta: -1.2, gamma: 0.2 },
    });
    const o = new DeviceOrientationEvent("deviceorientation", { alpha: 12.3456, beta: -45.6789, gamma: 3.3333 });
    return { g: m.accelerationIncludingGravity, r: m.rotationRate, o: [o.alpha, o.beta, o.gamma],
             stable: m.accelerationIncludingGravity === m.accelerationIncludingGravity };`);
  assert.deepEqual([r.g.x, r.g.y, r.g.z], [1.2, 0, 9.8]);
  assert.deepEqual([r.r.alpha, r.r.beta, r.r.gamma], [0.5, -1, 0]);
  assert.deepEqual(r.o, [12.5, -45.5, 3.5]);
  assert.equal(r.stable, true, "deux lectures donnent deux objets différents");
});
