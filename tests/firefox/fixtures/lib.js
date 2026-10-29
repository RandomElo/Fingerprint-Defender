// Mesures partagées par les pages de test (insérées dans chaque page à la place de /*LIB*/).
function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function canvasHash() {
  const c = document.createElement("canvas");
  c.width = 240;
  c.height = 70;
  const x = c.getContext("2d");
  x.textBaseline = "top";
  x.font = "16px Arial";
  x.fillStyle = "#f60";
  x.fillRect(10, 10, 120, 34);
  x.fillStyle = "#069";
  x.fillText("Fingerprint Shield 😀", 4, 22);
  x.fillStyle = "rgba(102,204,0,.7)";
  x.fillText("Fingerprint Shield 😀", 6, 24);
  return fnv(c.toDataURL());
}
function measure() {
  const x = document.createElement("canvas").getContext("2d");
  x.font = "16px Arial";
  return x.measureText("Fingerprint Shield").width;
}
function rectWidth() {
  const d = document.createElement("div");
  d.style.cssText = "position:absolute;width:100.5px;height:20px";
  document.body.append(d);
  const w = d.getBoundingClientRect().width;
  d.remove();
  return w;
}
