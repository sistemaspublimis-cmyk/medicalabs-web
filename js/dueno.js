(function () {
  const ESTADOS = [
    ["recibido", "Recibido"],
    ["en_ruta", "En ruta"],
    ["entregado", "Entregado"]
  ];
  const TURNOS = { manana: "Mañana · 10 a 13", tarde: "Tarde · 15 a 18", contacto: "Que lo contacten" };
  const VISITA = { solicitada: "Solicitada", confirmada: "Confirmada", hecha: "Hecha", cancelada: "Cancelada" };
  const vistas = {
    visitas: document.querySelector("#vistaVisitas"),
    vivo: document.querySelector("#vistaVivo"),
    pedidos: document.querySelector("#vistaPedidos"),
    clientes: document.querySelector("#vistaClientes"),
    productos: document.querySelector("#vistaProductos"),
    ajustes: document.querySelector("#vistaAjustes")
  };
  const tabs = {
    visitas: document.querySelector("#tabVisitas"),
    vivo: document.querySelector("#tabVivo"),
    pedidos: document.querySelector("#tabPedidos"),
    clientes: document.querySelector("#tabClientes"),
    productos: document.querySelector("#tabProductos"),
    ajustes: document.querySelector("#tabAjustes")
  };
  const errorBox = document.querySelector("#duenoError");

  let mapaVivo = null;
  let marcas = {};
  let mapaListo = false;

  function mostrar(cual) {
    Object.keys(vistas).forEach(function (clave) {
      vistas[clave].hidden = clave !== cual;
      tabs[clave].setAttribute("aria-selected", clave === cual ? "true" : "false");
    });
    if (cual === "vivo" && mapaVivo) {
      setTimeout(function () {
        mapaVivo.invalidateSize();
        encuadrar();
      }, 80);
    }
  }

  function encuadrar() {
    const puntos = Object.keys(marcas).map(function (id) { return marcas[id].getLatLng(); });
    if (!puntos.length || !mapaVivo || mapaListo) return;
    if (document.querySelector("#mapaVivo").offsetWidth < 20) return;
    if (puntos.length === 1) mapaVivo.setView(puntos[0], 15);
    else mapaVivo.fitBounds(puntos, { padding: [24, 24] });
    mapaListo = true;
  }

  function hace(valor) {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return "";
    const segundos = Math.max(0, Math.round((Date.now() - fecha.getTime()) / 1000));
    if (segundos < 60) return "hace " + segundos + " s";
    const minutos = Math.round(segundos / 60);
    if (minutos < 60) return "hace " + minutos + " min";
    return cuando(valor);
  }

  function estadoUbi(item) {
    const reciente = Date.now() - new Date(item.updated_at).getTime() < 25000;
    if (item.modo === "vivo" && item.activo && reciente) return "En vivo";
    if (item.modo === "vivo" && item.activo) return "Sin señal reciente";
    if (item.modo === "vivo") return "Detuvo el envío";
    return "Punto marcado";
  }

  function fichaUbi(item) {
    const texto = [item.calle, item.colonia, item.municipio, item.cp].filter(Boolean).join(", ");
    const enlace = "https://www.google.com/maps?q=" + item.lat + "," + item.lng;
    const precision = item.accuracy ? " · ±" + Math.round(item.accuracy) + " m" : "";
    return (
      "<article class=\"compra\">" +
      "<header><strong>" + window.Medicalabs.escapeHtml(item.negocio || item.cliente || "Sin nombre") + "</strong><span>" + window.Medicalabs.escapeHtml(estadoUbi(item)) + "</span></header>" +
      "<p>" + window.Medicalabs.escapeHtml(item.cliente || "") + (item.telefono ? " · " + window.Medicalabs.escapeHtml(item.telefono) : "") + "</p>" +
      (item.tipo ? "<p>" + window.Medicalabs.escapeHtml(item.tipo) + "</p>" : "") +
      (texto ? "<p>" + window.Medicalabs.escapeHtml(texto) + "</p>" : "") +
      (item.referencia ? "<p>" + window.Medicalabs.escapeHtml(item.referencia) + "</p>" : "") +
      "<p>" + window.Medicalabs.escapeHtml(hace(item.updated_at)) + precision + "</p>" +
      "<a href=\"" + enlace + "\" target=\"_blank\" rel=\"noopener\">Abrir en Google Maps</a>" +
      "</article>"
    );
  }

  function iconoUbi(encendido) {
    return window.L.divIcon({
      className: "pin-crudo",
      html: "<span class=\"pin-vivo" + (encendido ? " is-on" : "") + "\"></span>",
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function asegurarMapa() {
    const caja = document.querySelector("#mapaVivo");
    if (!caja || !window.L || mapaVivo) return;
    window.L.Icon.Default.mergeOptions({
      iconUrl: "vendor/leaflet/images/marker-icon.png",
      iconRetinaUrl: "vendor/leaflet/images/marker-icon-2x.png",
      shadowUrl: "vendor/leaflet/images/marker-shadow.png"
    });
    mapaVivo = window.L.map(caja, { scrollWheelZoom: false }).setView([19.4326, -99.1332], 11);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(mapaVivo);
  }

  async function cargarVivo() {
    const data = await window.Medicalabs.api("/api/dueno/ubicaciones");
    const items = data.ubicaciones || [];
    const lista = document.querySelector("#listaVivo");
    lista.innerHTML = items.length ? items.map(fichaUbi).join("") : "<p>Todavía nadie comparte su ubicación.</p>";
    asegurarMapa();
    if (!mapaVivo) return;
    const vistos = {};
    items.forEach(function (item) {
      const id = String(item.user_id);
      vistos[id] = true;
      const encendido = item.modo === "vivo" && item.activo && (Date.now() - new Date(item.updated_at).getTime() < 25000);
      const popup = (item.negocio || item.cliente || "Ubicación") + " · " + estadoUbi(item);
      if (!marcas[id]) {
        marcas[id] = window.L.marker([item.lat, item.lng], { icon: iconoUbi(encendido) }).addTo(mapaVivo);
        marcas[id].bindPopup(popup);
      } else {
        marcas[id].setLatLng([item.lat, item.lng]);
        marcas[id].setIcon(iconoUbi(encendido));
        marcas[id].setPopupContent(popup);
      }
    });
    Object.keys(marcas).forEach(function (id) {
      if (!vistos[id]) {
        mapaVivo.removeLayer(marcas[id]);
        delete marcas[id];
      }
    });
    encuadrar();
  }

  function fallo(mensaje) {
    errorBox.hidden = false;
    errorBox.textContent = mensaje;
  }

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

  function opciones(actual) {
    return ESTADOS.map(function (par) {
      const selected = par[0] === actual ? " selected" : "";
      return "<option value=\"" + par[0] + "\"" + selected + ">" + par[1] + "</option>";
    }).join("");
  }

  async function cargarPedidos() {
    const data = await window.Medicalabs.api("/api/dueno/pedidos");
    if (!data.pedidos.length) {
      vistas.pedidos.innerHTML = "<p>Todavía no hay pedidos.</p>";
      return;
    }
    vistas.pedidos.innerHTML = data.pedidos.map(function (pedido) {
      const piezas = (pedido.piezas || []).map(function (pieza) {
        return "<li>" + window.Medicalabs.escapeHtml(pieza.nombre) + " · " + pieza.qty + "</li>";
      }).join("");
      return (
        "<article class=\"compra\">" +
        "<header><strong>" + window.Medicalabs.escapeHtml(pedido.folio) + "</strong><span>" + window.Medicalabs.escapeHtml(pedido.cliente || "") + "</span></header>" +
        "<p>" + window.Medicalabs.escapeHtml(pedido.negocio) + " · " + window.Medicalabs.escapeHtml(cuando(pedido.created_at)) + "</p>" +
        "<p>" + window.Medicalabs.escapeHtml(entrega(pedido)) + "</p>" +
        "<ul>" + piezas + "</ul>" +
        "<p>Total " + window.Medicalabs.dinero(pedido.total) + " · envío " + window.Medicalabs.dinero(pedido.envio) + "</p>" +
        "<label>Estado <select data-estado=\"" + pedido.id + "\">" + opciones(pedido.status) + "</select></label>" +
        "</article>"
      );
    }).join("");
  }

  async function cargarClientes() {
    const data = await window.Medicalabs.api("/api/dueno/clientes");
    if (!data.clientes.length) {
      vistas.clientes.innerHTML = "<p>Todavía no hay cuentas de cliente.</p>";
      return;
    }
    vistas.clientes.innerHTML = data.clientes.map(function (cliente) {
      const compras = (cliente.compras || []).map(function (compra) {
        return "<li>" + window.Medicalabs.escapeHtml(compra.folio) + " · " + window.Medicalabs.escapeHtml(compra.nombre) + " · " + compra.qty + "</li>";
      }).join("");
      return (
        "<article class=\"compra\">" +
        "<header><strong>" + window.Medicalabs.escapeHtml(cliente.name) + "</strong><span>" + window.Medicalabs.escapeHtml(cliente.email) + "</span></header>" +
        "<p>" + window.Medicalabs.escapeHtml(cliente.phone || "Sin teléfono") + "</p>" +
        (compras ? "<ul>" + compras + "</ul>" : "<p>Sin compras todavía.</p>") +
        "</article>"
      );
    }).join("");
  }

  function opcionesVisita(actual) {
    return Object.keys(VISITA).map(function (clave) {
      const selected = clave === actual ? " selected" : "";
      return "<option value=\"" + clave + "\"" + selected + ">" + VISITA[clave] + "</option>";
    }).join("");
  }

  async function cargarVisitas() {
    const data = await window.Medicalabs.api("/api/dueno/visitas");
    if (!data.visitas.length) {
      vistas.visitas.innerHTML = "<p>Todavía no hay visitas ni solicitudes de contacto.</p>";
      return;
    }
    vistas.visitas.innerHTML = data.visitas.map(function (visita) {
      const cuandoVisita = visita.modo === "visita"
        ? visita.fecha + " · " + (TURNOS[visita.turno] || visita.turno)
        : TURNOS.contacto;
      return (
        "<article class=\"compra\">" +
        "<header><strong>" + window.Medicalabs.escapeHtml(visita.negocio) + "</strong><span>" + window.Medicalabs.escapeHtml(VISITA[visita.status] || visita.status) + "</span></header>" +
        "<p>" + window.Medicalabs.escapeHtml(visita.cliente) + " · " + window.Medicalabs.escapeHtml(visita.email) + " · " + window.Medicalabs.escapeHtml(visita.telefono) + "</p>" +
        "<p>" + window.Medicalabs.escapeHtml(visita.tipo) + " · " + window.Medicalabs.escapeHtml(cuandoVisita) + "</p>" +
        "<p>" + window.Medicalabs.escapeHtml(entrega(visita)) + "</p>" +
        (visita.nota ? "<p>" + window.Medicalabs.escapeHtml(visita.nota) + "</p>" : "") +
        "<label>Estado <select data-visita=\"" + visita.id + "\">" + opcionesVisita(visita.status) + "</select></label>" +
        "</article>"
      );
    }).join("");
  }

  let catalogo = [];
  let topeProductos = 40;

  function pintarPromos() {
    const ofertas = catalogo.filter(function (item) { return item.activo !== false && item.banner; });
    const caja = document.querySelector("#listaPromos");
    if (!caja) return;
    caja.innerHTML = ofertas.map(function (item) {
      return "<li>" + window.Medicalabs.escapeHtml(item.nombre) + " · −" + item.descuento + "%</li>";
    }).join("") || "<li>No hay promociones en la lista.</li>";
  }

  function piezasVisibles() {
    const texto = (document.querySelector("#buscarProducto").value || "").trim().toLowerCase();
    return catalogo.filter(function (item) {
      if (!texto) return true;
      const bolsa = (item.nombre + " " + (item.linea || "") + " " + (item.presentacion || "")).toLowerCase();
      return bolsa.includes(texto);
    });
  }

  function pintarProductos() {
    const lista = document.querySelector("#listaProductos");
    const visibles = piezasVisibles();
    const corte = visibles.slice(0, topeProductos);
    const filas = corte.map(function (item) {
      const precio = item.precio == null ? "Sin precio" : window.Medicalabs.dinero(item.precio);
      const estado = item.activo === false ? "Oculta" : precio;
      const promo = item.descuento ? " · −" + item.descuento + "%" : "";
      return (
        "<article class=\"compra\">" +
        "<header><strong>" + window.Medicalabs.escapeHtml(item.nombre) + "</strong><span>" + window.Medicalabs.escapeHtml(estado) + "</span></header>" +
        "<p>" + window.Medicalabs.escapeHtml(item.linea || "Sin línea") + " · " + window.Medicalabs.escapeHtml(item.presentacion || "Sin presentación") + promo + "</p>" +
        "<button type=\"button\" class=\"btn btn--ghost btn--sm\" data-editar=\"" + window.Medicalabs.escapeHtml(item.id) + "\">Editar</button>" +
        "</article>"
      );
    }).join("");
    const mas = corte.length < visibles.length
      ? "<button type=\"button\" class=\"btn btn--ghost\" id=\"masProductos\">Ver más piezas</button>"
      : "";
    lista.innerHTML = (filas || "<p>Ninguna pieza coincide.</p>") + mas;
    const boton = document.querySelector("#masProductos");
    if (boton) {
      boton.addEventListener("click", function () {
        topeProductos += 40;
        pintarProductos();
      });
    }
  }

  function abrirProducto(item) {
    const form = document.querySelector("#productoForm");
    form.hidden = false;
    document.querySelector("#productoTitulo").textContent = item ? "Editar pieza" : "Nueva pieza";
    document.querySelector("#productoId").value = item ? item.id : "";
    document.querySelector("#productoNombre").value = item ? item.nombre : "";
    document.querySelector("#productoLinea").value = item ? (item.linea || "") : "";
    document.querySelector("#productoPresentacion").value = item ? (item.presentacion || "") : "";
    document.querySelector("#productoPrecio").value = item && item.precio != null ? item.precio : "";
    document.querySelector("#productoDescuento").value = item ? (item.descuento || 0) : 0;
    document.querySelector("#productoNota").value = item ? (item.nota || "") : "";
    document.querySelector("#productoActivo").checked = item ? item.activo !== false : true;
    document.querySelector("#productoAviso").textContent = "";
    document.querySelector("#productoNombre").focus();
  }

  async function cargarProductos() {
    const data = await window.Medicalabs.api("/api/dueno/productos");
    catalogo = data.productos || [];
    pintarProductos();
    pintarPromos();
  }

  Object.keys(tabs).forEach(function (clave) {
    tabs[clave].addEventListener("click", function () { mostrar(clave); });
  });

  document.querySelector("#ayudaBtn").addEventListener("click", function () {
    const texto = document.querySelector("#ayudaTexto");
    const abierto = texto.hidden;
    texto.hidden = !abierto;
    this.setAttribute("aria-expanded", abierto ? "true" : "false");
    if (abierto) texto.focus();
  });

  vistas.visitas.addEventListener("change", async function (event) {
    const id = event.target.getAttribute("data-visita");
    if (!id) return;
    errorBox.hidden = true;
    try {
      await window.Medicalabs.api("/api/dueno/visita", { id: Number(id), status: event.target.value });
      await cargarVisitas();
    } catch (err) {
      fallo(err.message);
    }
  });

  vistas.pedidos.addEventListener("change", async function (event) {
    const id = event.target.getAttribute("data-estado");
    if (!id) return;
    errorBox.hidden = true;
    try {
      await window.Medicalabs.api("/api/dueno/estado", { id: Number(id), status: event.target.value });
    } catch (err) {
      fallo(err.message);
    }
  });

  document.querySelector("#chatToggle").addEventListener("change", async function (event) {
    const aviso = document.querySelector("#chatAviso");
    try {
      const data = await window.Medicalabs.api("/api/dueno/chat", { enabled: event.target.checked });
      aviso.textContent = data.enabled ? "El recuadro ya se puede ver en la página." : "El recuadro quedó oculto.";
      const widget = document.querySelector("#chatWidget");
      if (data.enabled && widget) widget.hidden = false;
      if (!data.enabled && widget) widget.hidden = true;
    } catch (err) {
      event.target.checked = !event.target.checked;
      fallo(err.message);
    }
  });

  document.querySelector("#nuevoProducto").addEventListener("click", function () {
    abrirProducto(null);
  });
  document.querySelector("#cerrarProducto").addEventListener("click", function () {
    document.querySelector("#productoForm").hidden = true;
  });
  document.querySelector("#buscarProducto").addEventListener("input", function () {
    topeProductos = 40;
    pintarProductos();
  });
  document.querySelector("#listaProductos").addEventListener("click", function (event) {
    const id = event.target.getAttribute("data-editar");
    if (!id) return;
    const item = catalogo.find(function (pieza) { return pieza.id === id; });
    if (item) abrirProducto(item);
  });
  document.querySelector("#productoForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const aviso = document.querySelector("#productoAviso");
    const precio = document.querySelector("#productoPrecio").value.trim();
    aviso.textContent = "Guardando.";
    try {
      const data = await window.Medicalabs.api("/api/dueno/producto", {
        id: document.querySelector("#productoId").value,
        nombre: document.querySelector("#productoNombre").value.trim(),
        linea: document.querySelector("#productoLinea").value.trim(),
        presentacion: document.querySelector("#productoPresentacion").value.trim(),
        precio: precio === "" ? null : Number(precio),
        descuento: Number(document.querySelector("#productoDescuento").value || 0),
        nota: document.querySelector("#productoNota").value.trim(),
        activo: document.querySelector("#productoActivo").checked
      });
      const guardada = data.producto;
      const idx = catalogo.findIndex(function (pieza) { return pieza.id === guardada.id; });
      if (idx >= 0) catalogo[idx] = guardada;
      else catalogo.unshift(guardada);
      catalogo.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
      pintarProductos();
      pintarPromos();
      abrirProducto(guardada);
      aviso.textContent = "Guardado. Ya se ve así en el surtido.";
    } catch (err) {
      aviso.textContent = err.message;
    }
  });

  window.Medicalabs.lista.then(async function (user) {
    if (!user || user.role !== "owner") {
      document.querySelector("#panelNo").hidden = false;
      return;
    }
    document.querySelector("#panelApp").hidden = false;
    pintarPromos();
    try {
      const estado = await window.Medicalabs.api("/api/chat/status");
      document.querySelector("#chatToggle").checked = !!estado.enabled;
      await cargarVisitas();
      await cargarPedidos();
      await cargarClientes();
      await cargarVivo();
      await cargarProductos();
      setInterval(function () {
        cargarVivo().catch(function () {});
      }, 6000);
    } catch (err) {
      fallo(err.message);
    }
  });
})();
