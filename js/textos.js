(function () {
  document.querySelectorAll("[data-copiar]").forEach(function (boton) {
    const original = boton.textContent;
    boton.addEventListener("click", async function () {
      const nodo = document.getElementById(boton.getAttribute("data-copiar"));
      if (!nodo) return;
      const texto = nodo.innerText.replace(/\s+\n/g, "\n").trim();
      try {
        await navigator.clipboard.writeText(texto);
        boton.textContent = "Copiado";
      } catch (err) {
        const rango = document.createRange();
        rango.selectNodeContents(nodo);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(rango);
        boton.textContent = "Texto seleccionado";
      }
      window.setTimeout(function () { boton.textContent = original; }, 1600);
    });
  });
})();
