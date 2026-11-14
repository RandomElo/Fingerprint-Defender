// Auto-test de cohérence. Injecté par le tableau de bord dans le monde de la page de l'onglet choisi, il fait
// ce que ferait un script de suivi : lire deux fois la même valeur, comparer la page à un cadre et à un
// worker, recouper l'écran avec le CSS. Une empreinte brouillée mais incohérente est plus facile à repérer
// qu'une empreinte réelle. Résultat : une liste { status: ok | warn | bad | info, label, detail }.
window.__fshSelfTest = async function () {
  const out = [];
  const add = (status, label, detail) => out.push({ status, label, detail });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function drawCanvas(canvas) {
    canvas.width = 240;
    canvas.height = 70;
    const x = canvas.getContext("2d");
    x.textBaseline = "top";
    x.font = "16px Arial";
    x.fillStyle = "#f60";
    x.fillRect(10, 10, 120, 34);
    x.fillStyle = "#069";
    x.fillText("Fingerprint Defender 😀", 4, 22);
    x.fillStyle = "rgba(102,204,0,.7)";
    x.fillText("Fingerprint Defender 😀", 6, 24);
    return canvas;
  }
  const canvasHash = (win) => hash(drawCanvas(win.document.createElement("canvas")).toDataURL());

  // 1. Deux lectures de suite donnent la même valeur ?
  try {
    const a = canvasHash(window);
    const b = canvasHash(window);
    if (a === b) add("ok", "Canvas stable", "Deux lectures successives donnent la même valeur.");
    else add("bad", "Canvas instable", "La valeur change à chaque lecture : un site qui compare deux lectures repère un bloqueur.");
  } catch (e) {
    add("info", "Canvas", "Non testable sur cette page : " + (e && e.message));
  }

  // 2. Les fonctions modifiées se présentent comme natives ?
  try {
    const fns = {
      "canvas.toDataURL": HTMLCanvasElement.prototype.toDataURL,
      "canvas.toBlob": HTMLCanvasElement.prototype.toBlob,
      "getImageData": CanvasRenderingContext2D.prototype.getImageData,
      "measureText": CanvasRenderingContext2D.prototype.measureText,
      "getBoundingClientRect": Element.prototype.getBoundingClientRect,
      "sendBeacon": Navigator.prototype.sendBeacon,
    };
    const bad = Object.entries(fns)
      .filter(([, f]) => !/\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(f)))
      .map(([n]) => n);
    if (bad.length) add("bad", "Fonctions visibles", "Ces fonctions ne se présentent plus comme natives : " + bad.join(", ") + ".");
    else add("ok", "Fonctions natives", "Les fonctions modifiées gardent leur apparence native.");
  } catch (e) {
    add("info", "Fonctions natives", "Non testable : " + (e && e.message));
  }

  // 3. Un cadre créé par la page voit la même chose que la page ? Deux cadres : l'un lu tout de suite
  // (limite connue : sa clé n'est pas encore arrivée), l'autre après un court délai (doit être cohérent).
  try {
    const own = canvasHash(window);
    const makeFrame = () => {
      const f = document.createElement("iframe");
      f.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
      (document.body || document.documentElement).append(f);
      return f;
    };
    const quick = makeFrame();
    const slow = makeFrame();
    let immediate;
    try {
      immediate = canvasHash(quick.contentWindow);
    } catch (_) {}
    await wait(500);
    const delayed = canvasHash(slow.contentWindow);
    quick.remove();
    slow.remove();
    if (delayed === own) add("ok", "Page et cadre cohérents", "Un cadre créé par la page et lu après un court délai donne la même valeur que la page.");
    else add("bad", "Page et cadre différents", "Un cadre créé par la page donne une autre valeur : un script peut comparer les deux et repérer le brouillage.");
    if (immediate !== undefined && immediate !== own) {
      add(
        "warn",
        "Cadre lu trop tôt",
        "Lu dans la milliseconde qui suit sa création, le cadre donne une valeur différente de celle de la page. Il devrait reprendre la clé de son parent : si tu vois ceci, c'est un cadre d'un autre site ou une anomalie."
      );
    }
  } catch (e) {
    add("info", "Cadre", "Non testable sur cette page : " + (e && e.message));
  }

  // 4. Un worker voit la même chose que la page ? (le worker de ce test est un blob, traité par inject.js)
  try {
    const pageBlob = await new Promise((res) => drawCanvas(document.createElement("canvas")).toBlob(res));
    const pageBytes = hash(String.fromCharCode(...new Uint8Array(await pageBlob.arrayBuffer())));
    const code = `onmessage = async () => {
      const r = { cores: navigator.hardwareConcurrency, langs: [...navigator.languages].join(",") };
      try {
        const c = new OffscreenCanvas(240, 70);
        const x = c.getContext("2d");
        x.textBaseline = "top"; x.font = "16px Arial";
        x.fillStyle = "#f60"; x.fillRect(10, 10, 120, 34);
        x.fillStyle = "#069"; x.fillText("Fingerprint Defender 😀", 4, 22);
        x.fillStyle = "rgba(102,204,0,.7)"; x.fillText("Fingerprint Defender 😀", 6, 24);
        const b = await c.convertToBlob();
        r.bytes = String.fromCharCode(...new Uint8Array(await b.arrayBuffer()));
      } catch (e) {}
      postMessage(r);
    }`;
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const worker = new Worker(url);
    const w = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pas de réponse du worker")), 4000);
      worker.onmessage = (e) => (clearTimeout(timer), resolve(e.data));
      worker.onerror = () => (clearTimeout(timer), reject(new Error("worker bloqué par la page")));
      worker.postMessage(0);
    });
    worker.terminate();
    URL.revokeObjectURL(url);
    const diff = [];
    if (w.cores !== navigator.hardwareConcurrency) diff.push("nombre de cœurs");
    if (w.langs !== [...navigator.languages].join(",")) diff.push("langues");
    if (w.bytes !== undefined && hash(w.bytes) !== pageBytes) diff.push("canvas");
    if (diff.length) {
      add(
        "warn",
        "Workers non couverts",
        "Un worker voit d'autres valeurs que la page (" + diff.join(", ") + ") : un script qui compare les deux voit les vraies valeurs. Cela arrive pour un worker lancé avant la clé du site, ou dont le script est servi en http sans en-tête Sec-Fetch-Dest."
      );
    } else {
      add("ok", "Page et worker cohérents", "Un worker voit les mêmes valeurs que la page.");
    }
  } catch (e) {
    add("info", "Workers", "Non testable sur cette page : " + (e && e.message));
  }

  // 5. Langues
  try {
    if (navigator.language !== navigator.languages[0]) {
      add("bad", "Langues incohérentes", "navigator.language ne correspond pas au premier élément de navigator.languages.");
    } else if (navigator.languages.length <= 2) {
      add("info", "Langues réduites", "La page voit " + navigator.languages.join(", ") + ". L'en-tête Accept-Language envoyé aux serveurs est réduit de la même façon (niveau renforcé).");
    } else {
      add("ok", "Langues", "navigator.language et navigator.languages sont cohérents.");
    }
  } catch (e) {
    add("info", "Langues", "Non testable : " + (e && e.message));
  }

  // 6. L'écran annoncé en JavaScript correspond à celui que révèle le CSS ?
  try {
    const w = matchMedia(`(device-width: ${screen.width}px)`).matches;
    const h = matchMedia(`(device-height: ${screen.height}px)`).matches;
    if (w && h) add("ok", "Écran cohérent avec le CSS", `screen annonce ${screen.width}×${screen.height}, le CSS donne la même taille.`);
    else add("warn", "Écran différent en CSS", `screen annonce ${screen.width}×${screen.height} mais une requête CSS (device-width) donne une autre taille : un site peut comparer les deux.`);
  } catch (e) {
    add("info", "Écran", "Non testable : " + (e && e.message));
  }

  // 7. La fenêtre tient dans l'écran annoncé ?
  if (window.innerWidth > screen.width || window.innerHeight > screen.height) {
    add("warn", "Fenêtre plus grande que l'écran", `La fenêtre fait ${innerWidth}×${innerHeight} pour un écran annoncé de ${screen.width}×${screen.height}.`);
  } else {
    add("ok", "Fenêtre et écran cohérents", "La fenêtre tient dans l'écran annoncé.");
  }

  return { host: location.hostname, checks: out };
};
// Valeur de fin de script : executeScript la renvoie, elle doit pouvoir être copiée (pas une fonction).
undefined;
