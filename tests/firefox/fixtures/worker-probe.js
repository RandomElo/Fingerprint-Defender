// Worker de test : lit la même empreinte que la page (canvas hors écran, cœurs, langues) et sa propre adresse.
onmessage = async () => {
  const r = {
    cores: navigator.hardwareConcurrency,
    langs: [...navigator.languages].join(","),
    name: self.name,
    href: self.location.href,
    keys: Object.getOwnPropertyNames(self).filter((k) => /fsh|FSH/.test(k)),
  };
  try {
    const c = new OffscreenCanvas(240, 70);
    const x = c.getContext("2d");
    x.textBaseline = "top";
    x.font = "16px Arial";
    x.fillStyle = "#f60";
    x.fillRect(10, 10, 120, 34);
    x.fillStyle = "#069";
    x.fillText("Fingerprint Shield 😀", 4, 22);
    x.fillStyle = "rgba(102,204,0,.7)";
    x.fillText("Fingerprint Shield 😀", 6, 24);
    const blob = await c.convertToBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const b of buf) s += String.fromCharCode(b);
    r.bytes = s;
  } catch (e) {
    r.error = String(e);
  }
  postMessage(r);
};
