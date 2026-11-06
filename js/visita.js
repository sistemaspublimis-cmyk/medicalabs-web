(function () {
  const form = document.querySelector("#visitaForm");
  const errorBox = document.querySelector("#visitaError");
  const okBox = document.querySelector("#visitaOk");
  const horario = document.querySelector("#bloqueHorario");
  const cuentaNueva = document.querySelector("#cuentaNueva");
  const sesionAviso = document.querySelector("#visitaSesion");
  const fecha = document.querySelector("#fecha");
  const turno = document.querySelector("#turno");
  const avisoHorario = document.querySelector("#avisoHorario");
  let ocupados = [];
  let usuario = null;

  function hoyMas(dias) {
    const fechaLocal = new Date();
    fechaLocal.setHours(12, 0, 0, 0);
    fechaLocal.setDate(fechaLocal.getDate() + dias);
    const mes = String(fechaLocal.getMonth() + 1).padStart(2, "0");
    const dia = String(fechaLocal.getDate()).padStart(2, "0");
    return fechaLocal.getFullYear() + "-" + mes + "-" + dia;
  }

  function esDomingo(valor) {
    const partes = valor.split("-");
    if (partes.length !== 3) return false;
    const dia = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
    return dia.getDay() === 0;
  }

  function modo() {
    const elegido = document.querySelector("input[name=modo]:checked");
    return elegido ? elegido.value : "visita";
  }

  function pintarModo() {
    const visita = modo() === "visita";
    horario.hidden = !visita;
    fecha.required = visita;
    turno.required = visita;
    revisarHorario();
  }

  function revisarHorario() {
    if (modo() !== "visita" || !fecha.value || !turno.value) {
      avisoHorario.textContent = "";
      return;
    }
    if (esDomingo(fecha.value)) {
      avisoHorario.textContent = "El domingo no hay visita.";
      return;
    }
    const tomado = ocupados.some(function (item) {
      return item.fecha === fecha.value && item.turno === turno.value;
    });
    avisoHorario.textContent = tomado ? "Ese horario ya está tomado. Elige otro." : "";
  }

  document.querySelectorAll("input[name=modo]").forEach(function (radio) {
    radio.addEventListener("change", pintarModo);
  });
  fecha.min = hoyMas(1);
  fecha.max = hoyMas(21);
  fecha.addEventListener("change", revisarHorario);
  turno.addEventListener("change", revisarHorario);

  window.Medicalabs.api("/api/visitas/ocupados").then(function (data) {
    ocupados = data.ocupados || [];
    revisarHorario();
  }).catch(function () {
    avisoHorario.textContent = "No pude cargar los horarios ocupados. Si eliges uno tomado, esta página te lo dice al enviar.";
  });

  window.Medicalabs.lista.then(function (user) {
    usuario = user;
    if (!user) {
      sesionAviso.textContent = "Al enviar se abre la cuenta con el correo y la contraseña de abajo.";
      return;
    }
    cuentaNueva.hidden = true;
    if (user.role === "owner") {
      sesionAviso.textContent = "Esta sesión es del dueño. La visita se pide con una cuenta de cliente.";
      return;
    }
    sesionAviso.textContent = "La pides como " + user.name + ". Si ya tienes una solicitud abierta, está en Mi cuenta.";
    const tel = document.querySelector("#telefono");
    if (tel && !tel.value && user.phone) tel.value = user.phone;
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    okBox.hidden = true;
    errorBox.hidden = true;
    const fallos = [];
    const negocio = document.querySelector("#negocio").value.trim();
    const tipo = document.querySelector("#tipo").value.trim();
    const telefono = document.querySelector("#telefono").value.replace(/\D/g, "");
    const calle = document.querySelector("#calle").value.trim();
    const colonia = document.querySelector("#colonia").value.trim();
    const municipio = document.querySelector("#municipio").value.trim();
    const lat = document.querySelector("#lat").value;
    const lng = document.querySelector("#lng").value;
    const texto = calle.length >= 4 && colonia.length >= 2 && municipio.length >= 2;
    if (negocio.length < 2) fallos.push("Escribe el nombre del negocio.");
    if (!tipo) fallos.push("Elige si es farmacia, tienda o negocio local.");
    if (telefono.length !== 10) fallos.push("El teléfono lleva 10 dígitos.");
    if (!texto && !(lat && lng)) fallos.push("Escribe la dirección o marca el punto en el mapa.");
    if (modo() === "visita") {
      if (!fecha.value) fallos.push("Elige el día.");
      else if (esDomingo(fecha.value)) fallos.push("El domingo no hay visita.");
      if (!turno.value) fallos.push("Elige mañana o tarde.");
      if (avisoHorario.textContent.indexOf("tomado") !== -1) fallos.push("Ese horario ya está tomado.");
    }
    if (!usuario) {
      const nombre = document.querySelector("#nombre").value.trim();
      const email = document.querySelector("#email").value.trim();
      const password = document.querySelector("#password").value;
      if (nombre.length < 3) fallos.push("Escribe tu nombre.");
      if (!email.includes("@")) fallos.push("Escribe un correo válido.");
      if (password.length < 8) fallos.push("La contraseña lleva al menos 8 caracteres.");
    }
    if (fallos.length) {
      errorBox.hidden = false;
      errorBox.innerHTML = fallos.map(function (f) { return "<li>" + window.Medicalabs.escapeHtml(f) + "</li>"; }).join("");
      errorBox.focus();
      return;
    }
    const boton = form.querySelector("[type=submit]");
    boton.disabled = true;
    try {
      const respuesta = await window.Medicalabs.api("/api/visitas", {
        modo: modo(),
        nombre: usuario ? usuario.name : document.querySelector("#nombre").value.trim(),
        email: usuario ? usuario.email : document.querySelector("#email").value.trim(),
        password: usuario ? "" : document.querySelector("#password").value,
        telefono: telefono,
        negocio: negocio,
        tipo: tipo,
        fecha: fecha.value,
        turno: turno.value,
        nota: document.querySelector("#nota").value.trim(),
        calle: calle,
        colonia: colonia,
        municipio: municipio,
        cp: document.querySelector("#cp").value.trim(),
        referencia: document.querySelector("#referencia").value.trim(),
        lat: lat || null,
        lng: lng || null
      });
      form.hidden = true;
      okBox.hidden = false;
      okBox.textContent = respuesta.modo === "contacto"
        ? "Quedó la solicitud de contacto y tu cuenta. Te contactamos al teléfono que dejaste."
        : "Quedó la visita en solicitado y tu cuenta. Te confirmamos el día y el turno.";
      okBox.focus();
    } catch (err) {
      errorBox.hidden = false;
      errorBox.innerHTML = "<li>" + window.Medicalabs.escapeHtml(err.message) + "</li>";
      errorBox.focus();
    } finally {
      boton.disabled = false;
    }
  });

  pintarModo();
})();
