// Faux mineur de cryptomonnaie : lance huit workers d'un coup depuis un script d'un autre site.
(() => {
  const url = URL.createObjectURL(new Blob(["self.onmessage = () => {}"], { type: "text/javascript" }));
  for (let i = 0; i < 8; i++) new Worker(url);
})();
