(function () {
  const ESTADOS = { recibido: "Recibido", en_ruta: "En ruta", entregado: "Entregado" };
  const lista = document.querySelector("#cuentaLista");
  const lead = document.querySelector("#cuentaLead");

  function cuando(valor) {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return valor || "";
    return fecha.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  }

  function entrega(pedido) {
    const texto = [pedido.calle, pedido.colonia, pedido.municipio, pedido.cp].filter(Boolean).join(", ");
    const pin = pedido.lat != null && pedido.lng != null
      ? "Punto " + Number(pedido.lat).toFixed(5) + ", " + Number(pedido.lng).toFixed(5)
      : "";
    return [texto, pin].filter(Boolean).join(" · ");
  }

  const TURNOS = { manana: "Mañana · 10 a 13", tarde: "Tarde · 15 a 18", contacto: "Que te contacten" };
  const VISITA = { solicitada: "Solicitada", confirmada: "Confirmada", hecha: "Hecha", cancelada: "Cancelada" };
  const visitas = document.querySelector("#cuentaVisitas");

  function visitaHtml(visita) {
    const cuandoVisita = visita.modo === "visita"
      ? visita.fecha + " · " + (TURNOS[visita.turno] || visita.turno)
      : TURNOS.contacto;
    const cancelar = visita.status === "solicitada"
      ? "<button type=\"button\" class=\"btn btn--ghost btn--sm\" data-cancelar=\"" + visita.id + "\">Cancelar solicitud</button>"
      : "";
    return (
      "<article class=\"compra\">" +
      "<header><strong>" + window.Medicalabs.escapeHtml(visita.negocio) + "</strong><span>" + window.Medicalabs.escapeHtml(VISITA[visita.status] || visita.status) + "</span></header>" +
      "<p>" + window.Medicalabs.escapeHtml(visita.tipo) + " · " + window.Medicalabs.escapeHtml(cuandoVisita) + "</p>" +
      "<p>" + window.Medicalabs.escapeHtml(entrega(visita)) + "</p>" +
      cancelar +
      "</article>"
    );
  }

  async function pintarVisitas() {
    const data = await window.Medicalabs.api("/api/mis-visitas");
    if (!data.visitas.length) {
      visitas.innerHTML = "<div class=\"vacio vacio--cuenta\"><div><h2>Todavía no hay visita ni contacto.</h2><p>La cuenta del negocio se abre con esa solicitud.</p></div><a class=\"btn btn--lime\" href=\"visita.html\">Agendar o pedir contacto</a></div>";
      return;
    }
    visitas.innerHTML = data.visitas.map(visitaHtml).join("");
  }

  function pedidoHtml(pedido) {
    const piezas = (pedido.piezas || []).map(function (pieza) {
      const promo = pieza.descuento ? " · −" + pieza.descuento + "%" : "";
      return "<li>" + window.Medicalabs.escapeHtml(pieza.nombre) + " · " + pieza.qty + " × " + window.Medicalabs.dinero(pieza.precio) + promo + "</li>";
    }).join("");
    return (
      "<article class=\"compra\">" +
      "<header><strong>" + window.Medicalabs.escapeHtml(pedido.folio) + "</strong><span>" + window.Medicalabs.escapeHtml(ESTADOS[pedido.status] || pedido.status) + "</span></header>" +
      "<p>" + window.Medicalabs.escapeHtml(pedido.negocio) + " · " + window.Medicalabs.escapeHtml(pedido.tipo) + "</p>" +
      "<p>" + window.Medicalabs.escapeHtml(cuando(pedido.created_at)) + "</p>" +
      "<p>" + window.Medicalabs.escapeHtml(entrega(pedido)) + "</p>" +
      "<ul>" + piezas + "</ul>" +
      "<p>Piezas " + window.Medicalabs.dinero(pedido.subtotal) + " · Envío " + window.Medicalabs.dinero(pedido.envio) + " · Total " + window.Medicalabs.dinero(pedido.total) + "</p>" +
      "</article>"
    );
  }

  window.Medicalabs.lista.then(async function (user) {
    if (!user) {
      location.href = "entrar.html?next=cuenta";
      return;
    }
    if (user.role !== "client") {
      lead.textContent = "Esta sesión es del dueño. Los pedidos de cada cliente están en el panel.";
      lista.innerHTML = "<a class=\"btn btn--lime\" href=\"dueno.html\">Abrir panel</a>";
      return;
    }
    lead.textContent = "Cuenta de " + user.name + ". Arriba está la visita o el contacto. Abajo, las compras.";
    prepararUbicacion();
    try {
      await pintarVisitas();
    } catch (err) {
      visitas.innerHTML = "<p>" + window.Medicalabs.escapeHtml(err.message) + "</p>";
    }
    try {
      const data = await window.Medicalabs.api("/api/mis-compras");
      if (!data.pedidos.length) {
        lista.innerHTML = "<div class=\"vacio vacio--cuenta\"><div><h2>Todavía no hay compras en esta cuenta.</h2><p>Suma piezas con precio y confirma el pedido.</p></div><a class=\"btn btn--lime\" href=\"surtido.html\">Ver el surtido</a></div>";
        return;
      }
      lista.innerHTML = data.pedidos.map(pedidoHtml).join("");
    } catch (err) {
      lista.innerHTML = "<p>" + window.Medicalabs.escapeHtml(err.message) + "</p>";
    }
  });

  function prepararUbicacion() {
    const caja = document.querySelector("#cuentaUbi");
    caja.hidden = false;
    const aviso = document.querySelector("#mapaAviso");
    const latEl = document.querySelector("#lat");
    const lngEl = document.querySelector("#lng");
    let mapa = null;
    let marker = null;
    if (window.L) {
      window.L.Icon.Default.mergeOptions({
        iconUrl: "vendor/leaflet/images/marker-icon.png",
        iconRetinaUrl: "vendor/leaflet/images/marker-icon-2x.png",
        shadowUrl: "vendor/leaflet/images/marker-shadow.png"
      });
      mapa = window.L.map(document.querySelector("#mapa"), { scrollWheelZoom: false }).setView([19.4326, -99.1332], 11);
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(mapa);
      mapa.on("click", function (event) {
        poner(event.latlng.lat, event.latlng.lng);
        aviso.textContent = "Punto marcado.";
        if (window.MedicalabsUbi) {
          window.MedicalabsUbi.publicar(event.latlng.lat, event.latlng.lng, null, "punto").catch(function () {});
        }
      });
      setTimeout(function () { mapa.invalidateSize(); }, 250);
    } else {
      aviso.textContent = "El mapa no cargó. Igual puedes pedir la ubicación.";
    }
    function poner(lat, lng) {
      latEl.value = String(lat);
      lngEl.value = String(lng);
      if (!mapa) return;
      if (!marker) marker = window.L.marker([lat, lng]).addTo(mapa);
      else marker.setLatLng([lat, lng]);
      mapa.setView([lat, lng], Math.max(mapa.getZoom(), 15));
    }
    if (window.MedicalabsUbi) {
      window.MedicalabsUbi.conectar({
        aviso: function (texto) { aviso.textContent = texto; },
        ponerPin: poner
      });
    }
    window.Medicalabs.api("/api/mi-ubicacion").then(function (data) {
      if (!data.ubicacion) return;
      poner(data.ubicacion.lat, data.ubicacion.lng);
      aviso.textContent = "La ruta ya tiene tu último punto. El tiempo real hay que volver a encenderlo en esta página.";
    }).catch(function () {});
  }

  document.querySelector("#cuentaVisitas").addEventListener("click", async function (event) {
    const boton = event.target.closest("[data-cancelar]");
    if (!boton) return;
    boton.disabled = true;
    try {
      await window.Medicalabs.api("/api/visitas/cancelar", { id: Number(boton.getAttribute("data-cancelar")) });
      await pintarVisitas();
    } catch (err) {
      boton.disabled = false;
      visitas.insertAdjacentHTML("afterbegin", "<p>" + window.Medicalabs.escapeHtml(err.message) + "</p>");
    }
  });
})();
