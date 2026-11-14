// Faux pisteur : lit le canvas et l'audio, assez pour être classé « pisteur probable » (3 + 3 points).
(() => {
  window.__trackerRan = true; // absent si le script a été bloqué
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 50;
  const x = c.getContext("2d");
  x.font = "14px Arial";
  x.fillText("tracker", 2, 20);
  c.toDataURL();
  new OfflineAudioContext(1, 4410, 44100).createBuffer(1, 128, 44100).getChannelData(0);
})();
