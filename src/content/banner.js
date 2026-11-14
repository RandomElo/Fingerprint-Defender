// Bandeau d'avertissement affiché dans la page (monde isolé). Dans un shadow root fermé : le style de la page ne le
// touche pas et ses scripts ne le lisent pas. Disparaît seul après un moment, ou au clic sur « Fermer ».
// fshBanner({ title, text, level: "bad" | "warn" | "ok", buttons: [{ label, onClick }] }) renvoie une fonction qui le retire.
function fshBanner({ title, text, level = "bad", buttons = [] }) {
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const color = { bad: "#dc2626", warn: "#d97706", ok: "#16a34a" }[level] || "#dc2626";
  const style = document.createElement("style");
  style.textContent = `
    .box { width: min(400px, 92vw); font: 14px/1.4 system-ui, sans-serif; color: #1c1f24; background: #fff; border-radius: 12px;
           border-top: 6px solid ${color}; box-shadow: 0 10px 40px rgba(0,0,0,.35); padding: 14px 16px; }
    .box b { display: block; margin-bottom: 4px; font-size: 15px; }
    .box p { margin: 0 0 10px; word-break: break-word; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #c5cad3; background: #fff; cursor: pointer; }
    button.main { background: ${color}; border-color: ${color}; color: #fff; }`;
  const box = document.createElement("div");
  box.className = "box";
  const b = document.createElement("b");
  b.textContent = title;
  const p = document.createElement("p");
  p.textContent = text;
  const row = document.createElement("div");
  row.className = "row";
  const remove = () => host.remove();
  for (const { label, onClick } of buttons) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      remove();
      if (onClick) onClick();
    });
    row.append(btn);
  }
  const close = document.createElement("button");
  close.className = "main";
  close.textContent = "Fermer";
  close.addEventListener("click", remove);
  row.append(close);
  box.append(b, p, row);
  root.append(style, box);
  (document.documentElement || document).append(host);
  setTimeout(remove, 45000);
  return remove;
}
