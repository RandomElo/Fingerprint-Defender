// Tests des fonctions pures de defaults.js (aucun navigateur nécessaire).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// defaults.js est un script classique : on l'évalue dans un contexte isolé et on récupère ses fonctions.
const ctx = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../defaults.js"), "utf8") +
    "\nthis.api = { fshSiteKey, fshRegistrable, fshScore, fshIsLocal };",
  ctx
);
const { fshSiteKey, fshRegistrable, fshScore, fshIsLocal } = ctx.api;

const SEED = "0123456789abcdef0123456789abcdef";

test("la clé de site est stable pour une graine et un site donnés", () => {
  assert.equal(fshSiteKey(SEED, "example.com"), fshSiteKey(SEED, "example.com"));
});

test("la clé de site a le format attendu par inject.js (32 caractères hexadécimaux)", () => {
  assert.match(fshSiteKey(SEED, "example.com"), /^[0-9a-f]{32}$/);
});

test("deux sites ont deux clés différentes", () => {
  assert.notEqual(fshSiteKey(SEED, "example.com"), fshSiteKey(SEED, "example.org"));
});

test("deux graines donnent deux clés différentes pour le même site (Nouvelle identité)", () => {
  assert.notEqual(fshSiteKey(SEED, "example.com"), fshSiteKey(SEED.replace("0", "f"), "example.com"));
});

test("la clé ne contient pas la graine ni le nom du site", () => {
  const key = fshSiteKey(SEED, "example.com");
  assert.ok(!key.includes(SEED));
  assert.ok(!key.includes(SEED.slice(0, 8)));
});

test("la clé change beaucoup quand une seule lettre du site change (pas de motif exploitable)", () => {
  const a = fshSiteKey(SEED, "example.com");
  const b = fshSiteKey(SEED, "example.con");
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same += 1;
  assert.ok(same < 12, `${same} caractères identiques sur 32`);
});

test("pas de collision sur 2000 sites", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(fshSiteKey(SEED, `site${i}.example`));
  assert.equal(seen.size, 2000);
});

test("fshRegistrable garde le domaine enregistrable", () => {
  assert.equal(fshRegistrable("www.example.com"), "example.com");
  assert.equal(fshRegistrable("a.b.example.co.uk"), "example.co.uk");
  assert.equal(fshRegistrable("127.0.0.1"), "127.0.0.1");
});

test("fshIsLocal reconnaît le réseau local", () => {
  assert.ok(fshIsLocal("localhost"));
  assert.ok(fshIsLocal("192.168.1.10"));
  assert.ok(fshIsLocal("box.home"));
  assert.ok(!fshIsLocal("example.com"));
  assert.ok(!fshIsLocal("8.8.8.8"));
});

test("fshScore : un signal critique force un score très bas", () => {
  const r = fshScore([{ status: "bad", penalty: 0, critical: true }], 100);
  assert.equal(r.verdict, "dangerous");
  assert.ok(r.score <= 8);
});

test("fshScore : un site sans signal négatif et très connu reste fiable", () => {
  assert.equal(fshScore([], 100).verdict, "safe");
});
