// Tests dans un vrai Firefox : commandes piégées copiées par une page (ClickFix) et adresses remplacées au moment de copier.
// Le contenu du presse-papiers est lu depuis le contexte « chrome » de Firefox. Lancer avec : npm run test:firefox
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { By } = require("selenium-webdriver");
const { HOSTS, startServer, startFirefox, storageGet, storageSet, sleep, waitFor, readClipboard } = require("./harness");

let server;
let port;
let plain;
let withExt;

const url = (page) => `http://${HOSTS.a}:${port}/${page}`;
const click = (driver, id) => driver.findElement(By.id(id)).click();

// Attend qu'une alerte dont une raison correspond à `re` figure au tableau de bord (le message passe par la page, puis par l'arrière-plan).
const alertFor = (re) =>
  waitFor(async () => ((await storageGet(withExt, "alerts")).alerts || []).find((a) => a.reasons.some((r) => re.test(r))), 5000, "alerte absente : " + re);

async function setSettings(values) {
  await storageSet(withExt, values);
  await sleep(300);
}

// Met du texte neutre dans le presse-papiers, clique le bouton de la page, et renvoie ce que le presse-papiers contient ensuite.
async function afterClick(driver, page, button) {
  await driver.get(url(page));
  await click(driver, "marqueur");
  await waitFor(async () => (await readClipboard(driver)) === "marqueur-neutre", 3000, "le marqueur n'est pas dans le presse-papiers");
  await click(driver, button);
  await sleep(500);
  return readClipboard(driver);
}

before(async () => {
  ({ server, port } = await startServer());
  [plain, withExt] = await Promise.all([startFirefox({ extension: false }), startFirefox({ extension: true })]);
});

after(async () => {
  if (plain) await plain.quit();
  if (withExt) await withExt.quit();
  if (server) server.close();
});

test("ClickFix : la commande n'arrive pas dans le presse-papiers (témoin : Firefox seul la copie)", async () => {
  assert.match(await afterClick(plain, "clickfix.html", "verify"), /iex/, "témoin : sans l'extension la commande est copiée");
  assert.equal(await afterClick(withExt, "clickfix.html", "verify"), "marqueur-neutre", "la commande ne doit pas remplacer le presse-papiers");
});

test("l'alerte est enregistrée dans le tableau de bord", async () => {
  await afterClick(withExt, "clickfix.html", "verify");
  await alertFor(/ClickFix/);
});

test("la même sorte de commande dans une documentation est copiée normalement", async () => {
  assert.match(await afterClick(withExt, "doc-install.html", "copy"), /curl .*\| sh/);
});

test("PowerShell caché et encodé : bloqué même sur une page sans consigne", async () => {
  assert.equal(await afterClick(withExt, "obfusque.html", "copy"), "marqueur-neutre");
});

test("IBAN remplacé au moment de copier : le vrai IBAN reste dans le presse-papiers (témoin : Firefox seul copie l'autre)", async () => {
  await plain.get(url("remplacement.html"));
  await click(plain, "copy");
  await waitFor(async () => (await readClipboard(plain)) === "FR7600000000000000000000000", 3000, "témoin : la page doit remplacer l'IBAN").catch(() => {});
  assert.equal(await readClipboard(plain), "FR7600000000000000000000000", "témoin : la page remplace l'IBAN");

  await withExt.get(url("remplacement.html"));
  await click(withExt, "copy");
  await waitFor(async () => (await readClipboard(withExt)) === "FR76 3000 6000 0112 3456 7890 189", 3000, "l'IBAN n'a pas été copié").catch(() => {});
  assert.equal(await readClipboard(withExt), "FR76 3000 6000 0112 3456 7890 189", "l'IBAN copié doit rester celui que tu as sélectionné");
  await alertFor(/Adresse remplacée/);
});

test("le réglage et l'exception d'un site coupent la protection", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, scams: false } });
  try {
    assert.match(await afterClick(withExt, "clickfix.html", "verify"), /iex/, "réglage coupé");
  } finally {
    await setSettings({ features: { ...features, scams: true } });
  }
  await setSettings({ allowlist: [HOSTS.a] });
  try {
    assert.match(await afterClick(withExt, "clickfix.html", "verify"), /iex/, "site en exception");
  } finally {
    await setSettings({ allowlist: [] });
  }
});

test("un lien de suivi ajouté à ce que tu copies est retiré (témoin : Firefox seul le garde)", async () => {
  const texte = "Une phrase de l'article que je copie pour la citer.";
  await plain.get(url("copie-lien.html"));
  await click(plain, "copy");
  await waitFor(async () => /Lire la suite/.test((await readClipboard(plain)) || ""), 3000, "témoin : le site doit ajouter son lien").catch(() => {});
  assert.match(await readClipboard(plain), /Lire la suite sur https:\/\/journal\.example/, "témoin : Firefox seul copie le lien ajouté");

  await withExt.get(url("copie-lien.html"));
  await click(withExt, "copy");
  await waitFor(async () => (await readClipboard(withExt)) === texte, 3000, "texte non copié").catch(() => {});
  assert.equal(await readClipboard(withExt), texte, "seul le texte sélectionné doit rester");
});

test("le réglage laisse le lien ajouté", async () => {
  const { features } = await storageGet(withExt, "features");
  await setSettings({ features: { ...features, cleanCopy: false } });
  try {
    await withExt.get(url("copie-lien.html"));
    await click(withExt, "copy");
    await waitFor(async () => /Lire la suite/.test((await readClipboard(withExt)) || ""), 3000, "le lien aurait dû rester").catch(() => {});
    assert.match(await readClipboard(withExt), /Lire la suite/);
  } finally {
    await setSettings({ features: { ...features, cleanCopy: true } });
  }
});
