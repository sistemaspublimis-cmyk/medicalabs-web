(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(path, body) {
    const opts = { credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      opts.method = "POST";
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const error = new Error(data.error || "No se pudo completar.");
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function dinero(valor) {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2
    }).format(valor);
  }

  function pintarNav(user) {
    const slot = document.querySelector("#sesionNav");
    if (!slot) return;
    if (!user) {
      slot.innerHTML = "<a href=\"entrar.html\">Entrar</a>";
      return;
    }
    if (user.role === "owner") {
      slot.innerHTML = "<a href=\"dueno.html\">Panel</a><button type=\"button\" class=\"btn btn--ghost btn--sm\" id=\"salir\">Salir</button>";
    } else {
      slot.innerHTML = "<a href=\"cuenta.html\">Mi cuenta</a><button type=\"button\" class=\"btn btn--ghost btn--sm\" id=\"salir\">Salir</button>";
    }
    document.querySelector("#salir").addEventListener("click", async function () {
      await api("/api/salir", {});
      location.href = "index.html";
    });
  }

  function prepararChat() {
    if (document.querySelector("#chatWidget")) return;
    const caja = document.createElement("div");
    caja.className = "chat";
    caja.id = "chatWidget";
    caja.hidden = true;
    caja.innerHTML =
      "<button class=\"btn btn--lime chat__abrir\" type=\"button\" id=\"chatAbrir\">Preguntar</button>" +
      "<form id=\"chatForm\" class=\"chat__caja\" hidden>" +
      "<p class=\"kicker\">Asistente</p>" +
      "<label for=\"chatTexto\">Pregunta sobre el surtido</label>" +
      "<textarea id=\"chatTexto\" rows=\"3\"></textarea>" +
      "<div class=\"chat__acciones\">" +
      "<button class=\"btn btn--lime btn--sm\" type=\"submit\">Enviar</button>" +
      "<button class=\"btn btn--ghost btn--sm\" type=\"button\" id=\"chatCerrar\">Cerrar</button>" +
      "</div>" +
      "<p id=\"chatReply\"></p>" +
      "</form>";
    document.body.appendChild(caja);
    const form = caja.querySelector("#chatForm");
    caja.querySelector("#chatAbrir").addEventListener("click", function () {
      form.hidden = false;
      caja.querySelector("#chatTexto").focus();
    });
    caja.querySelector("#chatCerrar").addEventListener("click", function () {
      form.hidden = true;
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const texto = caja.querySelector("#chatTexto").value.trim();
      const reply = caja.querySelector("#chatReply");
      if (!texto) return;
      reply.textContent = "Un momento.";
      try {
        const data = await api("/api/chat", { message: texto });
        reply.textContent = data.enabled
          ? (data.reply || "Sin respuesta.")
          : "El asistente está apagado.";
      } catch (err) {
        reply.textContent = err.message;
      }
    });
  }

  async function revisarChat() {
    prepararChat();
    try {
      const estado = await api("/api/chat/status");
      document.querySelector("#chatWidget").hidden = !estado.enabled;
    } catch (err) {
      document.querySelector("#chatWidget").hidden = true;
    }
  }

  const lista = api("/api/yo")
    .then(function (data) { return data.user || null; })
    .catch(function () { return null; })
    .then(function (user) {
      window.Medicalabs.usuario = user;
      pintarNav(user);
      document.dispatchEvent(new CustomEvent("medicalabs:sesion", { detail: user }));
      return user;
    });

  window.Medicalabs = {
    api: api,
    dinero: dinero,
    escapeHtml: escapeHtml,
    lista: lista,
    usuario: undefined
  };

  revisarChat();
})();
