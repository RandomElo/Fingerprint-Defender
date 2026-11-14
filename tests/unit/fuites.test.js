// Réseau local, Referer et hôtes de page (fonctions pures de defaults.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Le contexte isolé n'a pas les classes du navigateur : on lui donne URL, comme dans l'extension.
const ctx = vm.createContext({ URL });
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../src/shared/defaults.js"), "utf8") +
    "\nthis.api = { fshPageHost, fshLocalName, fshLocalAccessBlocked, fshTrimReferer, FSH_DEFAULTS };",
  ctx
);
const { fshPageHost, fshLocalName, fshLocalAccessBlocked, fshTrimReferer, FSH_DEFAULTS } = ctx.api;

test("fshPageHost : page web, origine d'un blob, et rien pour le reste", () => {
  assert.equal(fshPageHost("https://www.example.com/a?b=1"), "www.example.com");
  assert.equal(fshPageHost("blob:https://tracker.example/abc-def"), "tracker.example");
  assert.equal(fshPageHost("wss://live.example/socket"), "live.example");
  assert.equal(fshPageHost("moz-extension://abc/page.html"), "");
  assert.equal(fshPageHost("about:blank"), "");
  assert.equal(fshPageHost(""), "");
  assert.equal(fshPageHost("n'importe quoi"), "");
});

test("fshLocalName : adresses locales et noms qui y mènent", () => {
  for (const h of ["localhost", "127.0.0.1", "192.168.1.1", "10.0.0.5", "box.home", "[::1]", "localtest.me", "app.lvh.me", "192.168.1.10.nip.io", "10-0-0-1.sslip.io"]) {
    assert.ok(fshLocalName(h), h);
  }
});

test("fshLocalName : un nom public ordinaire n'est pas local", () => {
  for (const h of ["example.com", "www.google.com", "8.8.8.8", "1.2.3.4.nip.io", "nip.io", "fake-localhost.com"]) {
    assert.ok(!fshLocalName(h), h);
  }
});

test("un site public ne peut pas joindre le réseau local", () => {
  assert.ok(fshLocalAccessBlocked("evil.example.com", "192.168.1.1"));
  assert.ok(fshLocalAccessBlocked("evil.example.com", "127.0.0.1"));
  assert.ok(fshLocalAccessBlocked("evil.example.com", "localhost"));
  assert.ok(fshLocalAccessBlocked("evil.example.com", "10.0.0.138.nip.io"));
});

test("un appareil local peut parler à un autre, et un site public à un autre site public", () => {
  assert.ok(!fshLocalAccessBlocked("192.168.1.2", "192.168.1.1"));
  assert.ok(!fshLocalAccessBlocked("nas.home", "localhost"));
  assert.ok(!fshLocalAccessBlocked("www.example.com", "cdn.example.net"));
  assert.ok(!fshLocalAccessBlocked("", "192.168.1.1"));
  assert.ok(!fshLocalAccessBlocked("www.example.com", ""));
});

test("exceptions intégrées (applications de bureau) et exceptions de l'utilisateur", () => {
  assert.ok(!fshLocalAccessBlocked("app.zoom.us", "127.0.0.1"));
  assert.ok(!fshLocalAccessBlocked("open.spotify.com", "127.0.0.1"));
  assert.ok(!fshLocalAccessBlocked("monsite.example.com", "127.0.0.1", ["example.com"]));
  assert.ok(fshLocalAccessBlocked("monsite.example.com", "127.0.0.1", ["autre.com"]));
});

test("une exception ne s'étend pas à un domaine qui ressemble au service", () => {
  assert.ok(fshLocalAccessBlocked("zoom.us.evil.com", "127.0.0.1"));
  assert.ok(fshLocalAccessBlocked("notzoom.us", "127.0.0.1"));
});

test("Referer : réduit à l'origine vers un autre site", () => {
  assert.equal(fshTrimReferer("https://shop.example.com/commande/42?token=abc", "https://tracker.net/pixel"), "https://shop.example.com/");
  assert.equal(fshTrimReferer("http://127.0.0.1:8080/a/b?c=d", "http://127.0.0.2:8080/x"), "http://127.0.0.1:8080/");
});

test("Referer : inchangé pour le même site, ses sous-domaines ou une valeur inattendue", () => {
  assert.equal(fshTrimReferer("https://www.example.com/a?b=1", "https://cdn.example.com/x.js"), "https://www.example.com/a?b=1");
  assert.equal(fshTrimReferer("https://example.com/a", "https://example.com/b"), "https://example.com/a");
  assert.equal(fshTrimReferer("n'importe quoi", "https://example.com/"), "n'importe quoi");
  assert.equal(fshTrimReferer("https://example.com/", "pas une adresse"), "https://example.com/");
});

test("réglages par défaut : protections réseau actives, WebRTC relais désactivé", () => {
  assert.equal(FSH_DEFAULTS.features.localnet, true);
  assert.equal(FSH_DEFAULTS.features.referer, true);
  assert.equal(FSH_DEFAULTS.features.webrtcRelay, false);
  assert.equal(FSH_DEFAULTS.localnetAllow.length, 0);
});

test("fshTimezoneVsCountry : fuseau et pays de sortie", () => {
  const f = require("node:vm").runInNewContext(
    require("node:fs").readFileSync(require("node:path").join(__dirname, "../../src/shared/defaults.js"), "utf8") + "\nfshTimezoneVsCountry",
    { URL }
  );
  assert.equal(f("Europe/Paris", "FR"), "match");
  assert.equal(f("Europe/Paris", "fr"), "match");
  assert.equal(f("Europe/Paris", "US"), "mismatch");
  assert.equal(f("America/New_York", "CA"), "mismatch");
  assert.equal(f("Pacific/Chatham", "NZ"), "unknown", "fuseau absent de la table");
  assert.equal(f("Europe/Paris", ""), "unknown");
  assert.equal(f("Europe/Paris", "XXX"), "unknown");
});
