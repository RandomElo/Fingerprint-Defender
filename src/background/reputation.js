// Analyse de réputation d'un site (exécutée dans le script d'arrière-plan).
// Sources : listes de menaces téléchargées, DNS filtrants Cloudflare et Quad9, âge du domaine (RDAP)
// et heuristiques sur l'adresse. Seul le nom de domaine quitte le navigateur, jamais l'URL complète.
const Reputation = (() => {
  const CACHE_TTL = 6 * 3600 * 1000;
  const SOURCES = [
    { id: "openphish", url: "https://openphish.com/feed.txt" },
    { id: "phishing", url: "https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt" },
    { id: "malware", url: "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt" },
  ];

  // Sites très connus : jugés fiables sans interroger personne.
  const WELL_KNOWN = new Set(
    ("google.com google.fr youtube.com wikipedia.org wikimedia.org github.com gitlab.com microsoft.com live.com office.com " +
      "microsoftonline.com apple.com icloud.com amazon.com amazon.fr netflix.com facebook.com instagram.com whatsapp.com " +
      "linkedin.com twitter.com x.com reddit.com stackoverflow.com mozilla.org cloudflare.com openai.com chatgpt.com " +
      "anthropic.com claude.ai spotify.com twitch.tv discord.com paypal.com ebay.com ebay.fr lemonde.fr lefigaro.fr " +
      "francetvinfo.fr gouv.fr service-public.fr ameli.fr laposte.fr orange.fr free.fr sfr.fr leboncoin.fr nytimes.com " +
      "bbc.com bbc.co.uk medium.com notion.so dropbox.com zoom.us slack.com npmjs.com python.org nodejs.org w3.org " +
      "yahoo.com bing.com duckduckgo.com proton.me strava.com garmin.com booking.com airbnb.com").split(" ")
  );

  // Marques souvent imitées et leurs vrais domaines.
  const BRANDS = {
    paypal: ["paypal.com", "paypal.me"],
    google: ["google.com", "google.fr", "googleapis.com", "gstatic.com", "google.co.uk", "withgoogle.com"],
    gmail: ["gmail.com"],
    microsoft: ["microsoft.com", "live.com", "office.com", "outlook.com", "microsoftonline.com", "msn.com", "bing.com"],
    apple: ["apple.com", "icloud.com"],
    amazon: ["amazon.com", "amazon.fr", "amazon.de", "amazon.co.uk", "amazon.es", "amazon.it", "amazonaws.com"],
    netflix: ["netflix.com"],
    facebook: ["facebook.com", "fb.com", "fb.me"],
    instagram: ["instagram.com"],
    whatsapp: ["whatsapp.com", "whatsapp.net"],
    linkedin: ["linkedin.com"],
    binance: ["binance.com"],
    coinbase: ["coinbase.com"],
    metamask: ["metamask.io"],
    dropbox: ["dropbox.com"],
    github: ["github.com", "github.io", "githubusercontent.com"],
    steam: ["steampowered.com", "steamcommunity.com"],
    discord: ["discord.com", "discord.gg", "discordapp.com"],
    spotify: ["spotify.com"],
    ebay: ["ebay.com", "ebay.fr"],
    airbnb: ["airbnb.com", "airbnb.fr"],
    booking: ["booking.com"],
    laposte: ["laposte.fr"],
    colissimo: ["colissimo.fr"],
    chronopost: ["chronopost.fr"],
    ameli: ["ameli.fr"],
    boursorama: ["boursorama.com"],
    revolut: ["revolut.com"],
    dhl: ["dhl.com", "dhl.de", "dhl.fr"],
    fedex: ["fedex.com"],
    orange: ["orange.fr", "orange.com"],
    bouygues: ["bouyguestelecom.fr"],
    bnpparibas: ["bnpparibas.com", "bnpparibas.fr"],
    societegenerale: ["societegenerale.fr", "societegenerale.com"],
    "credit-agricole": ["credit-agricole.fr"],
    impots: ["gouv.fr"],
  };

  const BAD_TLDS = new Set(
    "zip mov top xyz tk ml ga cf gq click country kim work rest fit cfd sbs icu buzz monster quest lol cyou".split(" ")
  );
  const SHORTENERS = new Set(
    "bit.ly tinyurl.com t.co goo.gl ow.ly is.gd buff.ly rebrand.ly cutt.ly shorturl.at tiny.cc rb.gy".split(" ")
  );
  const PHISH_WORDS = new Set("login signin verify verification secure account update wallet confirm support billing".split(" "));

  // --- utilitaires -------------------------------------------------------------
  const parentsOf = (host) => {
    const labels = host.split(".");
    const out = [];
    for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
    return out;
  };
  const isIp = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");

  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  // Cherche une marque imitée : "paypal-secure.xyz", "paypa1.com", "login.apple.evil.tk"...
  function lookalike(host, reg) {
    const label = reg.split(".")[0];
    const folded = label.replace(/vv/g, "w").replace(/rn/g, "m").replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/5/g, "s");
    const tokens = host.slice(0, host.length - reg.length).split(/[.\-_]/).concat(label.split(/[-_]/)).filter(Boolean);
    for (const [name, domains] of Object.entries(BRANDS)) {
      if (domains.includes(reg)) continue;
      if (tokens.some((t) => t === name || (t.startsWith(name) && /^\d+$/.test(t.slice(name.length))))) return name;
      if (name.length >= 6 && (folded === name || distance(folded, name) <= 1) && label !== name) return name;
    }
    return null;
  }

  async function fetchWithTimeout(url, ms, headers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store", credentials: "omit" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r;
    } finally {
      clearTimeout(timer);
    }
  }

  const dohQuery = async (base, host) =>
    (await fetchWithTimeout(`${base}?name=${encodeURIComponent(host)}&type=A`, 2500, { accept: "application/dns-json" })).json();

  // Serveur RDAP du registre de l'extension (liste officielle de l'IANA, gardée une semaine).
  async function rdapBase(reg) {
    try {
      const { rdapBoot } = await chrome.storage.local.get("rdapBoot");
      let map = rdapBoot && Date.now() - rdapBoot.t < 7 * 86400000 ? rdapBoot.map : null;
      if (!map) {
        const j = await (await fetchWithTimeout("https://data.iana.org/rdap/dns.json", 4000)).json();
        map = {};
        for (const [tlds, urls] of j.services) for (const t of tlds) map[t] = urls[0];
        await chrome.storage.local.set({ rdapBoot: { t: Date.now(), map } });
      }
      return map[reg.split(".").pop()] || null;
    } catch (_) {
      return null; // repli sur rdap.org
    }
  }

  async function rdapInfo(reg) {
    const base = await rdapBase(reg);
    const url = (base || "https://rdap.org/") + "domain/" + encodeURIComponent(reg);
    const j = await (await fetchWithTimeout(url, 4000, { accept: "application/rdap+json" })).json();
    const date = (action) => {
      const e = (j.events || []).find((x) => x.eventAction === action);
      return e ? new Date(e.eventDate).getTime() : null;
    };
    const registered = date("registration");
    if (!registered) throw new Error("pas de date");
    const expires = date("expiration");
    const now = Date.now();
    const DAY = 86400000;
    const hidden = (j.entities || []).some(
      (e) =>
        (e.roles || []).includes("registrant") &&
        ((e.remarks || []).some((r) => /restricted publication/i.test(r.type || "") && (r.description || []).join("").toUpperCase().includes("YES")) ||
          /redacted|privacy|anonym|withheld/i.test(JSON.stringify(e.vcardArray || "")))
    );
    return {
      ageDays: Math.floor((now - registered) / DAY),
      remainingDays: expires ? Math.floor((expires - now) / DAY) : null,
      spanDays: expires ? Math.floor((expires - registered) / DAY) : null,
      hidden,
    };
  }

  // Raison lisible d'un échec de service.
  const why = (r) => (r.reason && r.reason.name === "AbortError" ? "délai dépassé" : (r.reason && r.reason.message) || "erreur");

  // Popularité : classement Tranco (rang moyen sur 30 jours), gardé une semaine. L'API limite le débit,
  // donc un échec ne pénalise pas le site.
  async function popularityRank(reg) {
    const { rankCache } = await chrome.storage.local.get("rankCache");
    const cache = rankCache || {};
    const hit = cache[reg];
    if (hit && Date.now() - hit.t < 7 * 86400000) return hit.rank;
    const j = await (await fetchWithTimeout("https://tranco-list.eu/api/ranks/domain/" + encodeURIComponent(reg), 3000)).json();
    const rank = j.ranks && j.ranks.length ? j.ranks[0].rank : null;
    cache[reg] = { t: Date.now(), rank };
    const keys = Object.keys(cache);
    if (keys.length > 400) keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - 400).forEach((k) => delete cache[k]);
    await chrome.storage.local.set({ rankCache: cache });
    return rank;
  }

  const dnsBlocked = (r) =>
    !!r &&
    ((r.Answer || []).some((a) => a.data === "0.0.0.0" || a.data === "::") ||
      (r.Comment || []).some((c) => /censored|blocked|filtered/i.test(c)));

  // --- listes de menaces ---------------------------------------------------------
  let feedSets = null;
  // Une liste de menaces mise à jour (ou posée par un test) est relue au prochain contrôle.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.feeds) feedSets = null;
  });

  async function loadFeeds() {
    if (feedSets) return feedSets;
    const { feeds } = await chrome.storage.local.get("feeds");
    const f = feeds || {};
    const toSet = (s) => new Set(s ? s.split("\n") : []);
    const urls = toSet(f.openphish);
    feedSets = {
      urls,
      urlHosts: new Set([...urls].filter((x) => !x.includes("/"))),
      phishing: toSet(f.phishing),
      malware: toSet(f.malware),
    };
    return feedSets;
  }

  function normUrl(line) {
    try {
      const u = new URL(line);
      return (u.hostname + u.pathname).replace(/\/$/, "").toLowerCase();
    } catch (_) {
      return null;
    }
  }

  async function updateFeeds() {
    const stored = await chrome.storage.local.get(["feeds", "feedsMeta"]);
    const feeds = stored.feeds || {};
    const counts = (stored.feedsMeta && stored.feedsMeta.counts) || {};
    let updated = 0;
    for (const src of SOURCES) {
      try {
        const text = await (await fetchWithTimeout(src.url, 30000)).text();
        let lines = text.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith("#"));
        if (src.id === "openphish") lines = lines.map(normUrl).filter(Boolean);
        feeds[src.id] = lines.join("\n");
        counts[src.id] = lines.length;
        updated++;
      } catch (_) {}
    }
    const meta = { updated: updated ? Date.now() : (stored.feedsMeta && stored.feedsMeta.updated) || 0, counts };
    await chrome.storage.local.set({ feeds, feedsMeta: meta });
    feedSets = null;
    return meta;
  }

  // --- analyse ---------------------------------------------------------------------
  const finding = (group, label, status, detail, penalty = 0, critical = false, cap = null) => ({ group, label, status, detail, penalty, critical, cap });
  // Signe d'un site récent (voir fshScore) : plafonné avec les autres au lieu de s'additionner.
  const soft = (f, softCap) => ({ ...f, soft: true, softCap });

  async function checkSite(urlStr, { online = true, noCache = false } = {}) {
    let u;
    try {
      u = new URL(urlStr);
    } catch (_) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    const reg = fshRegistrable(host);
    const ip = isIp(host);

    // Un appareil de ton réseau (serveur maison, routeur...) : ni analysé ni envoyé sur Internet.
    if (fshIsLocal(host)) {
      return {
        host, registrable: host, local: true, score: null, verdict: "local", base: 100, ageDays: null, online: false, checkedAt: Date.now(),
        findings: [finding("Réseau local", "Adresse locale", "info", "Ce nom désigne un appareil de ton réseau : il n'est pas analysé et rien n'est envoyé sur Internet.")],
      };
    }

    const key = `v4|${u.protocol}${host}${u.port}|${online ? 1 : 0}`;
    const { repCache } = noCache ? {} : await chrome.storage.local.get("repCache");
    const cache = repCache || {};
    if (cache[key] && Date.now() - cache[key].checkedAt < CACHE_TTL) return { ...cache[key], cached: true };

    const findings = [];
    let ageDaysFound = null;
    // Un site inconnu ne part pas de 100 : l'absence de signal négatif ne prouve pas qu'il est fiable.
    const base = WELL_KNOWN.has(reg) && !u.username ? 100 : 90;

    if (WELL_KNOWN.has(reg) && !u.username) {
      findings.push(finding("Réputation", "Site très connu", "ok", `${reg} fait partie des sites établis, aucune analyse nécessaire.`));
    } else {
      // 1. listes locales
      const feeds = await loadFeeds();
      const path = u.pathname.replace(/\/$/, "").toLowerCase();
      const have = feeds.phishing.size + feeds.malware.size + feeds.urls.size > 0;
      if (!have) {
        findings.push(finding("Listes de menaces", "Listes non téléchargées", "info", "Les listes de phishing et de malware n'ont pas encore été récupérées."));
      } else {
        const parents = parentsOf(host);
        const phishUrl = feeds.urls.has(host + path) || feeds.urlHosts.has(host);
        const phishDom = parents.find((p) => feeds.phishing.has(p));
        const malDom = parents.find((p) => feeds.malware.has(p));
        findings.push(
          phishUrl
            ? finding("Listes de menaces", "OpenPhish", "bad", "Cette adresse figure dans la liste OpenPhish des pages de phishing actives.", 100, true)
            : finding("Listes de menaces", "OpenPhish", "ok", `Absente de la liste (${feeds.urls.size.toLocaleString("fr-FR")} adresses).`),
          phishDom
            ? finding("Listes de menaces", "Liste de phishing", "bad", `${phishDom} est répertorié comme domaine d'hameçonnage.`, 100, true)
            : finding("Listes de menaces", "Liste de phishing", "ok", `Absent de la liste (${feeds.phishing.size.toLocaleString("fr-FR")} domaines).`),
          malDom
            ? finding("Listes de menaces", "Liste de malware (URLhaus)", "bad", `${malDom} distribue actuellement des logiciels malveillants.`, 100, true)
            : finding("Listes de menaces", "Liste de malware (URLhaus)", "ok", `Absent de la liste (${feeds.malware.size.toLocaleString("fr-FR")} domaines).`)
        );
      }

      // 2. analyses en ligne
      if (online && !ip) {
        const [base, sec, fam, q9, age, pop] = await Promise.allSettled([
          dohQuery("https://cloudflare-dns.com/dns-query", host),
          dohQuery("https://security.cloudflare-dns.com/dns-query", host),
          dohQuery("https://family.cloudflare-dns.com/dns-query", host),
          dohQuery("https://dns.quad9.net:5053/dns-query", host),
          rdapInfo(reg),
          popularityRank(reg),
        ]);
        const ok = (r) => r.status === "fulfilled";
        const secBlocked = ok(sec) && dnsBlocked(sec.value);

        if (ok(base)) {
          findings.push(
            base.value.Status === 3
              ? finding("Analyse en ligne", "Le domaine existe", "warn", "Ce nom de domaine n'existe pas : le lien est cassé ou piégé.", 40)
              : finding("Analyse en ligne", "Le domaine existe", "ok", "Le nom de domaine est bien enregistré et répond.")
          );
        }
        findings.push(
          !ok(sec)
            ? finding("Analyse en ligne", "Cloudflare Sécurité", "info", `Service injoignable (${why(sec)}).`)
            : secBlocked
              ? finding("Analyse en ligne", "Cloudflare Sécurité", "bad", "Bloqué par Cloudflare comme site de malware ou de phishing.", 100, true)
              : finding("Analyse en ligne", "Cloudflare Sécurité", "ok", "Non signalé comme malveillant.")
        );
        findings.push(
          !ok(fam)
            ? finding("Analyse en ligne", "Cloudflare Famille", "info", `Service injoignable (${why(fam)}).`)
            : dnsBlocked(fam.value) && !secBlocked
              ? finding("Analyse en ligne", "Cloudflare Famille", "warn", "Classé comme contenu pour adultes.", 10)
              : finding("Analyse en ligne", "Cloudflare Famille", "ok", "Aucun contenu sensible détecté.")
        );
        findings.push(
          !ok(q9)
            ? finding("Analyse en ligne", "Quad9", "info", `Service injoignable depuis ce réseau (${why(q9)}).`)
            : q9.value.Status === 3 && ok(base) && base.value.Status === 0
              ? finding("Analyse en ligne", "Quad9", "bad", "Bloqué par Quad9 (liste de menaces).", 100, true)
              : finding("Analyse en ligne", "Quad9", "ok", "Non signalé comme malveillant.")
        );
        const D = "Domaine";
        if (!ok(age)) {
          findings.push(soft(finding(D, "Âge du domaine", "info", `Date d'enregistrement introuvable (${why(age)}) : pas assez d'éléments pour te rassurer.`, 12), 24));
        } else {
          const { ageDays, remainingDays, spanDays, hidden } = age.value;
          ageDaysFound = ageDays;
          const young = ageDays < 730;
          // Plafond du total des signes de jeunesse (âge, popularité, propriétaire masqué...) : le plus jeune
          // est le plus lourd. Un domaine de quelques semaines reste suspect, mais sans autre signal il est « douteux »,
          // pas « dangereux ».
          const youthCap = ageDays < 30 ? 40 : ageDays < 180 ? 28 : ageDays < 365 ? 20 : 12;
          if (ageDays < 30) findings.push(soft(finding(D, "Âge du domaine", "warn", `Enregistré il y a ${ageDays} jour(s) seulement : fréquent chez les arnaques, mais aussi chez tout site qui vient d'ouvrir.`, 45), youthCap));
          else if (ageDays < 180) findings.push(soft(finding(D, "Âge du domaine", "warn", `Enregistré il y a ${ageDays} jours : domaine très récent.`, 28), youthCap));
          else if (ageDays < 365) findings.push(soft(finding(D, "Âge du domaine", "warn", `Enregistré il y a ${ageDays} jours : domaine de moins d'un an.`, 16), youthCap));
          else if (ageDays < 730) findings.push(soft(finding(D, "Âge du domaine", "ok", `Enregistré depuis ${(ageDays / 365).toFixed(1).replace(".", ",")} an(s) : encore récent.`, 3), youthCap));
          else if (ageDays < 1825) findings.push(finding(D, "Âge du domaine", "ok", `Enregistré depuis ${Math.floor(ageDays / 365)} ans.`));
          else findings.push(finding(D, "Âge du domaine", "ok", `Domaine établi depuis ${Math.floor(ageDays / 365)} ans.`, -8));

          if (remainingDays !== null) {
            if (remainingDays < 60 && young) findings.push(soft(finding(D, "Espérance de vie", "warn", `Le domaine expire dans ${Math.max(remainingDays, 0)} jour(s) : faible espérance de vie.`, 12)));
            else findings.push(finding(D, "Espérance de vie", "ok", `Domaine renouvelé pour encore ${remainingDays} jours.`));
          }
          if (spanDays !== null && spanDays <= 400 && young) {
            findings.push(soft(finding(D, "Durée d'enregistrement", "warn", "Enregistré pour un an seulement : investissement minimal.", 8)));
          }
          findings.push(
            hidden && ageDays < 1825
              ? soft(finding(D, "Propriétaire du domaine", "warn", "Le propriétaire est masqué dans la base Whois.", ageDays < 730 ? 8 : 6))
              : finding(D, "Propriétaire du domaine", hidden ? "info" : "ok", hidden ? "Propriétaire masqué (fréquent, notamment pour les sites établis)." : "Propriétaire identifiable dans la base Whois.")
          );
        }
        const P = "Popularité";
        if (ok(pop)) {
          const rank = pop.value;
          const fmt = (n) => n.toLocaleString("fr-FR");
          if (rank === null) findings.push(soft(finding(P, "Popularité du site", "warn", "Absent des classements de popularité (Tranco) : site peu connu.", ageDaysFound !== null && ageDaysFound >= 730 ? 6 : 10)));
          else if (rank <= 10000) findings.push(finding(P, "Popularité du site", "ok", `Parmi les 10 000 sites les plus visités (rang ${fmt(rank)}).`, -10));
          else if (rank <= 100000) findings.push(finding(P, "Popularité du site", "ok", `Parmi les 100 000 sites les plus visités (rang ${fmt(rank)}).`, -6));
          else findings.push(finding(P, "Popularité du site", "ok", `Dans le million de sites les plus visités (rang ${fmt(rank)}).`, -2));
        } else {
          findings.push(finding(P, "Popularité du site", "info", `Classement indisponible (${why(pop)}).`));
        }
      } else if (!online) {
        findings.push(finding("Analyse en ligne", "Analyses en ligne", "info", "Non effectuées : seules les listes locales et l'adresse sont examinées."));
        findings.push(soft(finding("Domaine", "Âge du domaine", "info", "Non vérifié : pas assez d'éléments pour te rassurer.", 12), 24));
      }

      // 3. heuristiques sur l'adresse
      const labels = host.split(".");
      const tld = labels[labels.length - 1];
      const brand = ip ? null : lookalike(host, reg);
      const words = ip ? [] : host.slice(0, host.length - reg.length).split(/[.\-_]/).concat(reg.split(".")[0].split(/[-_]/)).filter((w) => PHISH_WORDS.has(w));

      findings.push(
        u.protocol === "https:"
          ? finding("Adresse", "Connexion chiffrée", "ok", "Le site utilise HTTPS.")
          : finding("Adresse", "Connexion chiffrée", "warn", "Connexion non chiffrée (HTTP) : tout ce que tu envoies peut être lu.", 20),
        ip
          ? finding("Adresse", "Nom de domaine", "warn", "Adresse IP brute au lieu d'un nom de site.", 30)
          : finding("Adresse", "Nom de domaine", "ok", "Le lien utilise un vrai nom de domaine."),
        u.username
          ? finding("Adresse", "Identifiants dans le lien", "bad", "Le lien contient un « @ » : la vraie destination est cachée.", 40, false, 40)
          : finding("Adresse", "Identifiants dans le lien", "ok", "Pas de technique de camouflage avec « @ »."),
        host.includes("xn--")
          ? finding("Adresse", "Caractères trompeurs", "warn", "Caractères internationaux pouvant imiter un autre site (xn--).", 25)
          : finding("Adresse", "Caractères trompeurs", "ok", "Aucun caractère déguisé."),
        brand
          ? finding("Adresse", "Imitation de marque", "bad", `Ressemble à « ${brand} » sans en être le site officiel.`, 55, false, 35)
          : finding("Adresse", "Imitation de marque", "ok", "Ne ressemble à aucune marque connue."),
        BAD_TLDS.has(tld)
          ? finding("Adresse", "Extension du domaine", "warn", `.${tld} est une extension très utilisée pour les arnaques.`, 15)
          : finding("Adresse", "Extension du domaine", "ok", ip ? "Sans objet." : `.${tld} n'est pas particulièrement risquée.`),
        labels.length >= 5 || (host.match(/-/g) || []).length >= 3
          ? finding("Adresse", "Structure du nom", "warn", "Nom très long ou avec beaucoup de sous-domaines ou de tirets.", 10)
          : finding("Adresse", "Structure du nom", "ok", "Structure normale."),
        words.length
          ? finding("Adresse", "Mots d'hameçonnage", "warn", `Contient « ${[...new Set(words)].join(", ")} » dans le nom du site.`, 10)
          : finding("Adresse", "Mots d'hameçonnage", "ok", "Aucun mot typique de phishing dans le nom."),
        SHORTENERS.has(reg)
          ? finding("Adresse", "Lien raccourci", "warn", "Lien raccourci : la vraie destination est cachée.", 8)
          : finding("Adresse", "Lien raccourci", "ok", "Pas un service de raccourcissement."),
        u.port && !["80", "443"].includes(u.port)
          ? finding("Adresse", "Port inhabituel", "warn", `Le lien utilise le port ${u.port}.`, 10)
          : finding("Adresse", "Port inhabituel", "ok", "Port standard.")
      );
    }

    const { score, verdict } = fshScore(findings, base);

    const verified = base === 100 || (online && !ip && ageDaysFound !== null);
    const result = { host, registrable: reg, score, verdict, base, verified, ageDays: ageDaysFound, findings, online, checkedAt: Date.now() };
    if (noCache) return result;
    cache[key] = result;
    const keys = Object.keys(cache);
    if (keys.length > 300) {
      keys.sort((a, b) => cache[a].checkedAt - cache[b].checkedAt).slice(0, keys.length - 300).forEach((k) => delete cache[k]);
    }
    await chrome.storage.local.set({ repCache: cache });
    return result;
  }

  // Vérifie un numéro SIREN auprès du registre officiel français (recherche-entreprises.api.gouv.fr).
  async function companyFindings(ids, bad) {
    const G = "Contenu de la page";
    const out = [];
    for (const d of bad || []) {
      out.push(finding(G, "Numéro d'entreprise invalide", "bad", `Le numéro ${d} cité dans les mentions légales n'a pas de clé de contrôle valide : il est inventé ou erroné.`, 45, false, 30));
    }
    for (const id of ids || []) {
      try {
        const j = await (await fetchWithTimeout(`https://recherche-entreprises.api.gouv.fr/search?q=${id}&per_page=1`, 4000)).json();
        const r = (j.results || []).find((x) => x.siren === id);
        if (!r) {
          out.push(finding(G, "Entreprise introuvable", "bad", `Le SIREN ${id} n'existe pas au registre officiel des entreprises.`, 40, false, 30));
          continue;
        }
        if (r.etat_administratif === "C") {
          out.push(finding(G, "Entreprise cessée", "bad", `« ${r.nom_complet} » (SIREN ${id}) a cessé son activité.`, 40, false, 35));
          continue;
        }
        const months = r.date_creation ? Math.floor((Date.now() - new Date(r.date_creation).getTime()) / (30.4 * 86400000)) : null;
        out.push(finding(G, "Entreprise immatriculée", "ok", `« ${r.nom_complet} » (SIREN ${id}) est en activité${r.date_creation ? `, créée en ${r.date_creation.slice(0, 4)}` : ""}.`, -4));
        if (months !== null && months < 12) {
          out.push(finding(G, "Entreprise récente", "warn", `L'entreprise a été créée il y a ${months} mois seulement.`, 12));
        }
      } catch (_) {
        out.push(finding(G, "Registre des entreprises", "info", "Registre injoignable : numéro non vérifié."));
      }
    }
    return out;
  }

  return { checkSite, updateFeeds, companyFindings };
})();
