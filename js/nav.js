(function () {
  const nav = document.querySelector("#nav");
  const toggle = document.querySelector("#navToggle");
  const header = document.querySelector("#header");
  if (!nav || !toggle || !header) return;
  toggle.addEventListener("click", function () {
    const abierto = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", abierto ? "true" : "false");
    toggle.setAttribute("aria-label", abierto ? "Cerrar menú" : "Abrir menú");
  });
  nav.addEventListener("click", function (event) {
    if (event.target.closest("a")) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
  window.addEventListener("scroll", function () {
    header.classList.toggle("is-stuck", window.scrollY > 12);
  }, { passive: true });
})();
