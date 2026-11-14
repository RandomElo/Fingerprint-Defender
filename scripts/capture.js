// Captures d'écran du popup, du tableau de bord et de la page d'avertissement, dans un vrai Firefox.
// Usage : npm run capture [dossier]   (par défaut ~/demo-claude/Fingerprint-Defender/captures)
//
// Sert à voir l'interface sans l'ouvrir à la main : le popup est ouvert dans un onglet (`?tab=` désigne la page analysée)
// et rempli avec un état réaliste (requêtes bloquées, pisteur repéré).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { HOSTS, startServer, startFirefox, measureAt, storageSet, inExtensionPage } = require("../tests/firefox/harness");

const OUT = process.argv[2] || path.join(os.homedir(), "demo-claude", "Fingerprint-Defender", "captures");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await startServer();
  // Un faux fournisseur de vidéo (youtube.com résolu vers la machine locale) pour voir le cadre de remplacement dans une vraie page.
  const d = await startFirefox({
    extension: true,
    prefs: { "network.dns.localDomains": "www.youtube.com,www.youtube-nocookie.com,shop-test.example.com,bad-gateway.example.com", "network.stricttransportsecurity.preloadlist": false },
  });
  try {
    await measureAt(d, `http://${HOSTS.a}:${port}/probe.html?noearly=1`);
    const tabId = await inExtensionPage(d, () =>
      d.executeAsyncScript("const done = arguments[arguments.length - 1]; chrome.tabs.query({ url: 'http://127.0.0.1/*' }).then((t) => done(t[0].id))")
    );

    // Ce que le popup montre pour cette page : un pisteur repéré, des requêtes coupées et les domaines visés.
    await inExtensionPage(d, () =>
      d.executeAsyncScript(
        `const id = arguments[0], done = arguments[arguments.length - 1];
         chrome.storage.session.get({ pageStats: {} }).then(({ pageStats }) => {
           pageStats[id] = {
             flagged: { "regie-pub.example": ["canvas", "audio"] },
             blocked: { localnet: 2, trackers: 3, identifiers: 1, beacons: 1, consent: 1, embeds: 1, clipboard: 2 },
             third: { "regie-pub.example": 9, "mesure.example": 4, "pixel.example": 2, "cdn-pub.example": 3, "social.example": 1, "video.example": 2 },
             domains: { "192.168.1.1": 2, "regie-pub.example": 3, "pixel.example": 1, OneTrust: 1, YouTube: 1 },
           };
           return chrome.storage.session.set({ pageStats });
         }).then(() => done(true));`,
        tabId
      )
    );
    // Des données d'exemple pour l'onglet Bilan : une semaine de blocages et un graphe de tiers.
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    await storageSet(d, {
      daily: { [day(0)]: { blocked: 41, trackers: 28, beacons: 6, localnet: 3, consent: 4 }, [day(1)]: { blocked: 52, trackers: 40, identifiers: 2, embeds: 6, clipboard: 4 }, [day(3)]: { blocked: 19, trackers: 15, beacons: 4 } },
      graph: {
        "journal-example.fr": ["regie-pub.example", "mesure.example", "pixel.example", "cdn-pub.example", "social.example"],
        "recettes-example.fr": ["regie-pub.example", "mesure.example", "video.example"],
        "meteo-example.fr": ["regie-pub.example", "mesure.example"],
        "forum-example.fr": ["mesure.example"],
      },
    });
    await storageSet(d, { identifiers: { emails: ["prenom@exemple.fr"], phones: ["06 12 34 56 78"] }, trackerAllow: [HOSTS.a] });

    const shot = async (name, page, width, height) => {
      const png = await inExtensionPage(
        d,
        async () => {
          await d.manage().window().setRect({ width, height });
          await d.sleep(1200);
          return d.takeScreenshot();
        },
        page
      );
      const file = path.join(OUT, name + ".png");
      fs.writeFileSync(file, Buffer.from(png, "base64"));
      console.log("  " + file);
    };

    console.log("Captures dans " + OUT);
    await shot("popup", `src/pages/popup/popup.html?tab=${tabId}`, 420, 1250);
    await shot("tableau-vue", `src/pages/dashboard/dashboard.html?tab=${tabId}#vue`, 1100, 900);
    await shot("tableau-empreinte", `src/pages/dashboard/dashboard.html?tab=${tabId}#empreinte`, 1100, 1100);
    await shot("tableau-bilan", `src/pages/dashboard/dashboard.html?tab=${tabId}#bilan`, 1100, 800);
    await shot("tableau-reglages", `src/pages/dashboard/dashboard.html?tab=${tabId}#reglages`, 1100, 1500);
    // Le cadre qui remplace une vidéo intégrée, dans une page d'article.
    await d.manage().window().setRect({ width: 700, height: 420 });
    await d.get(`http://${HOSTS.a}:${port}/embed.html?src=` + encodeURIComponent(`http://www.youtube.com:${port}/embed/abc123`));
    await d.sleep(1500);
    fs.writeFileSync(path.join(OUT, "contenu-integre.png"), Buffer.from(await d.takeScreenshot(), "base64"));
    console.log("  " + path.join(OUT, "contenu-integre.png"));
    // Les avertissements dessinés dans la page : commande piégée copiée (ClickFix), puis prestataire de paiement douteux.
    await d.manage().window().setRect({ width: 900, height: 520 });
    await d.get(`http://${HOSTS.a}:${port}/clickfix.html`);
    await d.findElement({ id: "verify" }).click();
    await d.sleep(1200);
    fs.writeFileSync(path.join(OUT, "alerte-clickfix.png"), Buffer.from(await d.takeScreenshot(), "base64"));
    console.log("  " + path.join(OUT, "alerte-clickfix.png"));
    await storageSet(d, { feeds: { openphish: "", phishing: "bad-gateway.example.com", malware: "" } });
    await d.get(`http://shop-test.example.com:${port}/boutique.html?action=` + encodeURIComponent(`http://bad-gateway.example.com:${port}/pay`));
    await d.findElement({ id: "cc" }).click();
    await d.sleep(5000);
    fs.writeFileSync(path.join(OUT, "alerte-paiement.png"), Buffer.from(await d.takeScreenshot(), "base64"));
    console.log("  " + path.join(OUT, "alerte-paiement.png"));
    await shot("page-avertissement", "src/pages/blocked/blocked.html?u=" + encodeURIComponent("http://faux-site.example/connexion"), 900, 800);
  } finally {
    await d.quit();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
