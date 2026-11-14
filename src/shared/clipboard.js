// Détection de ce qu'une page met dans ton presse-papiers pour te piéger. Chargé dans le monde de la page juste avant
// inject.js, qui récupère l'objet puis supprime ce nom : la page ne le voit jamais. (Les tests le chargent tel quel.)
globalThis.__fshClipboard = (() => {
  // Commandes qu'une arnaque te fait coller dans Windows+R, PowerShell ou un terminal.
  const CMD = new RegExp(
    [
      String.raw`powershell(?:\.exe)?\b[^\n]*(?:\s-(?:e|ec|enc|encodedcommand)\b|\s-w(?:indowstyle)?\s+h(?:idden)?|\biex\b|invoke-expression|downloadstring|invoke-webrequest|\biwr\b|net\.webclient|\bstart-process\b)`,
      String.raw`mshta(?:\.exe)?\s+(?:https?:|vbscript:|javascript:)`,
      String.raw`cmd(?:\.exe)?\s*/c\s[^\n]*(?:curl|powershell|mshta|certutil|bitsadmin|wscript|cscript|start\s)`,
      String.raw`\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b`,
      String.raw`certutil(?:\.exe)?\s[^\n]*-urlcache`,
      String.raw`bitsadmin\s[^\n]*/transfer`,
      String.raw`regsvr32\s[^\n]*/i:https?:`,
      String.raw`rundll32(?:\.exe)?\s[^\n]*https?:`,
      String.raw`msiexec(?:\.exe)?\s[^\n]*/i\s*https?:`,
      String.raw`\bosascript\b[^\n]*-e\b`,
    ].join("|"),
    "i"
  );

  // PowerShell caché et encodé : aucune documentation ne te fait copier ça.
  const HIDDEN_ENCODED =
    /powershell[^\n]*-w(?:indowstyle)?\s+h(?:idden)?[^\n]*-(?:e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}|powershell[^\n]*-(?:enc|encodedcommand)\s+[A-Za-z0-9+/=]{60,}/i;

  // Ce que la page raconte autour : les deux premières lignes sont propres aux arnaques ClickFix, les autres sont banales
  // (une documentation dit aussi « colle » et « appuie sur Entrée »). Il en faut une des deux premières, plus une autre.
  const SPECIFIC = [
    /win(?:dows)?\s*(?:\+|\s)\s*r\b|touche\s+windows|windows\s+key|⊞/i, // Windows+R : la boîte « Exécuter »
    /(?:verify|verification|v[ée]rifi\w*)\b[^\n]{0,40}\b(?:human|humain|robot)|not a robot|pas un robot|captcha/i, // fausse vérification
  ];
  const COMMON = [
    /ctrl\s*\+\s*v|cmd\s*\+\s*v|⌘\s*v|\b(?:coll(?:er|ez)|paste)\b/i,
    /(?:appuyez|press|hit|puis)\s+(?:sur\s+)?(?:la\s+touche\s+)?(?:entr[ée]e|enter|return)/i,
    /(?:ex[ée]cuter|\brun\b)\b[^\n]{0,30}(?:dialog|bo[iî]te|fen[eê]tre|window)/i,
  ];

  // Ce que la page demande-t-elle de faire, d'après son texte ? Au moins une consigne propre à ClickFix et une autre.
  const looksLikeClickFix = (pageText) => SPECIFIC.some((r) => r.test(pageText)) && SPECIFIC.concat(COMMON).filter((r) => r.test(pageText)).length >= 2;

  // « clickfix » (commande + consignes de la page), « obfuscated » (PowerShell caché et encodé, seul), ou null.
  function risk(text, pageText) {
    if (typeof text !== "string" || text.length < 12) return null;
    if (HIDDEN_ENCODED.test(text)) return "obfuscated";
    if (CMD.test(text) && looksLikeClickFix(String(pageText || ""))) return "clickfix";
    return null;
  }

  // Adresses de portefeuille et IBAN : ce que des logiciels malveillants remplacent au moment de copier.
  const ADDRESS = /^(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|[LM][a-km-zA-HJ-NP-Z1-9]{26,33}|T[1-9A-HJ-NP-Za-km-z]{33}|[A-Z]{2}\d{2}[A-Z0-9]{11,30})$/;
  const looksLikeAddress = (s) => ADDRESS.test(String(s).replace(/\s+/g, ""));

  // Ce qui est mis dans le presse-papiers n'est pas ce qui a été sélectionné, alors que la sélection est une adresse.
  function hijack(selected, replacement) {
    const sel = String(selected).trim();
    return looksLikeAddress(sel) && sel.replace(/\s+/g, "") !== String(replacement).trim().replace(/\s+/g, "");
  }

  // Un site qui ajoute un lien à ce que tu copies (« Lire la suite sur https://... ») : le texte copié commence par ce que tu as
  // sélectionné et se prolonge d'une adresse.
  function appended(selected, replacement) {
    const sel = String(selected).trim();
    const rep = String(replacement);
    return sel.length >= 3 && rep.startsWith(sel) && rep.length - sel.length >= 12 && /https?:\/\/\S+/.test(rep.slice(sel.length));
  }

  return { risk, hijack, appended };
})();
