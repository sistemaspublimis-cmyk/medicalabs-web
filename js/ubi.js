(function () {
  function valor(id) {
    const campo = document.querySelector("#" + id);
    return campo ? campo.value.trim() : "";
  }

  function campos() {
    return {
      negocio: valor("negocio"),
      tipo: valor("tipo"),
      telefono: valor("telefono").replace(/\D/g, ""),
      calle: valor("calle"),
      colonia: valor("colonia"),
      municipio: valor("municipio"),
      cp: valor("cp"),
      referencia: valor("referencia")
    };
  }

  function errorGeo(err) {
    if (!err) return "No se pudo leer la ubicación.";
    if (err.code === 1) return "El navegador no dio permiso de ubicación. Márcala con un clic en el mapa.";
    if (err.code === 2) return "No se pudo leer la ubicación. Márcala con un clic en el mapa.";
    if (err.code === 3) return "Tardó demasiado. Inténtalo otra vez o márcala con un clic.";
    return "No se pudo leer la ubicación. Márcala con un clic en el mapa.";
  }

  function leerPosicion() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error("Este navegador no comparte la ubicación. Márcala con un clic."));
        return;
      }
      navigator.geolocation.getCurrentPosition(function (pos) {
        resolve(pos.coords);
      }, function (err) {
        reject(new Error(errorGeo(err)));
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });
  }

  function texto() {
    const datos = campos();
    const lat = valor("lat");
    const lng = valor("lng");
    const cuenta = window.Medicalabs && window.Medicalabs.usuario;
    const lineas = ["Medicalabs"];
    if (datos.negocio) lineas.push("Negocio: " + datos.negocio);
    else if (cuenta && cuenta.name) lineas.push("Cuenta: " + cuenta.name);
    if (datos.tipo) lineas.push("Tipo: " + datos.tipo);
    if (datos.telefono) lineas.push("Teléfono: " + datos.telefono);
    else if (cuenta && cuenta.phone) lineas.push("Teléfono: " + cuenta.phone);
    const direccion = [datos.calle, datos.colonia, datos.municipio, datos.cp].filter(Boolean).join(", ");
    if (direccion) lineas.push("Dirección: " + direccion);
    if (datos.referencia) lineas.push("Referencia: " + datos.referencia);
    if (lat && lng) lineas.push("Ubicación: https://www.google.com/maps?q=" + lat + "," + lng);
    return lineas.join("\n");
  }

  async function publicar(lat, lng, accuracy, modo) {
    const cuenta = window.Medicalabs && window.Medicalabs.usuario;
    if (!cuenta || cuenta.role !== "client") {
      const error = new Error("Entra con la cuenta del negocio para que la ruta vea el punto.");
      error.status = 401;
      throw error;
    }
    return window.Medicalabs.api("/api/ubicacion", Object.assign({
      lat: lat,
      lng: lng,
      accuracy: accuracy,
      modo: modo
    }, campos()));
  }

  function vigilar(alPunto, alError) {
    if (!navigator.geolocation) {
      alError(new Error("Este navegador no comparte la ubicación. Márcala con un clic."));
      return function () {};
    }
    let ultimo = 0;
    let reloj = navigator.geolocation.watchPosition(function (pos) {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      alPunto(lat, lng, pos.coords.accuracy);
      const ahora = Date.now();
      if (ahora - ultimo < 8000) return;
      ultimo = ahora;
      publicar(lat, lng, pos.coords.accuracy, "vivo").catch(alError);
    }, function (err) {
      const error = new Error(errorGeo(err));
      error.geo = true;
      alError(error);
    }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
    return function parar() {
      if (reloj != null) navigator.geolocation.clearWatch(reloj);
      reloj = null;
      if (window.Medicalabs) window.Medicalabs.api("/api/ubicacion/parar", {}).catch(function () {});
    };
  }

  async function compartirTexto() {
    const plano = texto();
    if (navigator.share) {
      try {
        await navigator.share({ title: "Entrega Medicalabs", text: plano });
        return "enviado";
      } catch (err) {
        if (err && err.name === "AbortError") return "cancelado";
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(plano);
      return "copiado";
    }
    return plano;
  }

  function conectar(opts) {
    const usar = document.querySelector("#usarUbi");
    const vivo = document.querySelector("#vivoUbi");
    const compartirBtn = document.querySelector("#compartirDatos");
    const aviso = opts.aviso || function () {};
    const poner = opts.ponerPin || function () {};
    let detener = null;

    function apagarVivo(mensaje) {
      if (detener) {
        const parar = detener;
        detener = null;
        parar();
      }
      if (vivo) {
        vivo.textContent = "Compartir en tiempo real";
        vivo.setAttribute("aria-pressed", "false");
      }
      if (mensaje) aviso(mensaje);
    }

    if (usar) {
      usar.addEventListener("click", async function () {
        usar.disabled = true;
        aviso("Pidiendo permiso para leer la ubicación.");
        try {
          const coords = await leerPosicion();
          poner(coords.latitude, coords.longitude);
          try {
            await publicar(coords.latitude, coords.longitude, coords.accuracy, "punto");
            aviso("Punto marcado y enviado a la ruta, con los datos del negocio.");
          } catch (err) {
            aviso(err.status === 401
              ? "Punto marcado en el mapa. Entra con la cuenta del negocio para que la ruta lo vea."
              : (err.message || "El punto quedó en el mapa, pero no se pudo enviar."));
          }
        } catch (err) {
          aviso(err.message);
        } finally {
          usar.disabled = false;
        }
      });
    }

    if (vivo) {
      vivo.addEventListener("click", function () {
        if (detener) {
          apagarVivo("Se detuvo el envío. La ruta conserva el último punto y los datos.");
          return;
        }
        vivo.textContent = "Dejar de compartir";
        vivo.setAttribute("aria-pressed", "true");
        aviso("Compartiendo la ubicación mientras esta página sigue abierta. El negocio, el teléfono y la dirección van con cada punto.");
        detener = vigilar(function (lat, lng) {
          poner(lat, lng);
        }, function (err) {
          if (err.geo || err.status === 401) {
            apagarVivo(err.status === 401
              ? "Entra con la cuenta del negocio para compartir en tiempo real."
              : err.message);
            return;
          }
          aviso(err.message || "Un envío falló. Se sigue intentando.");
        });
      });
    }

    window.addEventListener("pagehide", function () {
      if (!detener) return;
      const parar = detener;
      detener = null;
      parar();
    });

    if (compartirBtn) {
      compartirBtn.addEventListener("click", async function () {
        try {
          const modo = await compartirTexto();
          if (modo === "cancelado") return;
          const lat = valor("lat");
          const lng = valor("lng");
          if (lat && lng) publicar(Number(lat), Number(lng), null, "punto").catch(function () {});
          if (modo === "copiado") aviso("Datos copiados. Ya los puedes pegar en un mensaje.");
          else if (modo === "enviado") aviso("Datos listos para enviar.");
          else aviso(modo);
        } catch (err) {
          aviso(err.message || "No se pudieron compartir los datos.");
        }
      });
    }

    return { apagar: apagarVivo };
  }

  window.MedicalabsUbi = { conectar: conectar, campos: campos, publicar: publicar };
})();
