const target = new URLSearchParams(location.search).get("u") || "";
let host = "";
try {
  const u = new URL(target);
  host = u.hostname;
  $("url").textContent = u.origin + u.pathname + (u.search ? "?…" : "");
} catch (_) {}
$("host").textContent = host;

async function go() {
  location.replace(target);
}

$("back").addEventListener("click", async () => {
  if (history.length > 1) history.back();
  else {
    const tab = await browser.tabs.getCurrent();
    browser.tabs.remove(tab.id);
  }
});

$("continue").addEventListener("click", async () => {
  const { bypass } = await chrome.storage.session.get({ bypass: {} });
  bypass[host] = Date.now(); // une heure
  await chrome.storage.session.set({ bypass });
  go();
});

$("trust").addEventListener("click", async () => {
  const { trusted } = await chrome.storage.local.get({ trusted: [] });
  if (!trusted.includes(host)) await chrome.storage.local.set({ trusted: [...trusted, host] });
  go();
});

(async () => {
  try {
    const res = await browser.runtime.sendMessage({ type: "check", url: target });
    if (!res) return;
    const box = mk("div");
    const head = mk("div", undefined, "result-head");
    const d = fshDisplay(res);
    const pill = mk("span", d.kind === "score" ? `${d.label} · ${res.score}/100` : d.label, "pill");
    pill.style.background = d.color;
    head.append(makeGauge(d, 72), pill);
    box.append(head);
    renderFindings(box, res);
    $("why").replaceChildren(box);
  } catch (_) {
    $("why").replaceChildren(mk("p", "Détails indisponibles pour le moment.", "msg"));
  }
})();
