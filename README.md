# Fingerprint Shield

Extension Firefox 128+ (Manifest V3) en trois volets : brouiller les empreintes de navigateur sans casser les sites qui détectent les bloqueurs, couper les fuites et nuisances, et évaluer la fiabilité des sites avant de les ouvrir.

## Installation

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. « Charger un module complémentaire temporaire » et choisir `manifest.json`
3. Ouvrir le popup de l'extension et cliquer « Autoriser sur tous les sites » (Firefox n'accorde pas l'accès aux sites à l'installation)

Le chargement temporaire disparaît au redémarrage. Pour une installation durable, signer l'extension sur addons.mozilla.org (distribution non listée).

## Anonymisation

- Canvas, WebGL, audio, mesure de texte, rectangles DOM et matériel (cœurs, mémoire) reçoivent un bruit déterministe : mêmes valeurs à chaque lecture pour un site donné, différentes d'un site à l'autre et après « Nouvelle identité ». C'est ce qui évite d'être repéré comme bloqueur, contrairement à un bruit aléatoire à chaque lecture.
- Niveau « renforcé » : écran arrondi à une taille standard, langues réduites, et l'en-tête `Accept-Language` envoyé aux serveurs réduit de la même façon (le serveur et la page voient la même liste). Niveau « prudent » : ces valeurs restent réelles.
- Voix de synthèse et batterie masquées. WebRTC (adresse IP locale) en option, désactivé par défaut car il peut gêner les appels.
- Les fonctions modifiées restent « natives » pour `toString()`. Les canvas qui reçoivent une vidéo ou une grande image ne sont pas brouillés, sinon le bruit se verrait et s'accumulerait.

## Fuites et nuisances

- Paramètres de suivi (`utm_`, `fbclid`, `gclid`, `srsltid`, etc.) retirés des adresses avant l'envoi de la requête, puis en filet de sécurité dans la page, dans les liens, `pushState` et `window.open`.
- Liens enveloppés par un redirecteur de suivi (Google, Facebook, Instagram, YouTube, LinkedIn, DuckDuckGo, Outlook, WhatsApp, etc.) remplacés par leur vraie destination.
- `sendBeacon` vers un autre site que la page neutralisé.
- Signal « ne pas vendre mes données » (Global Privacy Control) : en-tête `Sec-GPC: 1` sur chaque requête et `navigator.globalPrivacyControl` à vrai. Se coupe dans les réglages.
- Demandes de notifications et de géolocalisation refusées, popups sans clic bloqués.
- Bandeaux de cookies et d'application masqués, défilement rétabli.

## Pisteurs probables

Chaque script chargé depuis un autre domaine que la page marque des points quand il lit une de tes caractéristiques : canvas et audio 3, WebGL et WebRTC 2, polices, rectangles et divers 1, écran et matériel 0,5. À 5 points ou plus, il est classé « pisteur probable » : il combine plusieurs signaux d'empreinte, ce que fait un traqueur et pas un site normal. Lire l'écran seul ne suffit jamais, et les scripts du site lui-même ne comptent pas. C'est une heuristique : elle peut signaler un script légitime qui lit canvas et audio, ou rater un traqueur qui ne lit qu'une surface.

Le popup affiche les pisteurs repérés sur la page ouverte. La liste cumulée, avec les surfaces lues et les pages où chacun a été vu, est dans l'onglet « Vue d'ensemble » du tableau de bord. Il n'y a aucun compteur de blocage ou de brouillage.

## Fiabilité des sites

Score sur 100 affiché dans le popup et au survol de chaque lien externe. L'icône de la barre d'outils ne porte pas le chiffre : un point vert, orange ou rouge selon le verdict, et la note dans l'infobulle.

- Un site inconnu ne part pas de 100 : l'absence de signal négatif ne prouve pas qu'il est fiable. Les sites très connus partent de 100.
- Quand l'analyse est incomplète (âge du domaine introuvable, mode hors ligne), l'icône affiche « ? » et le popup « Non vérifié » au lieu d'une note.
- Les adresses du réseau local (`.home`, `.lan`, IP privées, noms sans point) ne sont ni analysées ni envoyées sur Internet : l'icône affiche une maison.

Critères, dans l'esprit de Scamdoc :

- listes OpenPhish, phishing et malware (URLhaus), téléchargées toutes les 6 heures ;
- DNS filtrants Cloudflare (sécurité, famille) et Quad9 ;
- âge du domaine, expiration proche, enregistrement d'un an seulement, propriétaire masqué (RDAP, via la liste officielle de l'IANA) ;
- popularité (classement Tranco) ;
- HTTPS, adresse IP brute, caractères trompeurs, extensions à risque, mots d'hameçonnage, imitation de marques, port inhabituel, lien raccourci ;
- boutiques en ligne : mentions légales, contact, remises extrêmes, messages d'urgence, domaine de moins d'un an ;
- identité de l'éditeur : numéro SIREN ou SIRET lu dans la page ou les mentions légales, clé de contrôle, puis registre officiel des entreprises (existence, activité, ancienneté) ;
- formulaire de mot de passe envoyé à un autre site ou sur une page non chiffrée ;
- texte d'un lien qui affiche un site mais mène ailleurs.

Les pénalités sont lourdes, et les vrais problèmes d'identité plafonnent le score (SIREN invalide ou introuvable, imitation de marque, mot de passe envoyé ailleurs, texte de lien trompeur : 30 à 40 au maximum).

Un site récent n'est pas un site dangereux. L'âge du domaine, l'absence de classement de popularité, l'enregistrement pour un an seulement et le propriétaire masqué disent presque toujours la même chose (le site vient d'ouvrir), donc leur total est plafonné : 40 points au maximum pour un domaine de moins d'un mois, 28 sous six mois, 20 sous un an, 12 au-delà. Sans signal plus solide (liste de menaces, imitation de marque, HTTP, mot de passe envoyé ailleurs, boutique sans mentions légales...), un site jeune reste « douteux » et n'est jamais classé « dangereux ». Un petit jeu ouvert depuis quelques semaines affiche donc une note autour de 50, pas 20.

Boutiques : en plus du vocabulaire de panier, une page est reconnue comme boutique quand elle affiche au moins deux prix en vraie monnaie et deux mots d'achat (acheter, boutique, pack, abonnement...), ce qui couvre les boutiques de jeux sans panier. Dans une application monopage (la boutique est une vue, la page ne se recharge pas), l'adresse est surveillée et la page est relue à chaque changement de vue. Une boutique vue pendant la navigation reste comptée pour le site tant que l'onglet ne recharge pas une page.

Sites très connus : un site de la liste des sites établis (YouTube, Amazon, Wikipédia...) n'est pas jugé comme une boutique, même si ses pages affichent des prix et des mots comme « acheter ». Seul le contrôle des mots de passe envoyés ailleurs s'applique à ses pages. Sans cette règle, une page de films à acheter faisait tomber YouTube à 40.

Boutiques allégées : une page reconnue seulement par ses prix et ses mots d'achat, sans panier, reçoit des contrôles allégés (mentions légales absentes : 8 points, sans plafond ; contact : 4 points) et jamais la pénalité « boutique récente ». Le plafond de 40 est réservé aux pages qui ont un vrai panier.

Pages de soutien : une page qui propose des dons ou un abonnement facultatif (Patreon, Ko-fi, Tipeee, Liberapay, HelloAsso, mécénat) n'est pas jugée comme une boutique, même si elle affiche des prix. Elle ne reçoit ni le contrôle des mentions légales de boutique (plafond à 40) ni la pénalité « boutique récente ». On regarde seulement si le paiement passe par un prestataire reconnu (Stripe, PayPal, Patreon...) et si des mentions légales existent (6 points au plus si elles manquent). Un panier avéré (vocabulaire de panier ou élément « panier ») reste toujours une boutique.

Avertissements :

- avant d'ouvrir un lien vers un autre site douteux ou dangereux, une fenêtre détaille les problèmes avec « Retourner en arrière », « Continuer quand même » et « Toujours faire confiance » ;
- toute navigation vers un site manifestement de phishing (clic, mail, autre application, barre d'adresse) est interceptée avant le chargement, avec une page d'avertissement (contournement valable une heure).

Confidentialité : seul le nom de domaine est envoyé aux services d'analyse en ligne (Cloudflare, Quad9, registre du domaine, Tranco), jamais l'adresse complète, et les sites très connus ne sont pas envoyés. Les numéros SIREN des boutiques françaises sont envoyés au registre officiel. L'analyse automatique de chaque page visitée et les analyses en ligne se coupent dans le tableau de bord, onglet « Sécurité des sites ».

## Tableau de bord

Bouton du popup. Le popup montre le score du site et les pisteurs de la page ouverte, les totaux cumulés sont ici. Quatre onglets : vue d'ensemble (pisteurs, sites analysés, alertes), mon empreinte (empreinte réelle comparée à celle vue par les sites, et auto-test de cohérence), sécurité des sites (analyse manuelle, listes de menaces, alertes récentes, sites de confiance) et réglages (niveau, protections, identité, exceptions par site).

## Tests

Les tests ne font pas partie de l'extension : ils servent à vérifier qu'une modification ne casse pas la protection.

```
npm install
npm test
npm run test:firefox
```

`npm test` lance les tests unitaires (hachage de la clé par site, score de fiabilité, détection du réseau local), sans navigateur.

`npm run test:firefox` lance Firefox en mode sans fenêtre, y installe l'extension, lui accorde l'accès aux sites et mesure ce que voient les pages de test servies en local (trois adresses de bouclage, donc trois sites différents). Il demande Firefox 128 ou plus. geckodriver est téléchargé automatiquement au premier lancement ; `FIREFOX_BIN` désigne un autre exécutable de Firefox si besoin. Les tests vérifient notamment que :

- les valeurs sont brouillées, stables pour un site et différentes d'un site à l'autre ;
- un pisteur intégré dans deux sites voit deux empreintes différentes ;
- une lecture faite dès le début de la page donne la même valeur qu'une lecture faite plus tard ;
- la page ne reçoit aucun message de l'extension, ne peut pas couper la protection avec de faux messages et ne peut pas fausser la liste des pisteurs ;
- un vrai pisteur est bien repéré ;
- l'auto-test du tableau de bord s'exécute et ne signale aucun problème grave.

Ces garde-fous ont été contrôlés par sabotage : en retirant la vérification du nonce de configuration, celle du nonce des statistiques, ou en calculant la clé sur le cadre au lieu du site principal, le test correspondant échoue.

L'auto-test du tableau de bord (onglet « Mon empreinte », à ouvrir depuis le popup) fait la même chose à la main sur l'onglet de ton choix : deux lectures successives, apparence native des fonctions, cohérence entre la page, un cadre et un worker, langues, écran et CSS. Il affiche en clair ce qui est cohérent, à surveiller ou en défaut.

## Limites

- Le User-Agent et le fuseau horaire ne sont pas modifiés : Firefox fige déjà son UA, et un agenda a besoin du bon fuseau.
- La liste des caméras et micros n'est pas masquée, sinon Meet ne peut plus les proposer.
- Pas d'avis clients : Trustpilot bloque les requêtes automatiques.
- Quad9 peut être injoignable selon le réseau ; le score ne le pénalise pas.
- Si un service continue de bloquer, désactiver la protection pour son domaine depuis le popup.
- La configuration est lue de façon asynchrone. Une page qui lit son empreinte dans les toutes premières millisecondes reçoit une clé provisoire aléatoire, qu'elle garde jusqu'à la fin de la page : la valeur est cohérente dans la page mais change d'un chargement à l'autre. Il en va de même pour un cadre créé par un script et lu aussitôt, dont la valeur diffère de celle de la page. Une lecture faite après le chargement (le cas des pisteurs habituels) est stable.
- Les workers ne sont pas brouillés : un script qui compare la page et un worker voit les vraies valeurs. L'auto-test le signale.
- L'en-tête Accept-Language n'est pas aligné sur les langues réduites du niveau renforcé.

## Feuille de route

Pistes pour aller plus loin, classées par priorité. Les premières corrigent des failles du fonctionnement actuel. Elles passent avant les nouvelles protections, parce qu'un brouillage contournable donne un faux sentiment de sécurité.

### Choix de réalisation

Décidés avec Eloi le 29 octobre 2026, ils s'appliquent à toute la feuille de route :

- Les protections qui peuvent casser un site (blocage appris, réseau local, scripts tiers) sont actives par défaut, avec une exception en un clic dans le popup.
- Les permissions supplémentaires sont déclarées à l'installation, sans ouvrir de faille de sécurité.
- L'analyse automatique des domaines visités reste telle quelle : la partie 7 est hors périmètre.
- Les listes de blocage sont embarquées dans l'extension et aussi téléchargées automatiquement. La source et la licence de chacune sont notées ici.
- Google Meet, Agenda, la banque et le paiement ne doivent jamais casser : les scripts anti-fraude et les prestataires de paiement y restent autorisés.
- En cas de doute de conception, on choisit le plus protecteur, avec une exception en un clic, et on le note dans la section « Choix à relire » ci-dessous.
- Hors périmètre : la partie 20 (alias de messagerie). La publication sur addons.mozilla.org est préparée mais jamais soumise sans accord.
- Une phase à la fois : code, tests dans Firefox, README, puis bilan.

### Ordre de réalisation

Les parties qui suivent sont classées par thème. Pour les réaliser, l'ordre conseillé est le suivant, chaque phase s'appuyant sur la précédente :

1. Socle (fait) : failles de la partie 1, auto-test et tests automatiques (parties 15 et 23). Sans eux, on ne peut pas vérifier que la suite protège vraiment.
2. Brouillage complet et cohérent : workers et iframes (partie 2), cohérence des en-têtes et de l'écran (partie 15), identité par conteneur et rotation (partie 3).
3. Couper les fuites : en-têtes réseau (partie 5), réseau local (partie 16), réduction de ce que l'extension envoie elle-même (partie 7).
4. Bloquer : blocage appris, CNAME et liste de base (partie 4), enregistreurs de session et données personnelles hachées (partie 9), contrôle des scripts (partie 19).
5. Consentement et contenus tiers : refus automatique, contenus au clic, bibliothèques locales (partie 10), nettoyage par site (partie 21).
6. Sécurité active : arnaques (partie 18), certificats (partie 17).
7. Confort et vie privée au quotidien : isolation et conteneurs jetables (partie 11), alias (partie 20), nettoyage et urgences (parties 6 et 22), transparence (partie 13), comportement (partie 12).
8. Diffusion : Firefox Android (partie 14), traduction et publication (partie 23).

### 1. Failles de la première version (corrigées)

Ces failles étaient dans la version 3.0.0 et sont corrigées. Les tests de Firefox les couvrent.

- La graine circulait en clair dans la page, la même sur tous les sites. `content.js` ne transmet plus que la clé du site principal (hachage de la graine et du site), par un canal que la page ne peut pas écouter : les écouteurs de `inject.js` sont posés en phase de capture avant tout script du site et coupent la propagation de l'événement.
- La page pouvait couper la protection avec un faux message. `content.js` choisit un nonce secret au démarrage et le transmet avant que la page puisse s'abonner. `inject.js` ignore tout message de configuration qui ne le porte pas. Le même nonce protège les statistiques de pisteurs que `inject.js` remonte, qu'une page pouvait aussi falsifier.
- Le bruit dépendait du domaine du cadre. Il dépend maintenant du site principal de l'onglet : un pisteur intégré dans deux sites voit deux empreintes différentes. Un cadre d'un autre site demande ce site à l'arrière-plan, qui le lit dans l'adresse de l'onglet.
- Le nom `.local` de WebRTC est dérivé de la clé du site, il n'est plus commun à tous les sites.
- Les premières lectures utilisaient une graine aléatoire, puis la vraie. `inject.js` démarre avec une clé provisoire et la garde pour toute la page dès qu'une valeur a été brouillée avec elle, ce qui supprime l'incohérence dans la page.

Reste ouvert : la clé provisoire donne des valeurs qui changent d'un chargement à l'autre pour une page qui lit tout de suite, et un cadre lu aussitôt après sa création diffère de la page (voir Limites). Fournir la clé de façon synchrone n'est pas possible tel quel en MV3, `scripting.registerContentScripts` n'acceptant que des fichiers. Il faudrait intercepter `contentWindow` pour le cas des cadres (partie 2), et pour une page entière, envisager de modifier les prototypes depuis le monde isolé avec `exportFunction`.

### 2. Trous dans le brouillage

- Les workers ne sont pas couverts. Les scripts de contenu n'entrent pas dans les Web Workers, Shared Workers et Service Workers. Un pisteur y lit `OffscreenCanvas`, WebGL, `hardwareConcurrency` et les langues réels, puis compare avec la page (CreepJS le fait). Piste : envelopper les constructeurs `Worker` et `SharedWorker` pour ajouter le code de brouillage en tête du script (blob de même origine). Sinon, au minimum, détecter et signaler la lecture.
- Les iframes vides lues tout de suite. Un script peut créer un iframe et lire `iframe.contentWindow.HTMLCanvasElement.prototype` avant l'injection du script dans ce cadre. Piste : intercepter `contentWindow`, `contentDocument` et `window.frames` depuis le parent, puis appliquer le brouillage au nouveau cadre avant de le rendre.
- Surfaces non traitées : `document.fonts.check()` et `FontFace` (énumération des polices sans mesure de texte), `matchMedia` (préférences système, gamut, contraste), `navigator.storage.estimate()` (quota lié au disque), `performance.memory`, `screen.orientation`, la liste des codecs (`canPlayType`, `MediaCapabilities`), `Intl` (formats et calendrier, à garder cohérents avec la langue annoncée).
- Les wrappers se repèrent autrement que par `toString()`. Un `Proxy` se trahit par l'ordre des propriétés, par une pile d'erreur qui traverse l'extension, ou par `Object.getOwnPropertyDescriptor` sur l'instance. Tester régulièrement l'extension sur CreepJS, BrowserLeaks et `fingerprint.com/demo`, et garder une page de test locale qui vérifie la cohérence page/worker/iframe.

### 3. Identité

- Rotation automatique de la graine (fait) : réglage « Changer d'identité automatiquement » du tableau de bord (jamais, à chaque démarrage, chaque jour, chaque semaine). Par défaut, jamais. Choisir « chaque jour » alors que la graine a plus d'un jour la renouvelle tout de suite.
- Une graine par conteneur Firefox (`sender.tab.cookieStoreId`). Le conteneur « Banque » et le conteneur « Perso » auraient deux empreintes différentes, comme ils ont déjà des cookies séparés.
- Une graine propre à la navigation privée, renouvelée à chaque ouverture de fenêtre privée.

### 4. Passer du repérage au blocage

- Blocage appris, dans l'esprit de Privacy Badger. Un domaine classé « pisteur probable » sur au moins 3 sites différents est ensuite bloqué dans `webRequest` (scripts, pixels, XHR, iframes). Le compteur `pisteurs[src].p` existe déjà. Prévoir « débloquer pour ce site » dans le popup, et ne jamais bloquer un domaine dont le site a besoin pour fonctionner (CDN, connexion).
- Pisteurs déguisés en premier plan. Les scripts du site ne comptent pas dans le score, or beaucoup de traqueurs passent aujourd'hui par un sous-domaine du site (`metrics.site.fr`) en CNAME vers le traqueur, ou par un Google Tag Manager côté serveur. Firefox est le seul navigateur qui expose `browser.dns.resolve()` aux extensions : résoudre le CNAME des sous-domaines et traiter `eulerian.net`, `at-internet`, `omtrdc.net`, `adobedc.net`, etc. comme des tiers.
- Petite liste de base embarquée (EasyPrivacy réduite aux grands noms), pour ne pas attendre que le pisteur ait été vu trois fois.

### 5. En-têtes et fuites réseau

Dans `onBeforeSendHeaders` et `onHeadersReceived`, déjà disponibles avec `webRequestBlocking` :

- `Referer` réduit à l'origine pour toute requête vers un autre site, et supprimé quand on passe de HTTPS à HTTP ;
- `Sec-GPC: 1` envoyé, et `navigator.globalPrivacyControl` à `true` (fait). En Europe, c'est un refus de consentement qui a une valeur ;
- `ETag` et `If-None-Match` retirés sur les ressources des domaines pisteurs, qui s'en servent comme d'un cookie invisible ;
- `Set-Cookie` supprimé dans les réponses des domaines bloqués ou appris comme pisteurs ;
- attribut `ping` des liens (`<a ping>`) et requêtes de type `ping` bloqués vers un autre site, car ils contournent la neutralisation de `sendBeacon` ;
- `fetch(url, { keepalive: true })` vers un autre site traité comme `sendBeacon`, puisqu'il sert au même usage ;
- paramètres de suivi retirés aussi des requêtes `xmlhttprequest` et `image`, pas seulement des pages et des cadres (pixels de suivi).

### 6. Stockage et nettoyage

- Effacer cookies, `localStorage`, IndexedDB et cache d'un site quand son dernier onglet se ferme (`browsingData.remove` par nom d'hôte), avec une liste des sites où l'on reste connecté.
- Effacer régulièrement le stockage des domaines pisteurs appris, même ouverts dans un iframe.
- Signaler dans le popup les techniques de « supercookie » repérées : identifiants qui reviennent dans `localStorage`, `window.name` ou l'adresse après un effacement.

### 7. Ce que l'extension envoie elle-même

L'analyse automatique (`safetyAuto`, activée par défaut) envoie le nom de chaque domaine visité à Cloudflare, Quad9, `rdap.org` et Tranco. Pour un outil de confidentialité, c'est un historique de navigation partagé avec quatre services.

- Télécharger la liste Tranco (le premier million, ou les 100 000 premiers) au lieu d'interroger son API à chaque site.
- Interroger le registre du domaine directement grâce à la liste IANA, qui est déjà chargée, plutôt que de passer par le relais `rdap.org`.
- Ne faire l'analyse en ligne qu'au survol d'un lien ou sur demande, et désactiver `safetyAuto` par défaut. Une seule requête DNS filtrante suffit pour trancher.
- Afficher dans le tableau de bord la liste des domaines envoyés, pour que ce soit vérifiable.

### 8. Réglages Firefox conseillés

À faire une fois dans le navigateur, en complément de l'extension :

- Protection renforcée contre le pistage en mode Strict (Total Cookie Protection isole les cookies par site).
- DNS over HTTPS en « protection maximale », avec Quad9 ou Mullvad, sinon le fournisseur d'accès voit tous les domaines visités.
- Extension Multi-Account Containers pour isoler Google, Meta et la banque.
- Ne pas activer `privacy.resistFingerprinting` : il uniformise les valeurs alors que l'extension les brouille, et les deux ensemble donnent une empreinte incohérente, donc plus repérable. Garder la protection intégrée `privacy.fingerprintingProtection`.
- Dans `about:config` : `network.prefetch-next`, `network.dns.disablePrefetch` (à `true`), `network.http.speculative-parallel-limit` à `0`, `browser.send_pings` à `false`, `media.peerconnection.ice.default_address_only` à `true`, télémétrie et études désactivées. Le `user.js` d'arkenfox est une bonne base à réduire.
- Désactiver la mesure publicitaire intégrée à Firefox depuis la version 128 (« Privacy-Preserving Attribution ») : Paramètres, Vie privée, « Autoriser les sites web à effectuer une mesure publicitaire respectueuse de la vie privée », ou `dom.private-attribution.submission.enabled` à `false`.
- Réduire les polices visibles par les sites : `layout.css.font-visibility.standard` et `layout.css.font-visibility.trackingprotection` à `1` (polices de base seulement). C'est plus solide qu'un brouillage de la mesure de texte, au prix de quelques pages un peu moins jolies.
- uBlock Origin reste complémentaire : il bloque d'après des listes, alors que Fingerprint Shield repère d'après le comportement.

### 9. Données personnelles qui partent vers des tiers

- Repérer ses propres données dans les requêtes. Dans les réglages, on saisit son adresse mail et son numéro de téléphone, conservés localement. L'extension en calcule les empreintes SHA-256, SHA-1 et MD5, sous les formes normalisées utilisées par Meta et Google (minuscules, sans espaces, indicatif `33`). Elle cherche ensuite ces valeurs dans l'adresse et le corps (`requestBody`) des requêtes vers d'autres sites. C'est ainsi que fonctionnent l'« Advanced Matching » de Meta et les « Enhanced Conversions » de Google : ton adresse mail hachée sert d'identifiant commun à tous les sites. En cas de détection, l'extension bloque la requête et l'affiche dans le popup.
- Saisies lues avant l'envoi. Certains scripts tiers lisent un champ pendant la frappe et l'envoient, même si le formulaire n'est jamais validé. Piste : surveiller les lectures de `value` sur les champs `email`, `tel` et `password` par un script d'un autre domaine, puis rapprocher ces lectures des requêtes qui suivent.
- Enregistreurs de session (Hotjar, Microsoft Clarity, FullStory, Contentsquare, Smartlook, Mouseflow) : ils rejouent la souris, les clics et parfois les frappes. Les repérer à leur comportement (un `MutationObserver` sur tout le document, plus des écouteurs `input`, `mousemove` et `scroll` posés par un script tiers) ou par leur domaine, et les bloquer par défaut.
- Champs cachés remplis par la saisie automatique. Un formulaire peut contenir des champs invisibles (`adresse`, `téléphone`) que Firefox remplit en même temps que le nom. Avertir quand un champ caché ou hors écran reçoit une valeur saisie automatiquement.
- Métadonnées des fichiers envoyés. Les photos prises au téléphone contiennent souvent les coordonnées GPS, le modèle de l'appareil et la date. Intercepter les fichiers ajoutés à un `<input type="file">` ou déposés par glisser-déposer, et retirer les données EXIF des JPEG et PNG avant l'envoi, avec une option par site.

### 10. Consentement et contenus intégrés

- Refuser au lieu de masquer. Les bandeaux sont aujourd'hui seulement cachés par CSS. Le site n'a donc reçu aucun refus, et certains considèrent l'absence de réponse comme un accord ou gardent un réglage par défaut permissif. Piste : répondre « tout refuser » par les API des gestionnaires de consentement (`__tcfapi` pour IAB TCF, Didomi, OneTrust, Axeptio, tarteaucitron, Cookiebot), comme le fait Consent-O-Matic, puis masquer le bandeau.
- Contenus intégrés chargés au clic. Vidéos YouTube, publications X et Instagram, boutons Facebook, cartes Google Maps et commentaires Disqus remplacés par un cadre « Charger ce contenu (contacte youtube.com) ». Pour YouTube, passer en plus par `youtube-nocookie.com`.
- Bibliothèques servies en local, dans l'esprit de LocalCDN : jQuery, Font Awesome, Google Fonts et les bibliothèques courantes de cdnjs et jsDelivr sont livrées par l'extension au lieu du CDN, qui ne voit plus passer chaque page visitée. Ne le faire que pour les versions exactes embarquées, en vérifiant l'intégrité (`integrity`).
- Pages AMP renvoyées vers la version d'origine (`<link rel="canonical">`), pour ne plus passer par les serveurs de Google.

### 11. Isolation

- Conteneur jetable. Une entrée du menu contextuel « Ouvrir dans un conteneur jetable » ouvre le lien dans un conteneur Firefox créé pour l'occasion, puis supprimé avec ses cookies à la fermeture de l'onglet (permissions `contextualIdentities` et `cookies`). On peut aussi l'imposer aux liens vers un site jugé douteux, à la place de l'avertissement.
- Liens sortants : ajouter `rel="noopener noreferrer"` aux liens `target="_blank"` vers un autre site, pour que la page ouverte ne puisse ni lire l'adresse d'origine ni piloter l'onglet de départ (`window.opener`).
- Pistage par rebond. Un lien peut passer par une chaîne de redirections (`site A`, puis `pisteur`, puis `site B`) qui pose un cookie au passage. Suivre les chaînes avec `webRequest.onBeforeRedirect`, apprendre les domaines intermédiaires qui ne sont jamais une destination finale, puis aller directement à la destination.
- Paramètres de suivi inconnus. En plus de la liste fixe, signaler, puis retirer en option, les paramètres de longue valeur aléatoire (forte entropie) ajoutés aux liens qui mènent à un autre site.

### 12. Comportement de l'utilisateur

- Biométrie de frappe et de souris. Le rythme de frappe et la trajectoire de la souris suffisent à reconnaître quelqu'un. Arrondir `event.timeStamp` et `performance.now()` à quelques millisecondes et ajouter un léger décalage déterministe aux coordonnées de `mousemove` lues par des scripts tiers, sans toucher aux clics.
- Capteurs (Firefox Android) : l'accéléromètre et le gyroscope (`devicemotion`, `deviceorientation`) ont des défauts de calibration propres à chaque téléphone. Les couper par défaut ou les arrondir.
- Presse-papiers : bloquer la lecture du presse-papiers sans geste de l'utilisateur, et empêcher les sites de modifier un texte copié (ajout de « Lire la suite sur… » avec un lien de suivi). Ajouter « Copier le lien propre » au menu contextuel.

### 13. Transparence

- Note de confidentialité du site, affichée à côté de la note de fiabilité : nombre de tiers contactés, pisteurs repérés, surfaces d'empreinte lues, cookies tiers, données personnelles envoyées. La fiabilité dit si le site est honnête, la confidentialité dit ce qu'il fait de toi.
- Carte des tiers, dans l'esprit de Lightbeam : un graphe des sites visités et des tiers qu'ils partagent, qui montre d'un coup d'œil quels domaines te suivent partout.
- Bilan de la semaine dans le tableau de bord : nouveaux pisteurs, sites les plus bavards, données bloquées.
- Export et import des réglages, des listes de confiance et des pisteurs appris, pour passer d'un ordinateur à l'autre sans `storage.sync`, qui ferait transiter ces listes par les serveurs de Mozilla.

### 14. Firefox Android

Firefox Android accepte les extensions. Fingerprint Shield y apporterait le plus, car le téléphone est l'appareil où l'empreinte est la plus stable et où les capteurs fuient. Il faudrait :

- un popup lisible sur un écran de téléphone, puisqu'il s'ouvre en plein écran sur Android ;
- des tailles d'écran standards pour mobile dans la liste du niveau renforcé ;
- vérifier les API absentes sur Android (`contextMenus` n'existe pas, `browsingData` partiellement).

### 15. Cohérence de l'empreinte

Un pisteur sérieux ne lit pas seulement les valeurs, il vérifie qu'elles vont ensemble. Une empreinte brouillée mais incohérente est plus rare, donc plus facile à suivre, qu'une empreinte réelle.

- Langues (fait) : au niveau renforcé, `navigator.languages` est réduit et l'en-tête `Accept-Language` est réécrit avec la même liste.
- Écran : `screen.width` est arrondi en JavaScript, mais les requêtes CSS (`@media (device-width: …)`, `matchMedia("(resolution: …)")`) donnent la vraie taille. Aligner `matchMedia` sur les valeurs annoncées, et savoir que le CSS pur (une image de fond chargée selon la taille) restera hors de portée.
- WebGL : le moteur annoncé (« Intel ») doit correspondre aux extensions, aux limites (`MAX_TEXTURE_SIZE`…) et aux formats de précision renvoyés. Sinon un « Intel » qui a les limites d'une carte NVIDIA saute aux yeux. Prévoir des profils complets plutôt qu'un seul nom.
- Matériel : `hardwareConcurrency`, `deviceMemory`, la vitesse mesurée d'un calcul et le nombre de workers réellement lancés en parallèle doivent rester plausibles ensemble.
- Fuseau horaire et adresse IP : sans modifier le fuseau, signaler dans le tableau de bord quand il ne correspond pas au pays de sortie d'un VPN (le pays se déduit du serveur DNS ou d'une requête choisie par l'utilisateur, jamais en tâche de fond).
- Auto-test intégré (première version faite, voir Tests) : il vérifie la stabilité, l'apparence native, la cohérence page, cadre et worker, les langues et l'écran. Reste à ajouter la comparaison avec les en-têtes envoyés au serveur, les profils WebGL complets et la dérive de la mesure de temps.

### 16. Réseau local et appareils

- Bloquer les sites publics qui contactent le réseau local. Des sites (boutiques, banques, via des scripts anti-fraude) sondent `localhost` et les adresses `192.168.x.x` par `fetch` ou `WebSocket` pour repérer les logiciels installés et les ports ouverts. D'autres attaquent l'interface d'administration de la box ou de l'imprimante. Règle : une page servie depuis Internet ne peut pas joindre une adresse locale (fonction `fshIsLocal`, déjà écrite), sauf exception par site.
- IP publique via WebRTC : derrière un VPN mal configuré, STUN révèle la vraie adresse publique. Ajouter un mode « adresses relayées uniquement » (`iceTransportPolicy: "relay"`) pour les sites qui n'ont pas besoin d'appels.
- Signaler les sites qui ouvrent de nombreux workers et consomment le processeur en continu (minage de cryptomonnaie caché dans la page).

### 17. Connexion et certificat

Firefox est le seul navigateur qui donne aux extensions les détails TLS d'une connexion (`webRequest.getSecurityInfo`).

- Certificat émis il y a moins de quelques jours sur un domaine récent : signal fort d'hameçonnage, à ajouter au score de fiabilité.
- Changement d'émetteur sur un site habituel. Si `banque.fr` passe brusquement d'un certificat DigiCert à un certificat inconnu, c'est le signe d'une interception (proxy d'entreprise, logiciel malveillant, réseau Wi-Fi piégé). Mémoriser l'émetteur des sites de confiance et alerter en cas de changement.
- Afficher dans le popup la version TLS, HSTS et la protection du nom du site (ECH, qui cache le domaine visité aux intermédiaires).

### 18. Protection contre les arnaques actives

- ClickFix. Une fausse page de vérification (« Je ne suis pas un robot ») place une commande PowerShell ou `curl | bash` dans le presse-papiers et demande d'appuyer sur Win+R puis Ctrl+V. C'est l'une des attaques les plus répandues aujourd'hui. Bloquer toute écriture dans le presse-papiers qui contient `powershell`, `mshta`, `cmd /c`, `iex`, `curl … | sh` ou une commande encodée en base64, et afficher pourquoi.
- Adresses de portefeuille remplacées. Un script remplace l'adresse Bitcoin ou IBAN copiée par celle de l'escroc. Avertir quand le texte collé diffère de celui que l'utilisateur a copié sur la même page.
- Fausses fenêtres de connexion (« browser in the browser ») : une fenêtre Google ou Microsoft dessinée dans la page, avec une fausse barre d'adresse. Repérer un cadre qui affiche une adresse `https://accounts.…` en texte et contient un champ mot de passe.
- Onglet qui se déguise (tabnabbing) : avertir quand un onglet en arrière-plan change de titre et d'icône pour imiter une page de connexion.
- Faute de frappe sur un site habituel. L'extension connaît, en local, les sites où l'on va souvent. Avant d'ouvrir `paypa1.com` ou `amazon-fr.shop`, elle rappelle : « tu vas souvent sur paypal.com ». C'est plus fiable qu'une liste d'imitation de marques, parce que c'est ta propre liste.
- Téléchargements : avertir avant d'enregistrer un exécutable, un script ou une archive depuis un site douteux ou récent (API `downloads`), et refuser par défaut les fichiers à double extension (`facture.pdf.exe`).

### 19. Contrôle des scripts

- Niveau « paranoïaque », en plus de prudent et renforcé : scripts tiers bloqués par défaut, autorisés site par site depuis le popup, dans l'esprit de NoScript et uMatrix. Une grille simple « ce site peut charger : scripts, cadres, polices, médias de tel domaine » suffit.
- Bloquer la connexion « Google One Tap » et les iframes de connexion sociale chargées sans clic : elles indiquent à Google ou Meta que tu visites le site, même sans te connecter.
- Repérer les scripts anti-fraude (ThreatMetrix, Iovation, Sift, FingerprintJS Pro, DataDome) et laisser le choix : les autoriser sur les banques et les sites de paiement, où ils sont exigés, les bloquer ailleurs.

### 20. Identités de façade

- Alias de messagerie. Sur un formulaire d'inscription, proposer de générer une adresse jetable chez Firefox Relay, SimpleLogin ou addy.io (clé API fournie par l'utilisateur, conservée localement). Chaque site reçoit une adresse différente, ce qui casse aussi la correspondance par adresse mail hachée de la partie 9.
- Données factices pour les champs obligatoires inutiles (date de naissance, téléphone d'un simple téléchargement de livre blanc), choisies par l'utilisateur et jamais inventées sans qu'il le demande.
- Liste des sites qui ont reçu quelle adresse alias, pour savoir qui a revendu une adresse quand du spam arrive.

### 21. Mails et liens marketing

- Pixels de suivi dans les webmails (Outlook, Yahoo, Proton, webmails de FAI) : bloquer les images de 1×1 pixel et les domaines connus d'envoi en masse (`list-manage.com`, `sendgrid.net`, `mailjet.com`, `sendinblue`, `hubspotemail.net`) dans la vue d'un mail.
- Liens de clic des campagnes : ajouter les redirecteurs de mailing à la liste existante quand la destination est lisible dans l'adresse, sinon prévenir que le lien te désigne personnellement.
- Règles de nettoyage par site, dans l'esprit de ClearURLs : Amazon (`/ref=`, `tag=`, `psc`), AliExpress (`spm`, `scm`), Google (`ved`, `ei`, `sca_esv`), LinkedIn (`trackingId`, `refId`), Spotify (`si`), X (`s`, `t`). La liste globale actuelle ne peut pas les couvrir sans casser d'autres sites.

### 22. Nettoyage et urgences

- Sites oubliés : une liste de domaines qui ne restent jamais dans l'historique, les téléchargements récents ni le cache.
- Effacement après inactivité : au bout d'un délai choisi, effacer cookies et stockage de tous les sites hors liste blanche.
- Bouton d'urgence dans le popup : fermer les onglets, effacer les données des dernières heures et changer d'identité en un clic.

### 23. Fiabilité de l'extension elle-même

- L'extension ne doit pas se trahir. Les étiquettes de fiabilité ajoutées au survol des liens et les fenêtres d'avertissement créent des éléments dans la page. Même dans un Shadow DOM fermé, leur hôte est visible et un script peut le repérer. Les créer au dernier moment, les retirer aussitôt, et ne jamais laisser d'attribut ou de style reconnaissable dans le document.
- Détection de casse. Quand un site lève des erreurs juste après une surface brouillée (exception dans un appel WebGL, canvas vide), proposer dans le popup de relâcher seulement cette surface pour ce site, au lieu de tout désactiver.
- Tests automatiques (faits, voir Tests) avec Selenium et geckodriver sous Firefox. Reste à couvrir : les workers et les cadres vides lus tout de suite une fois qu'ils seront traités, WebGL et audio, et une mesure du coût sur une page lourde.
- Mesurer le coût : temps ajouté au chargement d'une page lourde, et mémoire du script d'arrière-plan avec 200 pisteurs et 400 domaines en cache.
- Listes mises à jour (pisteurs, redirecteurs, règles de nettoyage) publiées séparément du code et vérifiées par une signature, pour corriger une règle sans republier l'extension.
- Publication sur addons.mozilla.org avec une politique de confidentialité qui liste chaque service contacté, et traduction de l'interface (`_locales`) pour l'ouvrir à d'autres utilisateurs.

### Permissions supplémentaires à prévoir

Ces fonctionnalités demanderaient `cookies`, `browsingData`, `contextualIdentities`, `contextMenus`, `downloads`, `clipboardRead` (pour comparer copier et coller) et `dns`. Chacune élargit ce que l'extension peut faire : les demander en `optional_permissions`, au moment où l'utilisateur active la fonction concernée.
