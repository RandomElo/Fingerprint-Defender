// Calibrage du score de fiabilité et détection de boutique (fonctions pures de defaults.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../defaults.js"), "utf8") + "\nthis.api = { fshScore, fshLooksLikeShop, fshPageKind, fshWithPage };",
  ctx
);
const { fshScore, fshLooksLikeShop, fshPageKind, fshWithPage } = ctx.api;

const f = (label, status, penalty, extra = {}) => ({ label, status, penalty, critical: false, cap: null, ...extra });
const ok = (label) => f(label, "ok", 0);

// Profil de kyara.games : domaine de 25 jours, un an d'enregistrement, propriétaire masqué, hors classement.
// Rien d'autre à reprocher (listes, DNS filtrants, HTTPS, nom normal).
const jeune = (extra = []) => [
  f("Âge du domaine", "warn", 45, { soft: true, softCap: 40 }),
  f("Popularité du site", "warn", 10, { soft: true }),
  f("Durée d'enregistrement", "warn", 8, { soft: true }),
  f("Propriétaire du domaine", "warn", 8, { soft: true }),
  ok("Cloudflare Sécurité"),
  ok("Quad9"),
  ok("Connexion chiffrée"),
  ...extra,
];

test("un site neuf sans autre signal est douteux, pas dangereux", () => {
  const r = fshScore(jeune(), 90);
  assert.equal(r.verdict, "doubtful");
  assert.equal(r.score, 50);
});

test("les signes de jeunesse ne s'additionnent pas au-delà du plafond", () => {
  const r = fshScore(jeune(), 90);
  const seul = fshScore([f("Âge du domaine", "warn", 45, { soft: true, softCap: 40 })], 90);
  assert.equal(r.score, seul.score);
});

test("un site neuf avec un vrai signal reste dangereux", () => {
  const imitation = f("Imitation de marque", "bad", 55, { cap: 35 });
  assert.equal(fshScore(jeune([imitation]), 90).verdict, "dangerous");
  const http = f("Connexion chiffrée", "warn", 20);
  assert.equal(fshScore(jeune([http]), 90).verdict, "dangerous");
});

test("un signal critique reste dangereux et très bas", () => {
  const r = fshScore([f("OpenPhish", "bad", 100, { critical: true })], 90);
  assert.equal(r.verdict, "dangerous");
  assert.ok(r.score <= 8);
});

test("plus le domaine est jeune, plus le plafond est lourd", () => {
  const at = (cap) => fshScore([f("Âge du domaine", "warn", 99, { soft: true, softCap: cap })], 90).score;
  assert.ok(at(40) < at(28) && at(28) < at(20) && at(20) < at(12));
});

test("un domaine ancien mais peu connu reste fiable", () => {
  const r = fshScore(
    [
      f("Âge du domaine", "ok", -8),
      f("Popularité du site", "warn", 6, { soft: true }),
      f("Propriétaire du domaine", "warn", 6, { soft: true }),
    ],
    90
  );
  assert.equal(r.verdict, "safe");
});

test("sans âge connu, les signes souples sont plafonnés à 24", () => {
  const r = fshScore([f("Âge du domaine", "info", 12, { soft: true }), f("Popularité du site", "warn", 10, { soft: true }), f("Propriétaire", "warn", 8, { soft: true })], 90);
  assert.equal(r.score, 66);
});

test("une boutique sans mentions légales plafonne toujours le score", () => {
  const r = fshScore([ok("Âge du domaine"), f("Mentions légales", "warn", 30, { cap: 40 })], 90);
  assert.ok(r.score <= 40);
  assert.equal(r.verdict, "dangerous");
});

test("boutique classique avec panier", () => {
  assert.ok(fshLooksLikeShop("ajouter au panier  panier (0)  commander maintenant"));
});

test("boutique de jeu : prix en vraie monnaie et mots d'achat, sans panier", () => {
  assert.ok(fshLooksLikeShop("pack premium 4,99 € acheter    pack légendaire 9,99 € acheter"));
  assert.ok(fshLooksLikeShop("boutique : abonnement $5 / mois, pack $12, buy now"));
});

test("un jeu gratuit de cartes n'est pas une boutique", () => {
  const accueil = "ouvre des boosters gratuits toutes les 10 minutes, collectionne plus de 6 000 personnages d'anime, échange et vends tes cartes";
  assert.ok(!fshLooksLikeShop(accueil));
});

test("un seul prix ou un seul mot d'achat ne suffit pas", () => {
  assert.ok(!fshLooksLikeShop("notre livre coûte 12 € chez l'éditeur"));
  assert.ok(!fshLooksLikeShop("acheter acheter acheter achat boutique"));
});

// Texte de la page /soutien de kyara.games (phrases lues dans le module de la page).
const SOUTIEN = `kyara est gratuit et le restera. l'abonnement aide à payer les serveurs et le temps passé à créer le jeu.
  s'abonner sur patreon. abonne-toi sur patreon, puis clique sur « synchroniser ». ton compte patreon est lié.
  paiement sécurisé par stripe. aucun avantage sur les cartes. 3 € par mois, 6 € par mois, 12 € par mois. gérer mon abonnement`;

test("une page de soutien avec abonnement facultatif n'est pas une boutique", () => {
  assert.equal(fshPageKind(SOUTIEN, false), "support");
  assert.ok(!fshLooksLikeShop(SOUTIEN));
});

test("une boutique de jeu sans panier est une boutique allégée", () => {
  assert.equal(fshPageKind("pack premium 4,99 € acheter    pack légendaire 9,99 € acheter", false), "shop-light");
  assert.ok(fshLooksLikeShop("pack premium 4,99 € acheter    pack légendaire 9,99 € acheter"));
});

test("un panier avéré est une boutique complète", () => {
  assert.equal(fshPageKind("ajouter au panier   mon panier   commander", false), "shop");
});

test("un panier reste une boutique même si la page parle de soutien", () => {
  assert.equal(fshPageKind("soutien soutien panier panier panier", false), "shop");
  assert.equal(fshPageKind("soutenez-nous, don libre", true), "shop");
});

test("« don't » n'est pas un don", () => {
  assert.equal(fshPageKind("we don't know. you don't care", false), null);
});

// Résultat de base d'un site très connu (YouTube) et signaux lus dans sa page : prix, « acheter », pas de lien légal.
const connu = { host: "www.youtube.com", base: 100, ageDays: null, findings: [f("Site très connu", "ok", 0)] };
const signauxBoutique = {
  shop: true,
  findings: [
    f("Boutique en ligne", "info", 0),
    f("Mentions légales", "warn", 30, { cap: 40 }),
    f("Contact", "warn", 12),
  ],
};

test("un site très connu n'est pas jugé comme une boutique (YouTube ne tombe plus à 40)", () => {
  const r = fshWithPage(connu, signauxBoutique);
  assert.equal(r.score, 100);
  assert.equal(r.verdict, "safe");
});

test("un site très connu reste surveillé pour les mots de passe envoyés ailleurs", () => {
  const phishing = { shop: false, findings: [f("Mot de passe envoyé ailleurs", "warn", 40, { cap: 35 })] };
  const r = fshWithPage(connu, phishing);
  assert.ok(r.score <= 35);
  assert.equal(r.verdict, "dangerous");
});

test("un site inconnu sans mentions légales reste plafonné à 40", () => {
  const inconnu = { host: "boutique-x.example", base: 90, ageDays: 800, findings: [f("Âge du domaine", "ok", 0)] };
  const r = fshWithPage(inconnu, signauxBoutique);
  assert.ok(r.score <= 40);
});

test("une boutique allégée (prix sans panier, sans mentions légales) n'est plus plafonnée", () => {
  const inconnu = { host: "jeu.example", base: 90, ageDays: 800, findings: [f("Âge du domaine", "ok", 0)] };
  const legere = { shop: false, findings: [f("Boutique en ligne", "info", 0), f("Mentions légales", "warn", 8), f("Contact", "warn", 4)] };
  const r = fshWithPage(inconnu, legere);
  assert.equal(r.score, 78);
  assert.equal(r.verdict, "safe");
});

test("boutique récente : seulement pour un site inconnu et une vraie boutique", () => {
  const recent = { host: "x.example", base: 90, ageDays: 100, findings: [] };
  assert.ok(fshWithPage(recent, { shop: true, findings: [] }).findings.some((x) => x.label === "Boutique récente"));
  assert.ok(!fshWithPage(recent, { shop: false, findings: [] }).findings.some((x) => x.label === "Boutique récente"));
  assert.ok(!fshWithPage({ ...connu, ageDays: 100 }, { shop: true, findings: [] }).findings.some((x) => x.label === "Boutique récente"));
});
