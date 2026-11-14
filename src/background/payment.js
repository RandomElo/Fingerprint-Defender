// Paiement : à qui part ta carte ? Quand tu cliques dans un champ de carte, content.js (scams.js) nous dit qui recevra les
// données : le site lui-même, le prestataire dans un cadre, ou l'adresse où part le formulaire. Un prestataire connu (Stripe,
// PayPal...) passe. Tout autre destinataire est analysé comme n'importe quel site (listes de menaces, âge du domaine, imitation
// de marque...), et tu es averti si sa réputation est mauvaise. On ne bloque jamais un paiement : on prévient.
async function checkReceiver(host, s) {
  const known = fshPaymentProvider(host);
  if (known) return { host, name: known, known: true, verdict: "safe", score: 100, reasons: [] };
  const res = await Reputation.checkSite("https://" + host + "/", { online: s.safetyOnline });
  if (!res) return null;
  const reasons = res.findings.filter((f) => f.status === "bad" || f.status === "warn").map((f) => f.label).slice(0, 3);
  return { host, name: host, known: false, verdict: res.verdict, score: res.score, reasons };
}

async function onPaymentCheck(msg, sender) {
  const tab = sender.tab;
  const host = String(msg.host || "").toLowerCase();
  if (!tab || !/^[a-z0-9.-]+$/.test(host) || fshIsLocal(host)) return;
  const s = await settings();
  if (!s.enabled || !s.features.payment || isAllowed(s.allowlist, fshPageHost(tab.url))) return;

  const item = await checkReceiver(host, s);
  if (!item) return;
  notePage(tab.id, (t) => (t.payment = [...(t.payment || []).filter((p) => p.host !== item.host), item].slice(-4)));
  if (item.known || (item.verdict !== "doubtful" && item.verdict !== "dangerous")) return;

  recordScam({ kind: "payment", host: item.host, level: item.verdict, reasons: item.reasons });
  // L'avertissement s'affiche dans la page principale, même quand le champ de carte est dans un cadre.
  chrome.tabs.sendMessage(tab.id, { type: "payment-warning", item }, { frameId: 0 }).catch(() => {});
}
