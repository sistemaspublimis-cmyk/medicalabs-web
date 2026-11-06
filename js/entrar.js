(function () {
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  const token = params.get("recuperar");
  const aviso = document.querySelector("#authAviso");
  const errorBox = document.querySelector("#authError");
  const forms = {
    entrar: document.querySelector("#formEntrar"),
    registro: document.querySelector("#formRegistro"),
    olvido: document.querySelector("#formOlvido"),
    nueva: document.querySelector("#formNueva")
  };
  const tabs = {
    entrar: document.querySelector("#tabEntrar"),
    registro: document.querySelector("#tabRegistro"),
    olvido: document.querySelector("#tabOlvido")
  };

  function destino(user) {
    if (user && user.role === "owner") return "dueno.html";
    if (next === "pedido") return "pedido.html";
    return "cuenta.html";
  }

  function fallo(mensaje) {
    errorBox.hidden = false;
    errorBox.innerHTML = "<li>" + window.Medicalabs.escapeHtml(mensaje) + "</li>";
    errorBox.focus();
  }

  function limpio() {
    errorBox.hidden = true;
    errorBox.innerHTML = "";
    aviso.textContent = "";
  }

  function mostrar(cual) {
    Object.keys(forms).forEach(function (clave) {
      forms[clave].hidden = clave !== cual;
    });
    Object.keys(tabs).forEach(function (clave) {
      tabs[clave].setAttribute("aria-selected", clave === cual ? "true" : "false");
    });
    limpio();
  }

  Object.keys(tabs).forEach(function (clave) {
    tabs[clave].addEventListener("click", function () { mostrar(clave); });
  });

  if (token) {
    mostrar("nueva");
    document.querySelector(".pestanas").hidden = true;
  }

  window.Medicalabs.lista.then(function (user) {
    if (user && !token) location.href = destino(user);
  });

  forms.entrar.addEventListener("submit", async function (event) {
    event.preventDefault();
    limpio();
    try {
      const data = await window.Medicalabs.api("/api/entrar", {
        email: document.querySelector("#emailEntrar").value.trim(),
        password: document.querySelector("#claveEntrar").value
      });
      location.href = destino(data.user);
    } catch (err) {
      fallo(err.message);
    }
  });

  forms.olvido.addEventListener("submit", async function (event) {
    event.preventDefault();
    limpio();
    try {
      const data = await window.Medicalabs.api("/api/recuperar", {
        email: document.querySelector("#emailOlvido").value.trim()
      });
      aviso.textContent = "Si la cuenta existe, aquí aparece el enlace para restablecerla.";
      if (data.enlace) {
        const liga = document.createElement("a");
        liga.href = data.enlace;
        liga.textContent = data.enlace;
        aviso.appendChild(document.createTextNode(" "));
        aviso.appendChild(liga);
      }
    } catch (err) {
      fallo(err.message);
    }
  });

  forms.nueva.addEventListener("submit", async function (event) {
    event.preventDefault();
    limpio();
    const password = document.querySelector("#claveReset").value;
    if (password.length < 8) {
      fallo("La contraseña lleva al menos 8 caracteres.");
      return;
    }
    try {
      await window.Medicalabs.api("/api/restablecer", { token: token, password: password });
      aviso.textContent = "Contraseña actualizada. Ya puedes entrar.";
      document.querySelector(".pestanas").hidden = false;
      mostrar("entrar");
    } catch (err) {
      fallo(err.message);
    }
  });
})();
