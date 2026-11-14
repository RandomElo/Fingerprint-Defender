// Page qui remplace un contenu intégré (cadre YouTube, carte, publication...) tant qu'on n'a pas cliqué. Le fond de page
// est celui du cadre : elle doit rester petite et lisible dans un espace de la taille d'une vidéo.
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const target = q.get("u") || "";
const embed = fshEmbedOf(target);

(async () => {
  // N'importe quelle page peut ouvrir celle-ci avec l'adresse de son choix : on ne charge que ce qui est un contenu intégré connu.
  if (!embed) {
    $("title").textContent = "Contenu non reconnu";
    $("why").textContent = "Cette adresse n'est pas un contenu intégré connu.";
    $("load").hidden = true;
    $("always").parentElement.hidden = true;
    return;
  }
  const host = new URL(target).hostname;
  $("title").textContent = embed.name + " : contenu bloqué";
  $("why").textContent = `Ce contenu contacterait ${host} et lui dirait que tu visites cette page, même sans le lancer.`;

  const info = await chrome.runtime.sendMessage({ type: "embed-info" }).catch(() => null);
  const site = info && info.site;
  if (site) $("site").textContent = site;
  else $("always").parentElement.hidden = true;

  $("load").addEventListener("click", async () => {
    const dest = fshEmbedLoadUrl(target);
    if ($("always").checked && site) {
      const { embedAllow } = await chrome.storage.local.get({ embedAllow: [] });
      await chrome.storage.local.set({ embedAllow: [...new Set([...embedAllow, site])] });
    }
    await chrome.runtime.sendMessage({ type: "embed-allow", url: dest });
    location.replace(dest);
  });
})();
