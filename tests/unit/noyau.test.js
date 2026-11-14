// Le noyau de brouillage (src/shared/noise-core.js) sur une fenêtre factice : tailles d'écran de téléphone et de bureau.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({ Symbol, Proxy, Reflect, Object, Math, Array, Set, Map, WeakSet, WeakMap, JSON, Function, Promise, DOMException: Error });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/shared/noise-core.js"), "utf8"), ctx);
const core = ctx.__fshCore;

function fakeWindow({ w, h, touch }) {
  class Screen {
    get width() { return w; }
    get height() { return h; }
    get availWidth() { return w; }
    get availHeight() { return h - 40; }
    get colorDepth() { return 30; }
    get pixelDepth() { return 30; }
  }
  return {
    document: {},
    navigator: { maxTouchPoints: touch, userAgent: "Mozilla/5.0 Firefox/150.0" },
    Screen,
    screen: new Screen(),
  };
}
const env = { key: () => "k".repeat(32), active: () => true, strong: () => true, hit() {} };
const sizeOf = (opts) => {
  const win = fakeWindow(opts);
  core(win, env);
  return [win.screen.width, win.screen.height, win.screen.colorDepth];
};

test("un téléphone annonce une taille de téléphone, jamais un écran de bureau", () => {
  assert.deepEqual(sizeOf({ w: 412, h: 915, touch: 5 }), [412, 915, 24]);
  assert.deepEqual(sizeOf({ w: 411, h: 914, touch: 5 }), [412, 915, 24], "arrondi à la taille courante supérieure");
  assert.deepEqual(sizeOf({ w: 915, h: 412, touch: 5 }), [915, 412, 24], "à l'horizontale, les côtés sont échangés");
  assert.deepEqual(sizeOf({ w: 360, h: 780, touch: 5 }), [360, 800, 24]);
});

test("un écran de bureau garde ses tailles de bureau, un téléphone hors liste reste tel quel", () => {
  assert.deepEqual(sizeOf({ w: 1920, h: 1080, touch: 0 }), [1920, 1080, 24]);
  assert.deepEqual(sizeOf({ w: 1900, h: 1000, touch: 0 }), [1920, 1080, 24]);
  assert.deepEqual(sizeOf({ w: 480, h: 1100, touch: 5 }), [480, 1100, 24], "plus grand que toute taille de la liste");
});

test("un portable tactile large garde des tailles de bureau", () => {
  assert.deepEqual(sizeOf({ w: 1366, h: 768, touch: 10 }), [1366, 768, 24]);
});
