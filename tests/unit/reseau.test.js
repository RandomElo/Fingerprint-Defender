// En-têtes cohérents et changement automatique d'identité (fonctions pures de defaults.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../defaults.js"), "utf8") + "\nthis.api = { fshAcceptLanguage, fshSeedDue, FSH_DEFAULTS };",
  ctx
);
const { fshAcceptLanguage, fshSeedDue, FSH_DEFAULTS } = ctx.api;

test("Accept-Language est réduit à la langue et à sa langue de base", () => {
  assert.equal(fshAcceptLanguage("fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"), "fr-FR,fr;q=0.9");
  assert.equal(fshAcceptLanguage("en-GB,en;q=0.5,fr;q=0.3"), "en-GB,en;q=0.9");
});

test("Accept-Language déjà réduit : inchangé", () => {
  assert.equal(fshAcceptLanguage("en-US,en;q=0.5"), "en-US,en;q=0.5");
  assert.equal(fshAcceptLanguage("fr"), "fr");
  assert.equal(fshAcceptLanguage("fr-FR"), "fr-FR");
});

test("Accept-Language sans région : on garde la première langue seule", () => {
  assert.equal(fshAcceptLanguage("fr,en;q=0.5,de;q=0.3"), "fr");
});

test("Accept-Language inattendu : inchangé", () => {
  assert.equal(fshAcceptLanguage("*"), "*");
  assert.equal(fshAcceptLanguage(""), "");
  assert.equal(fshAcceptLanguage(undefined), undefined);
});

test("le résultat correspond à navigator.languages réduit par inject.js", () => {
  // inject.js : [...new Set([first, first.split("-")[0]])]
  const reduit = (first) => [...new Set([first, first.split("-")[0]])];
  for (const h of ["fr-FR,fr;q=0.9,en;q=0.8", "de-CH,de;q=0.9,fr;q=0.5", "ja,en;q=0.5"]) {
    const tags = fshAcceptLanguage(h).split(",").map((t) => t.split(";")[0]);
    assert.deepEqual(tags, reduit(h.split(",")[0].split(";")[0]));
  }
});

const DAY = 86400000;
test("rotation : jamais ne change rien", () => {
  assert.equal(fshSeedDue("never", 0, Date.now(), true), false);
});

test("rotation : à chaque démarrage, seulement au démarrage", () => {
  assert.equal(fshSeedDue("session", Date.now(), Date.now(), true), true);
  assert.equal(fshSeedDue("session", 0, Date.now(), false), false);
});

test("rotation : chaque jour et chaque semaine", () => {
  const now = 100 * DAY;
  assert.equal(fshSeedDue("daily", now - DAY + 1000, now, false), false);
  assert.equal(fshSeedDue("daily", now - DAY, now, false), true);
  assert.equal(fshSeedDue("weekly", now - 6 * DAY, now, false), false);
  assert.equal(fshSeedDue("weekly", now - 7 * DAY, now, false), true);
});

test("rotation : une graine sans date est considérée comme ancienne", () => {
  assert.equal(fshSeedDue("daily", undefined, 100 * DAY, false), true);
});

test("réglages par défaut : pas de rotation, signal GPC actif", () => {
  assert.equal(FSH_DEFAULTS.seedRotation, "never");
  assert.equal(FSH_DEFAULTS.features.gpc, true);
});
