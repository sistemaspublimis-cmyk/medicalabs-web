(function () {
  const CART_KEY = "medicalabs-carrito";

  const nav = document.querySelector("#nav");
  const toggle = document.querySelector("#navToggle");
  const header = document.querySelector("#header");
  const form = document.querySelector("#pedidoForm");
  const errorBox = document.querySelector("#formError");
  const okBox = document.querySelector("#formOk");
  const folioEl = document.querySelector("#folio");
  const okTotales = document.querySelector("#okTotales");
  const grid = document.querySelector("#surtidoGrid");
  const vacio = document.querySelector("#surtidoVacio");
  const promos = document.querySelector("#promos");
  const buscar = document.querySelector("#buscarPieza");
  const filtroLinea = document.querySelector("#filtroLinea");
  const conteo = document.querySelector("#conteo");
  const verMas = document.querySelector("#verMas");
  const carritoLineas = document.querySelector("#carritoLineas");
  const carritoVacio = document.querySelector("#carritoVacio");
  const envioMetro = document.querySelector("#envioMetro");
  const sesionPedido = document.querySelector("#sesionPedido");
  const pedidoBtn = document.querySelector("#pedidoBtn");
  const sumado = document.querySelector("#sumado");
  const mapaAviso = document.querySelector("#mapaAviso");
  const latEl = document.querySelector("#lat");
  const lngEl = document.querySelector("#lng");
  const quitarPunto = document.querySelector("#quitarPunto");

  let limite = 24;
  let marker = null;
  let mapa = null;

  function catalogo() {
    return window.MEDICALABS_PRODUCTOS || [];
  }

  function escapeHtml(value) {
    return window.Medicalabs ? window.Medicalabs.escapeHtml(value) : String(value || "");
  }

  function dinero(valor) {
    return window.Medicalabs.dinero(valor);
  }

  function money(valor) {
    return Math.round((Number(valor) + 1e-9) * 100) / 100;
  }

  function pieza(id) {
    return catalogo().find(function (item) { return item.id === id; });
  }

  function unitario(item) {
    if (!item || item.precio == null) return null;
    return money(Number(item.precio) * (100 - (item.descuento || 0)) / 100);
  }

  function leerCarrito() {
    try {
      const data = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(data)) return [];
      return data.filter(function (linea) {
        return linea && linea.id && pieza(linea.id) && pieza(linea.id).precio != null;
      }).map(function (linea) {
        const qty = Math.max(1, Math.min(99, parseInt(linea.qty, 10) || 1));
        return { id: linea.id, qty: qty };
      });
    } catch (err) {
      return [];
    }
  }

  function totales(items) {
    const subtotal = money(items.reduce(function (suma, linea) {
      return suma + unitario(pieza(linea.id)) * linea.qty;
    }, 0));
    return { subtotal: subtotal, envio: 0, total: subtotal };
  }

  function guardarCarrito(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    pintarCarrito();
  }

  function anunciar(texto) {
    if (!sumado) return;
    sumado.textContent = texto;
  }

  function pintarCarrito() {
    const items = leerCarrito();
    const cuenta = items.reduce(function (suma, linea) { return suma + linea.qty; }, 0);
    if (pedidoBtn) {
      const etiqueta = cuenta ? "Armar pedido · " + cuenta + " " : "Armar pedido ";
      const flecha = pedidoBtn.querySelector(".flecha");
      if (flecha) pedidoBtn.firstChild.textContent = etiqueta;
      else pedidoBtn.textContent = etiqueta.trim();
    }
    if (!carritoLineas) return;
    if (!items.length) {
      carritoLineas.innerHTML = "";
      carritoVacio.hidden = false;
    } else {
      carritoVacio.hidden = true;
      carritoLineas.innerHTML = items.map(function (linea) {
        const item = pieza(linea.id);
        const importe = money(unitario(item) * linea.qty);
        return (
          "<div class=\"carrito-linea\">" +
          "<div><strong>" + escapeHtml(item.nombre) + "</strong><p class=\"muted\">" + escapeHtml(item.presentacion || "") + "</p></div>" +
          "<input class=\"qty\" type=\"number\" min=\"1\" max=\"99\" value=\"" + linea.qty + "\" data-qty=\"" + escapeHtml(linea.id) + "\" aria-label=\"Cantidad de " + escapeHtml(item.nombre) + "\">" +
          "<div class=\"carrito-linea__lado\"><span>" + dinero(importe) + "</span><button type=\"button\" class=\"btn btn--ghost btn--sm\" data-quitar=\"" + escapeHtml(linea.id) + "\">Quitar</button></div>" +
          "</div>"
        );
      }).join("");
    }
    const cifras = totales(items);
    const mensaje = "El envío va en $0.";
    envioMetro.innerHTML =
      "<p>" + mensaje + "</p>" +
      "<p>Piezas <strong>" + dinero(cifras.subtotal) + "</strong></p>" +
      "<p>Envío <strong>" + (cifras.subtotal ? dinero(cifras.envio) : "—") + "</strong></p>" +
      "<p>Total <strong>" + (cifras.subtotal ? dinero(cifras.total) : "—") + "</strong></p>" +
      "<p class=\"muted\">El total se confirma al cerrar el pedido.</p>";
  }

  function sumarPieza(item) {
    if (!item || item.precio == null) return;
    const items = leerCarrito();
    const ya = items.find(function (linea) { return linea.id === item.id; });
    if (ya) ya.qty = Math.min(99, ya.qty + 1);
    else items.push({ id: item.id, qty: 1 });
    guardarCarrito(items);
    anunciar("Sumado al pedido: " + item.nombre);
  }

  function coinciden() {
    const linea = filtroLinea ? filtroLinea.value : "";
    const texto = (buscar && buscar.value || "").trim().toLowerCase();
    return catalogo().filter(function (item) {
      if (linea && item.linea !== linea) return false;
      if (!texto) return true;
      const bolsa = (item.nombre + " " + item.linea + " " + (item.presentacion || "")).toLowerCase();
      return bolsa.includes(texto);
    });
  }

  function fichaHtml(item) {
    const foto = item.imagen
      ? "<img src=\"" + escapeHtml(item.imagen) + "\" alt=\"" + escapeHtml(item.nombre) + "\">"
      : "<div class=\"ficha__hueco\" aria-hidden=\"true\"><span>" + escapeHtml(item.linea) + "</span></div>";
    const unit = unitario(item);
    let precio = "<p class=\"muted\">Precio por confirmar</p>";
    if (item.precio != null && item.descuento) {
      precio = "<p class=\"ficha__precio\">" + dinero(unit) + "</p><p class=\"etiqueta\">−" + item.descuento + "% en el pedido</p>";
    } else if (item.precio != null) {
      precio = "<p class=\"ficha__precio\">" + dinero(item.precio) + "</p>";
    }
    const boton = item.precio == null
      ? "<button type=\"button\" class=\"btn btn--ghost btn--sm\" disabled>Sin precio de lista</button>"
      : "<button type=\"button\" class=\"btn btn--lime btn--sm\" data-id=\"" + escapeHtml(item.id) + "\">Sumar al pedido</button>";
    return (
      "<article class=\"ficha\" id=\"" + escapeHtml(item.id) + "\">" +
      foto +
      "<div class=\"ficha__cuerpo\">" +
      "<p class=\"kicker\">" + escapeHtml(item.linea || "Venta libre") + "</p>" +
      "<h3>" + escapeHtml(item.nombre) + "</h3>" +
      "<p>" + escapeHtml(item.presentacion || "") + "</p>" +
      precio +
      (item.nota ? "<p class=\"muted\">" + escapeHtml(item.nota) + "</p>" : "") +
      boton +
      "</div></article>"
    );
  }

  function renderProductos() {
    if (!grid || !conteo || !verMas) return;
    const visibles = coinciden();
    if (!visibles.length) {
      grid.hidden = true;
      grid.innerHTML = "";
      verMas.hidden = true;
      conteo.textContent = "Ninguna pieza coincide con esa búsqueda.";
      return;
    }
    grid.hidden = false;
    if (vacio) vacio.hidden = true;
    const corte = visibles.slice(0, limite);
    grid.innerHTML = corte.map(fichaHtml).join("");
    conteo.textContent = "Mostrando " + corte.length + " de " + visibles.length + " piezas.";
    verMas.hidden = corte.length >= visibles.length;
  }

  function renderPromos() {
    if (!promos) return;
    const ofertas = catalogo().filter(function (item) { return item.banner; });
    if (!ofertas.length) {
      promos.hidden = true;
      return;
    }
    promos.hidden = false;
    promos.innerHTML = ofertas.map(function (item) {
      return (
        "<article class=\"promo\">" +
        "<p class=\"promo__pct\">−" + item.descuento + "%</p>" +
        "<div><p class=\"kicker\">Promoción de ruta</p><h3>" + escapeHtml(item.nombre) + "</h3><p>" + escapeHtml(item.banner) + "</p><p>" + dinero(unitario(item)) + " en el pedido</p><p class=\"muted\">" + escapeHtml(item.nota || "") + "</p></div>" +
        "<button type=\"button\" class=\"btn btn--lime btn--sm\" data-id=\"" + escapeHtml(item.id) + "\">Sumar al pedido</button>" +
        "</article>"
      );
    }).join("");
  }

  function prepararSurtido() {
    renderPromos();
    if (!grid || !filtroLinea) return;
    const items = catalogo();
    if (!items.length) {
      if (vacio) vacio.hidden = false;
      grid.hidden = true;
      if (verMas) verMas.hidden = true;
      return;
    }
    const lineas = Array.from(new Set(items.map(function (item) { return item.linea; }).filter(Boolean)))
      .sort(function (a, b) { return a.localeCompare(b, "es"); });
    filtroLinea.innerHTML = "<option value=\"\">Todas</option>" + lineas
      .map(function (linea) { return "<option value=\"" + escapeHtml(linea) + "\">" + escapeHtml(linea) + "</option>"; })
      .join("");
    renderProductos();
  }

  function aplicarSesion(user) {
    if (!sesionPedido) return;
    const tel = document.querySelector("#telefono");
    if (!user) {
      sesionPedido.textContent = "Para confirmar, entra a tu cuenta.";
      return;
    }
    if (user.role === "owner") {
      sesionPedido.textContent = "Esta sesión es del dueño. El pedido se confirma con una cuenta de cliente.";
      return;
    }
    sesionPedido.textContent = "Confirmas como " + user.name + ". Lo comprado queda en Mi cuenta.";
    if (tel && !tel.value && user.phone) tel.value = user.phone;
  }

  function ponerPin(lat, lng) {
    latEl.value = String(lat);
    lngEl.value = String(lng);
    quitarPunto.hidden = false;
    if (!mapa || !window.L) return;
    if (!marker) marker = window.L.marker([lat, lng]).addTo(mapa);
    else marker.setLatLng([lat, lng]);
    mapa.setView([lat, lng], Math.max(mapa.getZoom(), 15));
  }

  function limpiarPin() {
    latEl.value = "";
    lngEl.value = "";
    quitarPunto.hidden = true;
    if (marker && mapa) {
      mapa.removeLayer(marker);
      marker = null;
    }
  }

  function iniciarMapa() {
    const caja = document.querySelector("#mapa");
    if (!caja || !window.L) {
      if (mapaAviso) mapaAviso.textContent = "El mapa no cargó. La dirección escrita alcanza para el envío.";
      return;
    }
    window.L.Icon.Default.mergeOptions({
      iconUrl: "vendor/leaflet/images/marker-icon.png",
      iconRetinaUrl: "vendor/leaflet/images/marker-icon-2x.png",
      shadowUrl: "vendor/leaflet/images/marker-shadow.png"
    });
    mapa = window.L.map(caja, { scrollWheelZoom: false }).setView([19.4326, -99.1332], 11);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(mapa);
    mapa.on("click", function (event) {
      ponerPin(event.latlng.lat, event.latlng.lng);
      mapaAviso.textContent = "Punto marcado. Con eso basta, aunque la dirección quede vacía.";
      if (window.MedicalabsUbi) {
        window.MedicalabsUbi.publicar(event.latlng.lat, event.latlng.lng, null, "punto").catch(function () {});
      }
    });
    setTimeout(function () { mapa.invalidateSize(); }, 250);
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      const abierto = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", abierto ? "true" : "false");
      toggle.setAttribute("aria-label", abierto ? "Cerrar menú" : "Abrir menú");
    });
    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Abrir menú");
      }
    });
  }

  if (header) {
    window.addEventListener("scroll", function () {
      header.classList.toggle("is-stuck", window.scrollY > 12);
    }, { passive: true });
  }

  function alSumar(event) {
    const boton = event.target.closest("[data-id]");
    if (!boton || boton.disabled) return;
    const item = pieza(boton.getAttribute("data-id"));
    if (item) sumarPieza(item);
  }

  if (buscar) {
    buscar.addEventListener("input", function () {
      limite = 24;
      renderProductos();
    });
  }
  if (filtroLinea) {
    filtroLinea.addEventListener("change", function () {
      limite = 24;
      renderProductos();
    });
  }
  if (verMas) {
    verMas.addEventListener("click", function () {
      limite += 24;
      renderProductos();
    });
  }
  if (grid) grid.addEventListener("click", alSumar);
  if (promos) promos.addEventListener("click", alSumar);

  if (carritoLineas) {
    carritoLineas.addEventListener("click", function (event) {
      const id = event.target.getAttribute("data-quitar");
      if (!id) return;
      guardarCarrito(leerCarrito().filter(function (linea) { return linea.id !== id; }));
    });
    carritoLineas.addEventListener("change", function (event) {
      const id = event.target.getAttribute("data-qty");
      if (!id) return;
      const qty = Math.max(1, Math.min(99, parseInt(event.target.value, 10) || 1));
      const items = leerCarrito().map(function (linea) {
        return linea.id === id ? { id: id, qty: qty } : linea;
      });
      guardarCarrito(items);
    });
  }

  const irMapa = document.querySelector("#irMapa");
  if (irMapa) irMapa.addEventListener("click", async function () {
    const q = document.querySelector("#buscarMapa").value.trim();
    mapaAviso.textContent = "Buscando el punto.";
    try {
      const punto = await window.Medicalabs.api("/api/geo?q=" + encodeURIComponent(q));
      ponerPin(punto.lat, punto.lng);
      mapaAviso.textContent = punto.nombre || "Punto encontrado.";
    } catch (err) {
      mapaAviso.textContent = err.message || "No se pudo buscar. Márcalo con un clic.";
    }
  });
  if (quitarPunto) {
    quitarPunto.addEventListener("click", function () {
      limpiarPin();
      mapaAviso.textContent = "Punto quitado. Escribe la dirección o márcalo otra vez.";
    });
  }

  if (form) form.addEventListener("submit", async function (event) {
    event.preventDefault();
    okBox.hidden = true;
    const items = leerCarrito();
    const calle = document.querySelector("#calle").value.trim();
    const colonia = document.querySelector("#colonia").value.trim();
    const municipio = document.querySelector("#municipio").value.trim();
    const texto = calle.length >= 4 && colonia.length >= 2 && municipio.length >= 2;
    const lat = latEl.value;
    const lng = lngEl.value;
    const fallos = [];
    const negocio = document.querySelector("#negocio").value.trim();
    const tipo = document.querySelector("#tipo").value.trim();
    const telefono = document.querySelector("#telefono").value.replace(/\D/g, "");
    if (negocio.length < 2) fallos.push("Escribe el nombre del negocio.");
    if (!tipo) fallos.push("Elige si es farmacia, tienda o negocio local.");
    if (telefono.length !== 10) fallos.push("El teléfono lleva 10 dígitos.");
    if (!items.length) fallos.push("Suma al menos una pieza con precio.");
    if (!texto && !(lat && lng)) fallos.push("Escribe la dirección o marca el punto en el mapa.");
    if (fallos.length) {
      errorBox.hidden = false;
      errorBox.innerHTML = fallos.map(function (f) { return "<li>" + escapeHtml(f) + "</li>"; }).join("");
      errorBox.focus();
      return;
    }
    let user = window.Medicalabs.usuario;
    try {
      const yo = await window.Medicalabs.api("/api/yo");
      user = yo.user;
    } catch (err) {
      user = null;
    }
    if (!user) {
      location.href = "entrar.html?next=pedido";
      return;
    }
    if (user.role !== "client") {
      errorBox.hidden = false;
      errorBox.innerHTML = "<li>Entra con una cuenta de cliente para confirmar el pedido.</li>";
      errorBox.focus();
      return;
    }
    errorBox.hidden = true;
    const boton = form.querySelector("[type=submit]");
    boton.disabled = true;
    try {
      const respuesta = await window.Medicalabs.api("/api/pedidos", {
        negocio: negocio,
        tipo: tipo,
        telefono: telefono,
        nota: document.querySelector("#nota").value.trim(),
        calle: calle,
        colonia: colonia,
        municipio: municipio,
        cp: document.querySelector("#cp").value.trim(),
        referencia: document.querySelector("#referencia").value.trim(),
        lat: lat || null,
        lng: lng || null,
        piezas: items
      });
      guardarCarrito([]);
      form.reset();
      limpiarPin();
      folioEl.textContent = respuesta.folio;
      okTotales.textContent = "Piezas " + dinero(respuesta.subtotal) + " · Envío " + dinero(respuesta.envio) + " · Total " + dinero(respuesta.total);
      okBox.hidden = false;
      okBox.focus();
    } catch (err) {
      if (err.status === 401) {
        location.href = "entrar.html?next=pedido";
        return;
      }
      errorBox.hidden = false;
      errorBox.innerHTML = "<li>" + escapeHtml(err.message) + "</li>";
      errorBox.focus();
    } finally {
      boton.disabled = false;
    }
  });

  document.addEventListener("medicalabs:sesion", function (event) {
    aplicarSesion(event.detail);
  });
  if (window.Medicalabs && window.Medicalabs.lista) {
    window.Medicalabs.lista.then(aplicarSesion);
  }

  prepararSurtido();
  pintarCarrito();
  if (window.Medicalabs && (grid || promos || carritoLineas)) {
    window.Medicalabs.api("/api/productos").then(function (data) {
      if (!data.productos) return;
      window.MEDICALABS_PRODUCTOS = data.productos;
      limite = 24;
      prepararSurtido();
      pintarCarrito();
    }).catch(function () {});
  }
  if (document.querySelector("#mapa")) iniciarMapa();
  if (window.MedicalabsUbi && document.querySelector("#usarUbi")) {
    window.MedicalabsUbi.conectar({
      aviso: function (texto) { if (mapaAviso) mapaAviso.textContent = texto; },
      ponerPin: ponerPin
    });
  }
  prepararCp();

  function prepararCp() {
  const campo = document.querySelector("#cp");
  const lista = document.querySelector("#listaCp");
  if (!campo || !lista || !window.Medicalabs) return;
  let pedido = "";
  campo.addEventListener("input", async function () {
    const cp = campo.value.replace(/\D/g, "").slice(0, 5);
    if (campo.value !== cp) campo.value = cp;
    if (cp.length !== 5) {
      lista.hidden = true;
      lista.innerHTML = "";
      pedido = "";
      return;
    }
    if (cp === pedido) return;
    pedido = cp;
    lista.hidden = false;
    lista.innerHTML = "<p class=\"aviso-mini\">Buscando colonias de ese código postal.</p>";
    try {
      const data = await window.Medicalabs.api("/api/cp/" + cp);
      if (pedido !== cp) return;
      const lugares = data.lugares || [];
      const donde = [data.municipio, data.estado].filter(Boolean).join(", ");
      if (!lugares.length) {
        lista.innerHTML = "<p class=\"aviso-mini\">No encontré colonias para ese código. Escríbela a mano.</p>";
        return;
      }
      lista._lugares = lugares;
      lista.dataset.donde = donde;
      lista.innerHTML = "<p class=\"aviso-mini\">Municipio: " + escapeHtml(donde) + ". Elige la colonia.</p>" +
        lugares.map(function (lugar, indice) {
          return "<button type=\"button\" class=\"btn btn--ghost btn--sm\" data-lugar=\"" + indice + "\">" +
            escapeHtml(lugar.tipo || "Colonia") + " · " + escapeHtml(lugar.nombre) + "</button>";
        }).join("");
    } catch (err) {
      if (pedido !== cp) return;
      lista.innerHTML = "<p class=\"aviso-mini\">" + escapeHtml(err.message || "No pude consultar el código postal.") + "</p>";
    }
  });
  lista.addEventListener("click", function (event) {
    const boton = event.target.closest("[data-lugar]");
    if (!boton) return;
    const lugar = (lista._lugares || [])[Number(boton.getAttribute("data-lugar"))];
    if (!lugar) return;
    const colonia = document.querySelector("#colonia");
    const municipio = document.querySelector("#municipio");
    if (colonia) colonia.value = lugar.nombre;
    if (municipio) municipio.value = lista.dataset.donde || "";
    lista.querySelectorAll("button").forEach(function (otro) {
      otro.setAttribute("aria-pressed", otro === boton ? "true" : "false");
    });
  });
  }
})();
