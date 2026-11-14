// Paramètres propres à chaque site, contenus intégrés et pages AMP (fonctions pures de defaults.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({ URL });
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../src/shared/defaults.js"), "utf8") +
    "\nthis.api = { fshCleanUrl, fshEmbedOf, fshEmbedLoadUrl, fshAmpOriginal, FSH_DEFAULTS };",
  ctx
);
const { fshCleanUrl, fshEmbedOf, fshEmbedLoadUrl, fshAmpOriginal, FSH_DEFAULTS } = ctx.api;

// --- paramètres de suivi -----------------------------------------------------------------------------------

test("Amazon : paramètres de session et segment /ref= retirés, la recherche et la variante gardées", () => {
  assert.equal(
    fshCleanUrl("https://www.amazon.fr/dp/B0ABC/ref=sr_1_1?keywords=chaussures&qid=1700000000&sr=8-1&pd_rd_r=abc&psc=1"),
    "https://www.amazon.fr/dp/B0ABC?keywords=chaussures&psc=1"
  );
});

test("Google : paramètres de session d'une recherche retirés, la requête gardée", () => {
  assert.equal(
    fshCleanUrl("https://www.google.fr/search?q=meteo&ved=0ahUKE&ei=abc&sca_esv=1&sxsrf=2&oq=meteo&gs_lcp=zz"),
    "https://www.google.fr/search?q=meteo"
  );
});

test("une règle de site ne s'applique pas ailleurs : « s », « t » et « sr » sont ordinaires hors de leur site", () => {
  for (const u of ["https://exemple.fr/page?s=ete&t=3&sr=2&qid=4", "https://forum.exemple.fr/?ei=1&ved=2", "https://exemple.fr/status/1?s=20&t=abc"]) {
    assert.equal(fshCleanUrl(u), u, u);
  }
});

test("X : s et t retirés d'un lien vers une publication seulement", () => {
  assert.equal(fshCleanUrl("https://x.com/user/status/123?s=20&t=AbCd"), "https://x.com/user/status/123");
  assert.equal(fshCleanUrl("https://x.com/search?s=typed&t=1"), "https://x.com/search?s=typed&t=1");
});

test("YouTube : si retiré, l'instant de départ (t) et la liste gardés", () => {
  assert.equal(fshCleanUrl("https://www.youtube.com/watch?v=abc&t=42&list=PL1&si=XyZ&feature=share"), "https://www.youtube.com/watch?v=abc&t=42&list=PL1");
  assert.equal(fshCleanUrl("https://youtu.be/abc?si=XyZ&t=5"), "https://youtu.be/abc?t=5");
});

test("Spotify, LinkedIn, AliExpress, Facebook, TikTok", () => {
  assert.equal(fshCleanUrl("https://open.spotify.com/track/1?si=abc&context=x"), "https://open.spotify.com/track/1?context=x");
  assert.equal(fshCleanUrl("https://www.linkedin.com/posts/x?trackingId=1&lipi=2&keep=3"), "https://www.linkedin.com/posts/x?keep=3");
  assert.equal(fshCleanUrl("https://fr.aliexpress.com/item/1.html?spm=a1&scm=b&pvid=c&aff_fcid=d&sku=red"), "https://fr.aliexpress.com/item/1.html?sku=red");
  assert.equal(fshCleanUrl("https://www.facebook.com/page/posts/1?__cft__[0]=abc&__tn__=x&id=9"), "https://www.facebook.com/page/posts/1?id=9");
  assert.equal(fshCleanUrl("https://www.tiktok.com/@u/video/1?_r=1&_t=2&is_from_webapp=1"), "https://www.tiktok.com/@u/video/1");
});

test("la liste globale s'applique partout, avec les règles du site en plus", () => {
  assert.equal(fshCleanUrl("https://www.amazon.fr/dp/B0?utm_source=x&gclid=y&qid=1"), "https://www.amazon.fr/dp/B0");
  assert.equal(fshCleanUrl("https://exemple.fr/?utm_source=x&page=2"), "https://exemple.fr/?page=2");
});

test("adresse propre, non web ou invalide : rendue telle quelle", () => {
  for (const u of ["https://exemple.fr/a?b=1", "https://www.amazon.fr/dp/B0ABC", "moz-extension://abc/page.html", "mailto:a@b.fr", "pas une adresse", ""]) {
    assert.equal(fshCleanUrl(u), u, u);
  }
});

// --- contenus intégrés ---------------------------------------------------------------------------------------

test("contenus intégrés reconnus", () => {
  for (const [u, name] of [
    ["https://www.youtube.com/embed/abc?rel=0", "YouTube"],
    ["https://www.youtube-nocookie.com/embed/abc", "YouTube"],
    ["https://player.vimeo.com/video/123", "Vimeo"],
    ["https://platform.twitter.com/embed/Tweet.html?id=1", "X (Twitter)"],
    ["https://www.instagram.com/p/abc/embed/", "Instagram"],
    ["https://www.facebook.com/plugins/post.php?href=x", "Facebook"],
    ["https://www.google.com/maps/embed?pb=abc", "Google Maps"],
    ["https://open.spotify.com/embed/track/1", "Spotify"],
    ["https://player.twitch.tv/?video=1", "Twitch"],
  ]) {
    assert.equal((fshEmbedOf(u) || {}).name, name, u);
  }
});

test("ce qui n'est pas un contenu intégré n'est pas reconnu : pages du site, connexion Google, Meet, Agenda", () => {
  for (const u of [
    "https://www.youtube.com/watch?v=abc",
    "https://www.google.com/search?q=x",
    "https://accounts.google.com/o/oauth2/auth",
    "https://meet.google.com/abc-defg-hij",
    "https://calendar.google.com/calendar/u/0/embed?src=x",
    "https://exemple.fr/embed/video",
    "https://www.youtube.com.evil.net/embed/abc",
    "javascript:alert(1)",
    "pas une adresse",
  ]) {
    assert.equal(fshEmbedOf(u), null, u);
  }
});

test("YouTube se charge via youtube-nocookie.com, le reste tel quel", () => {
  assert.equal(fshEmbedLoadUrl("https://www.youtube.com/embed/abc?rel=0"), "https://www.youtube-nocookie.com/embed/abc?rel=0");
  assert.equal(fshEmbedLoadUrl("https://player.vimeo.com/video/123"), "https://player.vimeo.com/video/123");
  assert.equal(fshEmbedLoadUrl("pas une adresse"), "pas une adresse");
});

// --- AMP -----------------------------------------------------------------------------------------------------

test("AMP : la vraie page est retrouvée dans le cache de Google", () => {
  assert.equal(fshAmpOriginal("https://exemple-fr.cdn.ampproject.org/c/s/exemple.fr/article/42?amp_js_v=a6&usqp=mq331"), "https://exemple.fr/article/42");
  assert.equal(fshAmpOriginal("https://www.google.com/amp/s/exemple.fr/article/42"), "https://exemple.fr/article/42");
  assert.equal(fshAmpOriginal("https://x.cdn.ampproject.org/v/s/exemple.fr/a?page=2&amp_gsa=1"), "https://exemple.fr/a?page=2");
});

test("AMP : une page en http reste en http, et une adresse qui n'est pas du cache AMP n'est pas touchée", () => {
  assert.equal(fshAmpOriginal("https://x.cdn.ampproject.org/c/exemple.fr/a"), "http://exemple.fr/a");
  for (const u of ["https://www.google.com/search?q=amp", "https://exemple.fr/amp/page", "https://cdn.ampproject.org.evil.net/c/s/exemple.fr/a", "https://www.google.com/amp/s/pas-un-hote", "pas une adresse"]) {
    assert.equal(fshAmpOriginal(u), null, u);
  }
});

test("réglages par défaut : refus des cookies, contenus au clic et AMP actifs", () => {
  assert.equal(FSH_DEFAULTS.features.consent, true);
  assert.equal(FSH_DEFAULTS.features.embeds, true);
  assert.equal(FSH_DEFAULTS.features.amp, true);
  assert.equal(FSH_DEFAULTS.embedAllow.length, 0);
});

// --- prestataires de paiement ---------------------------------------------------------------------------------

const pay = vm.runInContext("fshPaymentProvider", ctx);

test("prestataires de paiement connus, avec leurs sous-domaines", () => {
  for (const [host, name] of [
    ["js.stripe.com", "Stripe"],
    ["checkout.stripe.com", "Stripe"],
    ["www.paypal.com", "PayPal"],
    ["checkoutshopper-live.adyen.com", "Adyen"],
    ["secure.payplug.com", "PayPlug"],
    ["pay.google.com", "Google Pay"],
  ]) {
    assert.equal(pay(host), name, host);
  }
});

test("un nom qui ressemble à un prestataire n'est pas ce prestataire", () => {
  for (const host of ["stripe.com.pirate.net", "stripe-secure.com", "paypa1.com", "paypal.com.evil.fr", "notstripe.com", "pay.google.com.evil.net", "google.com", "", undefined]) {
    assert.equal(pay(host), null, String(host));
  }
});
