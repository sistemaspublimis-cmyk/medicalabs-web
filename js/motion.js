(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  function partir(el) {
    if (el.dataset.motion === "1") return;
    el.dataset.motion = "1";
    let orden = 0;
    function recorrer(nodo) {
      Array.from(nodo.childNodes).forEach(function (hijo) {
        if (hijo.nodeType === Node.TEXT_NODE) {
          const partes = hijo.textContent.split(/(\s+)/).filter(function (parte) { return parte.length; });
          const nuevos = partes.map(function (parte) {
            if (/^\s+$/.test(parte)) return document.createTextNode(parte);
            const span = document.createElement("span");
            span.className = "palabra";
            span.style.animationDelay = (orden * 42) + "ms";
            orden += 1;
            span.textContent = parte;
            return span;
          });
          hijo.replaceWith.apply(hijo, nuevos);
          return;
        }
        if (hijo.nodeType === Node.ELEMENT_NODE && hijo.tagName !== "BUTTON" && hijo.tagName !== "A") {
          recorrer(hijo);
        }
      });
    }
    recorrer(el);
  }

  const vistos = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (entrada) {
      if (!entrada.isIntersecting) return;
      partir(entrada.target);
      entrada.target.classList.add("anima");
      vistos.unobserve(entrada.target);
    });
  }, { threshold: 0.35 });

  document.querySelectorAll("h1, h2").forEach(function (titulo) {
    vistos.observe(titulo);
  });
})();
