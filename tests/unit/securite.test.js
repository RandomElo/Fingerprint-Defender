// Faute de frappe sur un site habituel et téléchargements dangereux (fonctions pures de defaults.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({ URL });
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../src/shared/defaults.js"), "utf8") + "\nthis.api = { fshLooksLikeHabit, fshWithinOne, fshDownloadRisk, fshCertIssuer, fshRootChange, fshWithPage, fshFakeLoginUrl, fshTabDisguised, FSH_DEFAULTS };",
  ctx
);
const { fshLooksLikeHabit, fshWithinOne, fshDownloadRisk, fshCertIssuer, fshRootChange, fshWithPage, fshFakeLoginUrl, fshTabDisguised, FSH_DEFAULTS } = ctx.api;

const HABITS = { "paypal.com": { n: 12 }, "mabanque.fr": { n: 9 }, "amazon.fr": { n: 30 }, "github.com": { n: 25 }, "x.com": { n: 40 }, "rare-site.fr": { n: 2 } };

test("fshWithinOne : une lettre de différence, pas plus", () => {
  assert.ok(fshWithinOne("paypal", "paypa"));
  assert.ok(fshWithinOne("paypal", "paypall"));
  assert.ok(fshWithinOne("paypal", "paypol"));
  assert.ok(!fshWithinOne("paypal", "paypal"));
  assert.ok(!fshWithinOne("paypal", "pypaal"));
  assert.ok(!fshWithinOne("paypal", "pay"));
});

test("faute de frappe : un chiffre pour une lettre, une lettre en moins ou en plus", () => {
  assert.equal(fshLooksLikeHabit("paypa1.com", HABITS), "paypal.com");
  assert.equal(fshLooksLikeHabit("www.paypa1.com", HABITS), "paypal.com");
  assert.equal(fshLooksLikeHabit("mabanqe.fr", HABITS), "mabanque.fr");
  assert.equal(fshLooksLikeHabit("mabanquee.fr", HABITS), "mabanque.fr");
  assert.equal(fshLooksLikeHabit("rnabanque.fr", HABITS), "mabanque.fr", "rn pour m");
  assert.equal(fshLooksLikeHabit("githubs.io", HABITS), "github.com", "une lettre en trop");
});

test("même nom avec une extension à risque, ou un mot ajouté", () => {
  assert.equal(fshLooksLikeHabit("paypal.xyz", HABITS), "paypal.com");
  assert.equal(fshLooksLikeHabit("mabanque.shop", HABITS), "mabanque.fr");
  assert.equal(fshLooksLikeHabit("mabanque-secure.fr", HABITS), "mabanque.fr");
  assert.equal(fshLooksLikeHabit("secure-paypal.com", HABITS), "paypal.com");
});

test("le même nom avec une autre extension ordinaire n'est pas signalé (amazon.de quand on va sur amazon.fr)", () => {
  for (const h of ["amazon.de", "amazon.com", "amazon.es", "mabanque.com", "paypal.fr"]) assert.equal(fshLooksLikeHabit(h, HABITS), null, h);
});

test("un site habituel lui-même, ses sous-domaines et un site sans rapport ne sont pas signalés", () => {
  for (const h of ["paypal.com", "www.paypal.com", "checkout.paypal.com", "exemple.fr", "lemonde.fr", "gitlab.com"]) {
    assert.equal(fshLooksLikeHabit(h, HABITS), null, h);
  }
});

test("les noms courts sont ignorés (trop de faux positifs) et les sites peu visités ne comptent pas", () => {
  assert.equal(fshLooksLikeHabit("y.com", HABITS), null);
  assert.equal(fshLooksLikeHabit("x.shop", HABITS), null);
  assert.equal(fshLooksLikeHabit("rare-sit.fr", HABITS), null, "rare-site.fr n'est visité que 2 jours");
});

test("un site déjà visité plusieurs jours n'est jamais signalé, même proche d'un site habituel", () => {
  assert.equal(fshLooksLikeHabit("mabanqe.fr", { ...HABITS, "mabanqe.fr": { n: 3 } }), null);
});

test("aucun historique, aucune adresse : rien à signaler", () => {
  assert.equal(fshLooksLikeHabit("paypa1.com", {}), null);
  assert.equal(fshLooksLikeHabit("", HABITS), null);
  assert.equal(fshLooksLikeHabit("localhost", HABITS), null);
});

test("téléchargements : double extension, exécutable, ou rien", () => {
  for (const f of ["facture.pdf.exe", "photo.jpg.scr", "rapport.docx.js".replace(".js", ".vbs"), "CV.pdf.bat", "C:\\Users\\x\\Downloads\\scan.png.exe", "/home/x/releve.xlsx.cmd"]) {
    assert.equal(fshDownloadRisk(f), "double", f);
  }
  for (const f of ["setup.exe", "installer.msi", "script.ps1", "/tmp/outil.bat", "update.hta"]) assert.equal(fshDownloadRisk(f), "executable", f);
});

test("téléchargements ordinaires : jamais signalés", () => {
  for (const f of ["rapport.pdf", "photo.jpg", "archive.zip", "musique.mp3", "notes.txt", "app.js", "page.html", "image.exe.png", "livre.epub", "", null, undefined]) {
    assert.equal(fshDownloadRisk(f), null, String(f));
  }
});

test("réglages par défaut : faute de frappe et téléchargements actifs", () => {
  assert.equal(FSH_DEFAULTS.features.typo, true);
  assert.equal(FSH_DEFAULTS.features.downloads, true);
});

// --- certificats ----------------------------------------------------------------------------------------------

test("émetteur d'un certificat : l'organisation, sinon le nom commun", () => {
  assert.equal(fshCertIssuer("CN=R3, O=Let's Encrypt, C=US"), "Let's Encrypt");
  assert.equal(fshCertIssuer('CN=DigiCert TLS RSA SHA256 2020 CA1,O="DigiCert, Inc.",C=US'), "DigiCert, Inc.");
  assert.equal(fshCertIssuer("CN=Autorité interne"), "Autorité interne");
  assert.equal(fshCertIssuer(""), "");
  assert.equal(fshCertIssuer(undefined), "");
});

test("interception : un site habituel dont le certificat ne vient plus d'une autorité reconnue", () => {
  assert.ok(fshRootChange({ builtIn: true, n: 5 }, false));
  assert.ok(fshRootChange({ builtIn: true, n: 2 }, false));
});

test("pas d'interception : premier passage, une seule visite, ou rien de changé", () => {
  assert.ok(!fshRootChange(undefined, false), "site jamais vu");
  assert.ok(!fshRootChange({ builtIn: true, n: 1 }, false), "une seule visite : pas assez de recul");
  assert.ok(!fshRootChange({ builtIn: true, n: 9 }, true), "toujours une autorité reconnue");
  assert.ok(!fshRootChange({ builtIn: false, n: 9 }, false), "antivirus déjà présent depuis le début : pas un changement");
  assert.ok(!fshRootChange({ builtIn: true, n: 9 }, null), "information absente");
});

const res = (over = {}) => ({ host: "x.example", base: 90, ageDays: 20, findings: [], ...over });
const DAY = 86400000;

test("certificat émis il y a un jour sur un domaine de 20 jours : avertissement", () => {
  const r = fshWithPage(res(), { shop: false, findings: [], tls: { validFrom: Date.now() - DAY } });
  assert.ok(r.findings.some((f) => f.label === "Certificat tout neuf"));
});

test("certificat neuf mais domaine ancien, ou certificat ancien sur domaine récent : rien", () => {
  assert.ok(!fshWithPage(res({ ageDays: 800 }), { findings: [], tls: { validFrom: Date.now() - DAY } }).findings.some((f) => f.label === "Certificat tout neuf"));
  assert.ok(!fshWithPage(res({ ageDays: 20 }), { findings: [], tls: { validFrom: Date.now() - 40 * DAY } }).findings.some((f) => f.label === "Certificat tout neuf"));
  assert.ok(!fshWithPage(res({ ageDays: null }), { findings: [], tls: { validFrom: Date.now() - DAY } }).findings.some((f) => f.label === "Certificat tout neuf"));
});

test("un site très connu n'est jamais touché par la règle du certificat neuf", () => {
  const r = fshWithPage(res({ base: 100, ageDays: 20 }), { findings: [], tls: { validFrom: Date.now() - DAY } });
  assert.ok(!r.findings.some((f) => f.label === "Certificat tout neuf"));
});

// --- fausse fenêtre de connexion et onglet déguisé ----------------------------------------------------------------

test("une fausse barre d'adresse qui affiche un service de connexion, sur une page qui n'en est pas un : repérée", () => {
  assert.equal(fshFakeLoginUrl("https://accounts.google.com/signin/v2/identifier?hl=fr", "jeu-concours.example"), "accounts.google.com");
  assert.equal(fshFakeLoginUrl("  https://login.microsoftonline.com/common/oauth2  ", "offre.example"), "login.microsoftonline.com");
  assert.equal(fshFakeLoginUrl("https://www.facebook.com/login", "quiz.example"), "www.facebook.com");
});

test("la vraie page du service, une phrase qui cite l'adresse ou du texte ordinaire : pas signalés", () => {
  assert.equal(fshFakeLoginUrl("https://accounts.google.com/signin", "accounts.google.com"), null, "c'est la vraie page");
  assert.equal(fshFakeLoginUrl("https://accounts.google.com/signin", "mail.google.com"), null, "même site");
  assert.equal(fshFakeLoginUrl("Rendez-vous sur https://accounts.google.com/signin pour changer votre mot de passe", "aide.example"), null);
  assert.equal(fshFakeLoginUrl("https://exemple.fr/connexion", "boutique.example"), null, "service inconnu");
  assert.equal(fshFakeLoginUrl("", "x.example"), null);
  assert.equal(fshFakeLoginUrl(undefined, "x.example"), null);
});

test("onglet déguisé : un titre de connexion apparu, ou un mot de passe apparu", () => {
  const avant = { title: "Les meilleures recettes", icon: "/a.ico", hasPassword: false };
  assert.ok(fshTabDisguised(avant, { title: "Connexion à votre compte", icon: "/a.ico", hasPassword: false }));
  assert.ok(fshTabDisguised(avant, { title: "Sign in to continue", icon: "/g.ico", hasPassword: true }));
  assert.ok(fshTabDisguised(avant, { title: "Les meilleures recettes", icon: "/a.ico", hasPassword: true }), "un mot de passe est apparu");
});

test("onglet normal : un compteur de messages, un changement banal ou une page de connexion qui l'était déjà ne sont pas signalés", () => {
  const avant = { title: "Boîte de réception", icon: "/a.ico", hasPassword: false };
  assert.ok(!fshTabDisguised(avant, { title: "(3) Boîte de réception", icon: "/b.ico", hasPassword: false }));
  assert.ok(!fshTabDisguised(avant, { title: "Boîte de réception", icon: "/a.ico", hasPassword: false }));
  const login = { title: "Connexion", icon: "/a.ico", hasPassword: true };
  assert.ok(!fshTabDisguised(login, { title: "Connexion", icon: "/b.ico", hasPassword: true }), "c'était déjà une page de connexion");
});

// --- nettoyage ------------------------------------------------------------------------------------------------

const clean = vm.runInContext("fshShouldCleanSite", ctx);

test("nettoyage : un site dont aucun onglet ne reste ouvert est nettoyé", () => {
  assert.ok(clean("www.exemple.fr", [], []));
  assert.ok(clean("shop.exemple.fr", [], ["autre.com", "mail.autre.org"]));
});

test("nettoyage : pas tant qu'un onglet du même site reste ouvert, sous-domaine compris", () => {
  assert.ok(!clean("www.exemple.fr", [], ["blog.exemple.fr"]));
  assert.ok(!clean("exemple.fr", [], ["www.exemple.fr"]));
});

test("nettoyage : jamais pour la liste de sites où l'on reste connecté, ni pour une adresse locale", () => {
  assert.ok(!clean("mail.exemple.fr", ["exemple.fr"], []));
  assert.ok(!clean("www.banque.fr", ["www.banque.fr"], []));
  assert.ok(!clean("localhost", [], []));
  assert.ok(!clean("127.0.0.1", [], []));
  assert.ok(!clean("nas.home", [], []));
  assert.ok(!clean("", [], []));
});

test("nettoyage : un nom proche d'un site gardé n'est pas gardé", () => {
  assert.ok(clean("exemple.fr.pirate.net", ["exemple.fr"], []));
  assert.ok(clean("notexemple.fr", ["exemple.fr"], []));
});

test("nettoyage : désactivé par défaut", () => {
  assert.equal(FSH_DEFAULTS.cleanOnClose, false);
  assert.equal(FSH_DEFAULTS.cleanKeep.length, 0);
  assert.equal(FSH_DEFAULTS.features.disposable, true);
});

// --- vie privée, bilan, export ---------------------------------------------------------------------------------

const { fshPrivacy, fshTopThirdParties, fshChattiestSites, fshWeekTotals, fshExportSettings, fshImportSettings } = vm.runInContext(
  "({ fshPrivacy, fshTopThirdParties, fshChattiestSites, fshWeekTotals, fshExportSettings, fshImportSettings })",
  ctx
);

test("vie privée : une page sobre est discrète, une page qui appelle beaucoup de tiers et des pisteurs est envahissante", () => {
  assert.deepEqual({ ...fshPrivacy({ third: 2 }) }, { score: 100, label: "discret" });
  assert.equal(fshPrivacy({ third: 3 }).score, 100, "trois tiers sont normaux");
  assert.equal(fshPrivacy({ third: 10 }).label, "bavard");
  assert.equal(fshPrivacy({ third: 30, flagged: 2, identifiers: 1, blocked: 10 }).label, "envahissant");
  assert.ok(fshPrivacy({ third: 500, flagged: 50, identifiers: 5, blocked: 999 }).score >= 0, "jamais négatif");
  assert.equal(fshPrivacy().score, 100);
});

test("tiers présents sur le plus de sites, et sites les plus bavards", () => {
  const graph = { "a.fr": ["pub.net", "stats.io"], "b.fr": ["pub.net", "stats.io", "cdn.org"], "c.fr": ["pub.net"] };
  assert.deepEqual(JSON.parse(JSON.stringify(fshTopThirdParties(graph))), [
    { domain: "pub.net", sites: 3 },
    { domain: "stats.io", sites: 2 },
    { domain: "cdn.org", sites: 1 },
  ]);
  assert.equal(fshChattiestSites(graph)[0].site, "b.fr");
  assert.equal(fshTopThirdParties({}).length, 0);
  assert.equal(fshTopThirdParties(undefined).length, 0);
});

test("bilan : les sept derniers jours seulement", () => {
  const now = Date.UTC(2026, 9, 31, 12);
  const day = (n) => new Date(now - n * 86400000).toISOString().slice(0, 10);
  const daily = { [day(0)]: { blocked: 4, trackers: 3, beacons: 1 }, [day(6)]: { blocked: 2, trackers: 2 }, [day(7)]: { blocked: 100, trackers: 100 } };
  const w = fshWeekTotals(daily, now);
  assert.equal(w.blocked, 6);
  assert.equal(w.trackers, 5);
  assert.equal(w.beacons, 1);
  assert.equal(Object.keys(fshWeekTotals({}, now)).length, 0);
});

test("export : les réglages et les listes de sites, jamais la graine, les identifiants ni l'historique", () => {
  const stored = { enabled: true, level: "prudent", seed: "secret", seedAt: 1, identifiers: { emails: ["a@b.fr"], phones: [] }, habits: { "x.fr": { n: 9 } }, stats: { v: 3 }, allowlist: ["meet.google.com"], cleanKeep: ["mail.fr"], features: { gpc: false } };
  const out = fshExportSettings(stored);
  assert.equal(out.app, "fingerprint-shield");
  const txt = JSON.stringify(out);
  for (const secret of ["secret", "a@b.fr", "x.fr", "seedAt"]) assert.ok(!txt.includes(secret), secret);
  assert.deepEqual(JSON.parse(JSON.stringify(out.settings.allowlist)), ["meet.google.com"]);
  assert.equal(out.settings.features.gpc, false);
  assert.equal(out.settings.features.canvas, true, "les réglages absents prennent leur valeur par défaut");
});

test("import : un export relu à l'identique, et tout ce qui est inconnu ou mal typé refusé", () => {
  const stored = { level: "prudent", allowlist: ["meet.google.com"], cleanOnClose: true, features: { gpc: false } };
  const r = fshImportSettings(JSON.stringify(fshExportSettings(stored)));
  assert.ok(r.ok);
  assert.equal(r.values.level, "prudent");
  assert.equal(r.values.cleanOnClose, true);
  assert.equal(r.values.features.gpc, false);
  assert.deepEqual(JSON.parse(JSON.stringify(r.values.allowlist)), ["meet.google.com"]);

  const bad = fshImportSettings(
    JSON.stringify({ app: "fingerprint-shield", version: 1, settings: { seed: "x", identifiers: { emails: ["a@b.fr"] }, level: 3, allowlist: "pas une liste", enabled: "oui", features: { canvas: "oui", inconnue: true, gpc: true }, cleanKeep: ["ok.fr", 5] } })
  );
  assert.ok(bad.ok);
  assert.equal(Object.keys(bad.values).join(","), "features", "seul ce qui est valide est gardé");
  assert.equal(Object.keys(bad.values.features).join(","), "gpc");
  for (const k of ["seed", "identifiers", "level", "allowlist", "enabled", "features.canvas", "features.inconnue", "cleanKeep"]) assert.ok(bad.rejected.includes(k), k);
});

test("import : un fichier qui n'est pas un export est refusé", () => {
  for (const t of ["pas du json", "{}", "[]", JSON.stringify({ app: "autre", settings: {} }), JSON.stringify({ app: "fingerprint-shield" }), ""]) {
    assert.equal(fshImportSettings(t).ok, false, t);
  }
});
