// Pisteurs appris, domaines jamais bloqués et identifiants (fonctions pures de defaults.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({ URL });
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../src/shared/defaults.js"), "utf8") +
    "\nthis.api = { fshLearnedTrackers, fshTrackerBlocked, fshNeverBlock, fshIdentifierVariants, fshFindIdentifier, FSH_DEFAULTS };",
  ctx
);
const { fshLearnedTrackers, fshTrackerBlocked, fshNeverBlock, fshIdentifierVariants, fshFindIdentifier, FSH_DEFAULTS } = ctx.api;

const stats = (pisteurs) => ({ v: 3, pisteurs });
const vu = (...pages) => ({ n: pages.length, f: ["canvas", "audio"], p: pages });

test("un script vu sur trois sites différents devient un pisteur appris", () => {
  const l = fshLearnedTrackers(stats({ "tracker.example": vu("a.com", "b.org", "c.net") }));
  assert.ok(l.has("tracker.example"));
});

test("deux sites ne suffisent pas", () => {
  assert.ok(!fshLearnedTrackers(stats({ "tracker.example": vu("a.com", "b.org") })).has("tracker.example"));
});

test("les sous-domaines d'un même site comptent pour un seul site", () => {
  const l = fshLearnedTrackers(stats({ "tracker.example": vu("www.a.com", "shop.a.com", "blog.a.com", "m.a.com") }));
  assert.ok(!l.has("tracker.example"));
});

test("les domaines indispensables ne sont jamais appris, même vus partout", () => {
  const partout = vu("a.com", "b.org", "c.net", "d.fr");
  const l = fshLearnedTrackers(stats({ "stripe.com": partout, "cloudfront.net": partout, "online-metrix.net": partout, "tracker.example": partout }));
  assert.ok(l.has("tracker.example"));
  for (const d of ["stripe.com", "cloudfront.net", "online-metrix.net"]) assert.ok(!l.has(d), d);
});

test("statistiques absentes ou vides : rien d'appris", () => {
  assert.equal(fshLearnedTrackers(null).size, 0);
  assert.equal(fshLearnedTrackers({}).size, 0);
  assert.equal(fshLearnedTrackers(stats({})).size, 0);
});

test("Meet, Agenda, paiement, captcha et anti-fraude ne sont jamais bloqués", () => {
  for (const h of ["meet.google.com", "calendar.google.com", "www.gstatic.com", "js.stripe.com", "www.paypal.com", "challenges.cloudflare.com", "h.online-metrix.net", "api.adyen.com", "d1234.cloudfront.net"]) {
    assert.ok(fshNeverBlock(h), h);
  }
  for (const h of ["doubleclick.net", "tracker.example", "notstripe.com", "stripe.com.evil.net"]) assert.ok(!fshNeverBlock(h), h);
});

test("pisteur appris : bloqué depuis un autre site, pas sur son propre site", () => {
  const l = new Set(["tracker.example"]);
  assert.ok(fshTrackerBlocked(l, "www.shop.fr", "cdn.tracker.example"));
  assert.ok(!fshTrackerBlocked(l, "www.tracker.example", "cdn.tracker.example"));
  assert.ok(!fshTrackerBlocked(l, "www.shop.fr", "cdn.autre.example"));
});

test("pisteur appris : l'exception d'un site s'applique à lui et à ses sous-domaines seulement", () => {
  const l = new Set(["tracker.example"]);
  assert.ok(!fshTrackerBlocked(l, "www.shop.fr", "tracker.example", ["shop.fr"]));
  assert.ok(!fshTrackerBlocked(l, "shop.fr", "tracker.example", ["shop.fr"]));
  assert.ok(fshTrackerBlocked(l, "www.autre.fr", "tracker.example", ["shop.fr"]));
  assert.ok(fshTrackerBlocked(l, "notshop.fr", "tracker.example", ["shop.fr"]));
});

test("pisteur appris : sans page ou sans hôte, rien n'est bloqué", () => {
  const l = new Set(["tracker.example"]);
  assert.ok(!fshTrackerBlocked(l, "", "tracker.example"));
  assert.ok(!fshTrackerBlocked(l, "www.shop.fr", ""));
});

test("identifiants : adresse normalisée, numéro en chiffres avec le 0 et l'indicatif 33", () => {
  const v = fshIdentifierVariants({ emails: ["  Eloi@Example.COM "], phones: ["06 12 34 56 78", "+33 7 98 76 54 32"] });
  assert.deepEqual([...v.emails], ["eloi@example.com"]);
  assert.deepEqual([...v.phones].sort(), ["0612345678", "0798765432", "33612345678", "33798765432"]);
});

test("identifiants : valeurs invalides ou trop courtes ignorées", () => {
  const v = fshIdentifierVariants({ emails: ["pas une adresse", "", "a@b"], phones: ["123", "abc", ""] });
  assert.equal(v.emails.length, 0);
  assert.equal(v.phones.length, 0);
  assert.equal(fshIdentifierVariants(undefined).emails.length, 0);
});

test("identifiants : le haché SHA-256 d'une adresse est retrouvé dans une adresse de requête, en majuscules aussi", () => {
  const sha = crypto.createHash("sha256").update("eloi@example.com").digest("hex");
  assert.equal(fshFindIdentifier(`https://t.example/px?em=${sha.toUpperCase()}&x=1`, [sha]), sha);
  assert.equal(fshFindIdentifier("https://t.example/px?em=autre", [sha]), null);
});

test("identifiants : aucune valeur à chercher, aucune détection", () => {
  assert.equal(fshFindIdentifier("https://t.example/px?em=abc", []), null);
  assert.equal(fshFindIdentifier("https://t.example/px", [""]), null);
});

test("réglages par défaut : pisteurs appris actifs, aucun identifiant saisi", () => {
  assert.equal(FSH_DEFAULTS.features.trackers, true);
  assert.equal(FSH_DEFAULTS.features.identifiers, true);
  assert.equal(FSH_DEFAULTS.identifiers.emails.length, 0);
  assert.equal(FSH_DEFAULTS.trackerAllow.length, 0);
});
