#!/usr/bin/env python3
"""Medicalabs local: cuentas, pedidos y envío. No es un servicio público."""

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "medicalabs.sqlite"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8214"))

OWNER_EMAIL = os.environ.get("MEDICALABS_OWNER_EMAIL", "dueno@medicalabs.local")
OWNER_PASSWORD = os.environ.get("MEDICALABS_OWNER_PASSWORD", "Medicalabs2026")
COOKIE = "medicalabs"
ORIGINS = {
    f"http://127.0.0.1:{PORT}",
    f"http://localhost:{PORT}",
    "http://127.0.0.1:8214",
    "http://localhost:8214",
}

def now():
    return datetime.now(timezone.utc)

def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()

def money(value):
    return round(float(value) + 1e-9, 2)

def load_product_list():
    text = (ROOT / "js" / "productos.js").read_text(encoding="utf-8")
    start = text.index("[")
    end = text.rindex("]")
    return json.loads(text[start : end + 1])

def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con

def hash_password(password, salt=None):
    if salt is None:
        salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return salt.hex() + ":" + digest.hex()

def verify_password(password, stored):
    try:
        salt_hex, digest_hex = stored.split(":")
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return hmac.compare_digest(digest.hex(), digest_hex)

def init_db():
    with connect() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              phone TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('client', 'owner')),
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id),
              expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS resets (
              token TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id),
              expires_at TEXT NOT NULL,
              used INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS orders (
              id INTEGER PRIMARY KEY,
              folio TEXT NOT NULL UNIQUE,
              user_id INTEGER NOT NULL REFERENCES users(id),
              negocio TEXT NOT NULL,
              tipo TEXT NOT NULL,
              telefono TEXT NOT NULL,
              nota TEXT NOT NULL DEFAULT '',
              calle TEXT NOT NULL DEFAULT '',
              colonia TEXT NOT NULL DEFAULT '',
              municipio TEXT NOT NULL DEFAULT '',
              cp TEXT NOT NULL DEFAULT '',
              referencia TEXT NOT NULL DEFAULT '',
              lat REAL,
              lng REAL,
              subtotal REAL NOT NULL,
              envio REAL NOT NULL,
              total REAL NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('recibido', 'en_ruta', 'entregado')),
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS order_items (
              id INTEGER PRIMARY KEY,
              order_id INTEGER NOT NULL REFERENCES orders(id),
              product_id TEXT NOT NULL,
              nombre TEXT NOT NULL,
              presentacion TEXT NOT NULL DEFAULT '',
              precio REAL NOT NULL,
              descuento INTEGER NOT NULL DEFAULT 0,
              qty INTEGER NOT NULL,
              importe REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS visits (
              id INTEGER PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id),
              negocio TEXT NOT NULL,
              tipo TEXT NOT NULL,
              telefono TEXT NOT NULL,
              modo TEXT NOT NULL CHECK(modo IN ('visita', 'contacto')),
              fecha TEXT NOT NULL DEFAULT '',
              turno TEXT NOT NULL CHECK(turno IN ('manana', 'tarde', 'contacto')),
              nota TEXT NOT NULL DEFAULT '',
              calle TEXT NOT NULL DEFAULT '',
              colonia TEXT NOT NULL DEFAULT '',
              municipio TEXT NOT NULL DEFAULT '',
              cp TEXT NOT NULL DEFAULT '',
              referencia TEXT NOT NULL DEFAULT '',
              lat REAL,
              lng REAL,
              status TEXT NOT NULL CHECK(status IN ('solicitada', 'confirmada', 'hecha', 'cancelada')),
              created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS visits_slot
              ON visits(fecha, turno)
              WHERE modo = 'visita' AND status != 'cancelada';
            CREATE TABLE IF NOT EXISTS live_shares (
              user_id INTEGER PRIMARY KEY REFERENCES users(id),
              negocio TEXT NOT NULL DEFAULT '',
              tipo TEXT NOT NULL DEFAULT '',
              telefono TEXT NOT NULL DEFAULT '',
              calle TEXT NOT NULL DEFAULT '',
              colonia TEXT NOT NULL DEFAULT '',
              municipio TEXT NOT NULL DEFAULT '',
              cp TEXT NOT NULL DEFAULT '',
              referencia TEXT NOT NULL DEFAULT '',
              lat REAL NOT NULL,
              lng REAL NOT NULL,
              accuracy REAL,
              modo TEXT NOT NULL CHECK(modo IN ('punto', 'vivo')),
              activo INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS catalog_items (
              id TEXT PRIMARY KEY,
              nombre TEXT NOT NULL,
              linea TEXT NOT NULL DEFAULT '',
              presentacion TEXT NOT NULL DEFAULT '',
              precio REAL,
              nota TEXT NOT NULL DEFAULT '',
              descuento INTEGER NOT NULL DEFAULT 0,
              banner TEXT NOT NULL DEFAULT '',
              imagen TEXT NOT NULL DEFAULT '',
              activo INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL
            );
            """
        )
        con.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('chatbot_enabled', '0')"
        )
        row = con.execute("SELECT id FROM users WHERE role = 'owner'").fetchone()
        if row is None:
            con.execute(
                "INSERT INTO users (email, name, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)",
                (OWNER_EMAIL.lower(), "Dueño Medicalabs", "", hash_password(OWNER_PASSWORD), iso(now())),
            )
        seed_catalog(con)

def seed_catalog(con):
    have = {row["id"] for row in con.execute("SELECT id FROM catalog_items")}
    stamp = iso(now())
    rows = []
    for item in load_product_list():
        if item.get("id") in have:
            continue
        precio = item.get("precio")
        rows.append(
            (
                item["id"],
                item.get("nombre") or "Pieza",
                item.get("linea") or "",
                item.get("presentacion") or "",
                None if precio is None else float(precio),
                item.get("nota") or "",
                int(item.get("descuento") or 0),
                item.get("banner") or "",
                item.get("imagen") or "",
                1,
                stamp,
            )
        )
    if rows:
        con.executemany(
            """
            INSERT INTO catalog_items (
              id, nombre, linea, presentacion, precio, nota, descuento, banner, imagen, activo, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )

CP_CACHE = {}

def lookup_cp(raw):
    cp = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(cp) != 5:
        raise ValueError("El código postal tiene 5 dígitos.")
    if cp in CP_CACHE:
        return CP_CACHE[cp]
    url = "https://postali.app/api/v1/mx/cp/" + cp
    req = urllib.request.Request(url, headers={"User-Agent": "Medicalabs", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            data = json.loads(res.read().decode())
    except urllib.error.HTTPError as err:
        if err.code == 404:
            raise ValueError("No encontré ese código postal.")
        raise ValueError("No pude consultar el código postal. Escríbelo a mano.")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ValueError("No pude consultar el código postal. Escríbelo a mano.")
    lugares = []
    for item in data.get("asentamientos") or []:
        nombre = str(item.get("nombre") or "").strip()
        if not nombre:
            continue
        lugares.append({"nombre": nombre, "tipo": str(item.get("tipo") or "Colonia").strip()})
    out = {
        "cp": cp,
        "estado": str(data.get("estado") or "").strip(),
        "municipio": str(data.get("municipio") or "").strip(),
        "lugares": lugares,
    }
    if not out["municipio"] and not lugares:
        raise ValueError("No encontré ese código postal.")
    CP_CACHE[cp] = out
    return out

def catalog_map():
    with connect() as con:
        rows = con.execute("SELECT * FROM catalog_items").fetchall()
    return {row["id"]: row for row in rows}

def public_product(row, owner=False):
    data = {
        "id": row["id"],
        "nombre": row["nombre"],
        "linea": row["linea"],
        "presentacion": row["presentacion"],
        "precio": row["precio"],
        "nota": row["nota"],
        "descuento": row["descuento"],
        "banner": row["banner"],
        "imagen": row["imagen"],
    }
    if owner:
        data["activo"] = bool(row["activo"])
    return data

def quote(lines):
    if not isinstance(lines, list):
        raise ValueError("El surtido no es válido.")
    products = catalog_map()
    detailed = []
    subtotal = 0.0
    for line in lines:
        if not isinstance(line, dict) or "id" not in line:
            raise ValueError("Hay una pieza que no está en la lista.")
        product = products.get(str(line["id"]))
        if not product or not product["activo"] or product["precio"] is None:
            raise ValueError("Hay una pieza sin precio de lista.")
        try:
            qty = int(line["qty"])
        except (TypeError, ValueError, KeyError):
            raise ValueError("La cantidad va de 1 a 99.")
        if qty < 1 or qty > 99:
            raise ValueError("La cantidad va de 1 a 99.")
        descuento = int(product.get("descuento") or 0)
        unit = money(float(product["precio"]) * (100 - descuento) / 100)
        importe = money(unit * qty)
        subtotal = money(subtotal + importe)
        detailed.append(
            {
                "product_id": product["id"],
                "nombre": product["nombre"],
                "presentacion": product.get("presentacion") or "",
                "precio": unit,
                "descuento": descuento,
                "qty": qty,
                "importe": importe,
            }
        )
    if not detailed:
        raise ValueError("Suma al menos una pieza con precio.")
    envio = 0.0
    return detailed, subtotal, envio, money(subtotal + envio)

def visita_cuando(fecha, turno):
    if turno not in ("manana", "tarde"):
        raise ValueError("Elige mañana o tarde.")
    try:
        dia = datetime.strptime(str(fecha or ""), "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Elige un día válido.")
    hoy = date.today()
    if dia <= hoy or (dia - hoy).days > 21:
        raise ValueError("La visita se agenda entre mañana y 21 días.")
    if dia.weekday() == 6:
        raise ValueError("El domingo no hay visita.")
    return dia.isoformat(), turno

def clip(value, limit=180):
    return str(value or "").strip()[:limit]

def digits(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())[:10]

def coords_mx(lat, lng):
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        raise ValueError("El punto del mapa no es válido.")
    if not (14.0 <= lat_f <= 33.0 and -118.5 <= lng_f <= -86.0):
        raise ValueError("El punto tiene que caer en México.")
    return lat_f, lng_f

def accuracy_ok(value):
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0 or number > 100000:
        return None
    return number

def address_ok(data):
    calle = (data.get("calle") or "").strip()
    colonia = (data.get("colonia") or "").strip()
    municipio = (data.get("municipio") or "").strip()
    texto = len(calle) >= 4 and len(colonia) >= 2 and len(municipio) >= 2
    lat = data.get("lat")
    lng = data.get("lng")
    lat_f = lng_f = None
    if lat not in (None, "") or lng not in (None, ""):
        lat_f, lng_f = coords_mx(lat, lng)
    if not texto and lat_f is None:
        raise ValueError("Escribe la dirección o marca el punto en el mapa.")
    return lat_f, lng_f

def save_share(con, user_row, data, lat_f, lng_f, modo, accuracy=None, keep_live=False):
    if lat_f is None or lng_f is None:
        return
    prev = con.execute("SELECT * FROM live_shares WHERE user_id = ?", (user_row["id"],)).fetchone()
    negocio = clip(data.get("negocio")) or (prev["negocio"] if prev else "")
    tipo = clip(data.get("tipo"), 40) or (prev["tipo"] if prev else "")
    telefono = digits(data.get("telefono")) or (prev["telefono"] if prev else "") or (user_row["phone"] or "")
    calle = clip(data.get("calle")) or (prev["calle"] if prev else "")
    colonia = clip(data.get("colonia")) or (prev["colonia"] if prev else "")
    municipio = clip(data.get("municipio")) or (prev["municipio"] if prev else "")
    cp = clip(data.get("cp"), 12) or (prev["cp"] if prev else "")
    referencia = clip(data.get("referencia")) or (prev["referencia"] if prev else "")
    if keep_live and prev and prev["activo"] == 1 and prev["modo"] == "vivo":
        modo = "vivo"
        activo = 1
    else:
        activo = 1 if modo == "vivo" else 0
    con.execute(
        """
        INSERT INTO live_shares (
          user_id, negocio, tipo, telefono, calle, colonia, municipio, cp, referencia,
          lat, lng, accuracy, modo, activo, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          negocio = excluded.negocio,
          tipo = excluded.tipo,
          telefono = excluded.telefono,
          calle = excluded.calle,
          colonia = excluded.colonia,
          municipio = excluded.municipio,
          cp = excluded.cp,
          referencia = excluded.referencia,
          lat = excluded.lat,
          lng = excluded.lng,
          accuracy = excluded.accuracy,
          modo = excluded.modo,
          activo = excluded.activo,
          updated_at = excluded.updated_at
        """,
        (
            user_row["id"], negocio, tipo, telefono, calle, colonia, municipio, cp, referencia,
            lat_f, lng_f, accuracy, modo, activo, iso(now()),
        ),
    )

def share_public(row):
    return {
        "user_id": row["user_id"],
        "cliente": row["cliente"] if "cliente" in row.keys() else "",
        "email": row["email"] if "email" in row.keys() else "",
        "negocio": row["negocio"],
        "tipo": row["tipo"],
        "telefono": row["telefono"],
        "calle": row["calle"],
        "colonia": row["colonia"],
        "municipio": row["municipio"],
        "cp": row["cp"],
        "referencia": row["referencia"],
        "lat": row["lat"],
        "lng": row["lng"],
        "accuracy": row["accuracy"],
        "modo": row["modo"],
        "activo": row["activo"],
        "updated_at": row["updated_at"],
    }

class App(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def user(self):
        token = ""
        raw = self.headers.get("Cookie") or ""
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE:
                token = value
        if not token:
            return None
        with connect() as con:
            row = con.execute(
                """
                SELECT u.* FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = ? AND s.expires_at > ?
                """,
                (token, iso(now())),
            ).fetchone()
        return row

    def send_json(self, code, payload, cookie=None, clear=False):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", f"{COOKIE}={cookie}{self.cookie_flags(1209600)}")
        if clear:
            self.send_header("Set-Cookie", f"{COOKIE}={self.cookie_flags(0)}")
        self.end_headers()
        self.wfile.write(body)

    def cookie_flags(self, max_age):
        proto = (self.headers.get("X-Forwarded-Proto") or "http").split(",")[0].strip().lower()
        secure = "; Secure" if proto == "https" else ""
        return f"; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{secure}"

    def origin_allowed(self):
        origin = self.headers.get("Origin")
        if not origin or origin in ORIGINS:
            return True
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").split(",")[0].strip()
        proto = (self.headers.get("X-Forwarded-Proto") or "http").split(",")[0].strip().lower()
        return bool(host) and origin == f"{proto}://{host}"

    def read_json(self):
        if not self.origin_allowed():
            raise PermissionError("origen")
        length = int(self.headers.get("Content-Length") or 0)
        if length > 100_000:
            raise ValueError("El pedido es demasiado grande.")
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("JSON inválido")
        return data

    def open_session(self, user_id):
        token = secrets.token_urlsafe(32)
        with connect() as con:
            con.execute(
                "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
                (token, user_id, iso(now() + timedelta(days=14))),
            )
        return token

    def public_user(self, row):
        return {"id": row["id"], "email": row["email"], "name": row["name"], "phone": row["phone"], "role": row["role"]}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            try:
                self.api_get(parsed)
            except PermissionError:
                self.send_json(403, {"error": "No tienes acceso."})
            except ValueError as err:
                self.send_json(400, {"error": str(err)})
            return
        self.file(parsed.path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(404)
            return
        try:
            data = self.read_json()
            self.api_post(parsed.path, data)
        except PermissionError:
            self.send_json(403, {"error": "No tienes acceso."})
        except ValueError as err:
            self.send_json(400, {"error": str(err)})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "No se entendió el pedido."})

    def api_get(self, parsed):
        path = parsed.path
        if path == "/api/yo":
            row = self.user()
            self.send_json(200, {"user": self.public_user(row) if row else None})
            return
        if path.startswith("/api/cp/"):
            self.send_json(200, lookup_cp(path[len("/api/cp/"):]))
            return
        if path == "/api/productos":
            with connect() as con:
                rows = con.execute(
                    "SELECT * FROM catalog_items WHERE activo = 1 ORDER BY nombre COLLATE NOCASE"
                ).fetchall()
            self.send_json(200, {"productos": [public_product(row) for row in rows]})
            return
        if path == "/api/dueno/productos":
            self.require_owner()
            with connect() as con:
                rows = con.execute(
                    "SELECT * FROM catalog_items ORDER BY nombre COLLATE NOCASE"
                ).fetchall()
            self.send_json(200, {"productos": [public_product(row, owner=True) for row in rows]})
            return
        if path == "/api/chat/status":
            with connect() as con:
                flag = con.execute("SELECT value FROM settings WHERE key = 'chatbot_enabled'").fetchone()
            self.send_json(200, {"enabled": bool(flag and flag["value"] == "1")})
            return
        if path == "/api/geo":
            query = urllib.parse.parse_qs(parsed.query).get("q", [""])[0].strip()
            if len(query) < 4:
                self.send_json(400, {"error": "Escribe una dirección más completa."})
                return
            url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                {"q": query + ", México", "format": "json", "limit": "1", "countrycodes": "mx"}
            )
            req = urllib.request.Request(url, headers={"User-Agent": "MedicalabsLocal/1.0"})
            try:
                with urllib.request.urlopen(req, timeout=8) as res:
                    found = json.loads(res.read().decode("utf-8"))
            except Exception:
                self.send_json(502, {"error": "El mapa no pudo buscar esa dirección. Márcala con un clic."})
                return
            if not found:
                self.send_json(404, {"error": "No encontré ese punto. Márcalo en el mapa."})
                return
            self.send_json(200, {"lat": float(found[0]["lat"]), "lng": float(found[0]["lon"]), "nombre": found[0].get("display_name", "")})
            return
        if path == "/api/visitas/ocupados":
            with connect() as con:
                rows = con.execute(
                    "SELECT fecha, turno FROM visits WHERE modo = 'visita' AND status != 'cancelada'"
                ).fetchall()
            self.send_json(200, {"ocupados": [{"fecha": row["fecha"], "turno": row["turno"]} for row in rows]})
            return
        if path == "/api/mis-visitas":
            row = self.user()
            if not row or row["role"] != "client":
                self.send_json(401, {"error": "Entra con tu cuenta."})
                return
            self.send_json(200, {"visitas": self.visits_for(row["id"])})
            return
        if path == "/api/dueno/visitas":
            self.require_owner()
            self.send_json(200, {"visitas": self.visits_for(None)})
            return
        if path == "/api/mis-compras":
            row = self.user()
            if not row or row["role"] != "client":
                self.send_json(401, {"error": "Entra con tu cuenta."})
                return
            self.send_json(200, {"pedidos": self.orders_for(row["id"])})
            return
        if path == "/api/dueno/pedidos":
            self.require_owner()
            self.send_json(200, {"pedidos": self.orders_for(None)})
            return
        if path == "/api/mi-ubicacion":
            row = self.user()
            if not row or row["role"] != "client":
                self.send_json(401, {"error": "Entra con tu cuenta."})
                return
            with connect() as con:
                prev = con.execute(
                    """
                    SELECT s.*, u.name AS cliente, u.email
                    FROM live_shares s JOIN users u ON u.id = s.user_id
                    WHERE s.user_id = ?
                    """,
                    (row["id"],),
                ).fetchone()
            self.send_json(200, {"ubicacion": share_public(prev) if prev else None})
            return
        if path == "/api/dueno/ubicaciones":
            self.require_owner()
            corte = iso(now() - timedelta(hours=24))
            with connect() as con:
                rows = con.execute(
                    """
                    SELECT s.*, u.name AS cliente, u.email
                    FROM live_shares s JOIN users u ON u.id = s.user_id
                    WHERE s.updated_at >= ?
                    ORDER BY s.activo DESC, s.updated_at DESC
                    """,
                    (corte,),
                ).fetchall()
            self.send_json(200, {"ubicaciones": [share_public(row) for row in rows]})
            return
        if path == "/api/dueno/clientes":
            self.require_owner()
            with connect() as con:
                clients = con.execute(
                    "SELECT id, name, email, phone, created_at FROM users WHERE role = 'client' ORDER BY id DESC"
                ).fetchall()
                out = []
                for client in clients:
                    items = con.execute(
                        """
                        SELECT oi.nombre, oi.qty, o.folio, o.created_at
                        FROM order_items oi JOIN orders o ON o.id = oi.order_id
                        WHERE o.user_id = ? ORDER BY o.id DESC
                        """,
                        (client["id"],),
                    ).fetchall()
                    out.append({**dict(client), "compras": [dict(item) for item in items]})
            self.send_json(200, {"clientes": out})
            return
        self.send_json(404, {"error": "No existe."})

    def require_owner(self):
        row = self.user()
        if not row or row["role"] != "owner":
            raise PermissionError("owner")
        return row

    def orders_for(self, user_id):
        sql = "SELECT o.*, u.name AS cliente, u.email FROM orders o JOIN users u ON u.id = o.user_id"
        args = ()
        if user_id is not None:
            sql += " WHERE o.user_id = ?"
            args = (user_id,)
        sql += " ORDER BY o.id DESC"
        with connect() as con:
            orders = con.execute(sql, args).fetchall()
            result = []
            for order in orders:
                items = con.execute(
                    "SELECT nombre, presentacion, precio, descuento, qty, importe FROM order_items WHERE order_id = ?",
                    (order["id"],),
                ).fetchall()
                result.append({**dict(order), "piezas": [dict(item) for item in items]})
        return result

    def api_post(self, path, data):
        if path == "/api/registro":
            self.registro(data)
            return
        if path == "/api/entrar":
            self.entrar(data)
            return
        if path == "/api/salir":
            token = ""
            raw = self.headers.get("Cookie") or ""
            for part in raw.split(";"):
                name, _, value = part.strip().partition("=")
                if name == COOKIE:
                    token = value
            if token:
                with connect() as con:
                    con.execute("DELETE FROM sessions WHERE token = ?", (token,))
            self.send_json(200, {"ok": True}, clear=True)
            return
        if path == "/api/recuperar":
            email = (data.get("email") or "").strip().lower()
            with connect() as con:
                user = con.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
                if not user:
                    self.send_json(200, {"ok": True, "enlace": None})
                    return
                token = secrets.token_urlsafe(24)
                con.execute(
                    "INSERT INTO resets (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)",
                    (token, user["id"], iso(now() + timedelta(hours=2))),
                )
            self.send_json(200, {"ok": True, "enlace": f"/entrar.html?recuperar={token}", "nota": "El correo no está conectado. El enlace solo aparece aquí."})
            return
        if path == "/api/restablecer":
            token = (data.get("token") or "").strip()
            password = data.get("password") or ""
            if len(password) < 8:
                raise ValueError("La contraseña nueva lleva al menos 8 caracteres.")
            with connect() as con:
                row = con.execute(
                    "SELECT * FROM resets WHERE token = ? AND used = 0 AND expires_at > ?",
                    (token, iso(now())),
                ).fetchone()
                if not row:
                    raise ValueError("Ese enlace ya no sirve.")
                con.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["user_id"]))
                con.execute("UPDATE resets SET used = 1 WHERE token = ?", (token,))
                con.execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))
            self.send_json(200, {"ok": True})
            return
        if path == "/api/visitas":
            self.crear_visita(data)
            return
        if path == "/api/visitas/cancelar":
            self.cancelar_visita(data)
            return
        if path == "/api/pedidos":
            self.crear_pedido(data)
            return
        if path == "/api/ubicacion":
            self.publicar_ubicacion(data)
            return
        if path == "/api/ubicacion/parar":
            self.parar_ubicacion()
            return
        if path == "/api/dueno/visita":
            self.require_owner()
            status = data.get("status")
            if status not in ("solicitada", "confirmada", "hecha", "cancelada"):
                raise ValueError("Estado no válido.")
            with connect() as con:
                cur = con.execute(
                    "UPDATE visits SET status = ? WHERE id = ?",
                    (status, int(data.get("id") or 0)),
                )
                if cur.rowcount != 1:
                    raise ValueError("No encontré esa visita.")
            self.send_json(200, {"ok": True})
            return
        if path == "/api/chat":
            with connect() as con:
                flag = con.execute("SELECT value FROM settings WHERE key = 'chatbot_enabled'").fetchone()
            if not flag or flag["value"] != "1":
                self.send_json(200, {"enabled": False, "reply": ""})
                return
            self.send_json(200, {"enabled": True, "reply": "El asistente local está encendido, pero no hay un modelo conectado en esta copia."})
            return
        if path == "/api/dueno/estado":
            self.require_owner()
            status = data.get("status")
            if status not in ("recibido", "en_ruta", "entregado"):
                raise ValueError("Estado no válido.")
            with connect() as con:
                cur = con.execute("UPDATE orders SET status = ? WHERE id = ?", (status, int(data.get("id") or 0)))
                if cur.rowcount != 1:
                    raise ValueError("No encontré ese pedido.")
            self.send_json(200, {"ok": True})
            return
        if path == "/api/dueno/producto":
            self.require_owner()
            self.guardar_producto(data)
            return
        if path == "/api/dueno/chat":
            self.require_owner()
            value = "1" if data.get("enabled") else "0"
            with connect() as con:
                con.execute("UPDATE settings SET value = ? WHERE key = 'chatbot_enabled'", (value,))
            self.send_json(200, {"enabled": value == "1"})
            return
        self.send_json(404, {"error": "No existe."})

    def visits_for(self, user_id):
        sql = """
            SELECT v.*, u.name AS cliente, u.email
            FROM visits v JOIN users u ON u.id = v.user_id
        """
        args = []
        if user_id is not None:
            sql += " WHERE v.user_id = ?"
            args.append(user_id)
        sql += " ORDER BY v.id DESC"
        with connect() as con:
            rows = con.execute(sql, args).fetchall()
        out = []
        for row in rows:
            out.append({
                "id": row["id"],
                "negocio": row["negocio"],
                "tipo": row["tipo"],
                "telefono": row["telefono"],
                "modo": row["modo"],
                "fecha": row["fecha"],
                "turno": row["turno"],
                "nota": row["nota"],
                "calle": row["calle"],
                "colonia": row["colonia"],
                "municipio": row["municipio"],
                "cp": row["cp"],
                "referencia": row["referencia"],
                "lat": row["lat"],
                "lng": row["lng"],
                "status": row["status"],
                "created_at": row["created_at"],
                "cliente": row["cliente"],
                "email": row["email"],
            })
        return out

    def crear_visita(self, data):
        modo = data.get("modo")
        if modo not in ("visita", "contacto"):
            raise ValueError("Elige si agendas la visita o si quieres que te contacten.")
        nombre = (data.get("nombre") or "").strip()
        email = (data.get("email") or "").strip().lower()
        phone = "".join(ch for ch in str(data.get("telefono") or "") if ch.isdigit())
        negocio = (data.get("negocio") or "").strip()
        tipo = (data.get("tipo") or "").strip()
        nota = (data.get("nota") or "").strip()
        if len(negocio) < 2:
            raise ValueError("Escribe el nombre del negocio.")
        if tipo not in ("Farmacia", "Tienda", "Negocio local"):
            raise ValueError("Elige si es farmacia, tienda o negocio local.")
        if len(phone) != 10:
            raise ValueError("El teléfono lleva 10 dígitos.")
        lat_f, lng_f = address_ok(data)
        if modo == "visita":
            fecha, turno = visita_cuando(data.get("fecha"), data.get("turno"))
        else:
            fecha, turno = "", "contacto"
        row = self.user()
        if row and row["role"] == "owner":
            raise ValueError("La visita se pide con una cuenta de cliente.")
        new_id = None
        with connect() as con:
            if row is None:
                if len(nombre) < 3:
                    raise ValueError("Escribe tu nombre.")
                if "@" not in email or "." not in email.split("@")[-1]:
                    raise ValueError("Escribe un correo válido.")
                password = data.get("password") or ""
                if len(password) < 8:
                    raise ValueError("La contraseña lleva al menos 8 caracteres.")
                try:
                    cur = con.execute(
                        "INSERT INTO users (email, name, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'client', ?)",
                        (email, nombre, phone, hash_password(password), iso(now())),
                    )
                except sqlite3.IntegrityError:
                    raise ValueError("Ese correo ya tiene cuenta. Entra y agenda desde ahí.")
                user_id = cur.lastrowid
                new_id = user_id
            else:
                user_id = row["id"]
            activa = con.execute(
                "SELECT 1 FROM visits WHERE user_id = ? AND status IN ('solicitada', 'confirmada')",
                (user_id,),
            ).fetchone()
            if activa:
                raise ValueError("Ya tienes una solicitud abierta. La ves en Mi cuenta.")
            try:
                con.execute(
                    """
                    INSERT INTO visits (
                      user_id, negocio, tipo, telefono, modo, fecha, turno, nota,
                      calle, colonia, municipio, cp, referencia, lat, lng, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'solicitada', ?)
                    """,
                    (
                        user_id, negocio, tipo, phone, modo, fecha, turno, nota,
                        (data.get("calle") or "").strip(),
                        (data.get("colonia") or "").strip(),
                        (data.get("municipio") or "").strip(),
                        (data.get("cp") or "").strip(),
                        (data.get("referencia") or "").strip(),
                        lat_f, lng_f, iso(now()),
                    ),
                )
            except sqlite3.IntegrityError:
                raise ValueError("Ese horario ya está tomado. Elige otro día o turno.")
            quien = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            save_share(con, quien, data, lat_f, lng_f, "punto", keep_live=True)
        cookie = self.open_session(new_id) if new_id else None
        self.send_json(200, {"ok": True, "modo": modo}, cookie=cookie)

    def cancelar_visita(self, data):
        row = self.user()
        if not row or row["role"] != "client":
            self.send_json(401, {"error": "Entra con tu cuenta de cliente."})
            return
        with connect() as con:
            cur = con.execute(
                "UPDATE visits SET status = 'cancelada' WHERE id = ? AND user_id = ? AND status = 'solicitada'",
                (int(data.get("id") or 0), row["id"]),
            )
            if cur.rowcount != 1:
                raise ValueError("Esa visita ya no se puede cancelar.")
        self.send_json(200, {"ok": True})

    def registro(self, data):
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        phone = "".join(ch for ch in str(data.get("phone") or "") if ch.isdigit())
        password = data.get("password") or ""
        if len(name) < 3:
            raise ValueError("Escribe tu nombre.")
        if "@" not in email or "." not in email.split("@")[-1]:
            raise ValueError("Escribe un correo válido.")
        if len(phone) != 10:
            raise ValueError("El teléfono lleva 10 dígitos.")
        if len(password) < 8:
            raise ValueError("La contraseña lleva al menos 8 caracteres.")
        try:
            with connect() as con:
                cur = con.execute(
                    "INSERT INTO users (email, name, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'client', ?)",
                    (email, name, phone, hash_password(password), iso(now())),
                )
                user_id = cur.lastrowid
        except sqlite3.IntegrityError:
            raise ValueError("Ese correo ya tiene cuenta.")
        self.send_json(200, {"ok": True}, cookie=self.open_session(user_id))

    def entrar(self, data):
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        with connect() as con:
            row = con.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            self.send_json(401, {"error": "Correo o contraseña incorrectos."})
            return
        self.send_json(200, {"user": self.public_user(row)}, cookie=self.open_session(row["id"]))

    def crear_pedido(self, data):
        row = self.user()
        if not row or row["role"] != "client":
            self.send_json(401, {"error": "Entra con tu cuenta de cliente para confirmar."})
            return
        negocio = (data.get("negocio") or "").strip()
        tipo = (data.get("tipo") or "").strip()
        telefono = "".join(ch for ch in str(data.get("telefono") or "") if ch.isdigit())
        if len(negocio) < 2:
            raise ValueError("Escribe el nombre del negocio.")
        if tipo not in ("Farmacia", "Tienda", "Negocio local"):
            raise ValueError("Elige si es farmacia, tienda o negocio local.")
        if len(telefono) != 10:
            raise ValueError("El teléfono lleva 10 dígitos.")
        lat_f, lng_f = address_ok(data)
        lines = data.get("piezas") or []
        if not isinstance(lines, list):
            raise ValueError("El surtido no es válido.")
        detailed, subtotal, envio, total = quote(lines)
        folio = ""
        with connect() as con:
            for _ in range(8):
                folio = "MED-2026-" + str(secrets.randbelow(9000) + 1000)
                exists = con.execute("SELECT 1 FROM orders WHERE folio = ?", (folio,)).fetchone()
                if not exists:
                    break
            cur = con.execute(
                """
                INSERT INTO orders (
                  folio, user_id, negocio, tipo, telefono, nota, calle, colonia, municipio, cp, referencia,
                  lat, lng, subtotal, envio, total, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recibido', ?)
                """,
                (
                    folio,
                    row["id"],
                    negocio,
                    tipo,
                    telefono,
                    (data.get("nota") or "").strip(),
                    (data.get("calle") or "").strip(),
                    (data.get("colonia") or "").strip(),
                    (data.get("municipio") or "").strip(),
                    (data.get("cp") or "").strip(),
                    (data.get("referencia") or "").strip(),
                    lat_f,
                    lng_f,
                    subtotal,
                    envio,
                    total,
                    iso(now()),
                ),
            )
            order_id = cur.lastrowid
            con.executemany(
                """
                INSERT INTO order_items (order_id, product_id, nombre, presentacion, precio, descuento, qty, importe)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (order_id, item["product_id"], item["nombre"], item["presentacion"], item["precio"], item["descuento"], item["qty"], item["importe"])
                    for item in detailed
                ],
            )
            save_share(con, row, data, lat_f, lng_f, "punto", keep_live=True)
        self.send_json(200, {"folio": folio, "subtotal": subtotal, "envio": envio, "total": total, "piezas": detailed})

    def publicar_ubicacion(self, data):
        row = self.user()
        if not row or row["role"] != "client":
            self.send_json(401, {"error": "Entra con tu cuenta de cliente para compartir la ubicación."})
            return
        modo = data.get("modo")
        if modo not in ("punto", "vivo"):
            raise ValueError("El modo de ubicación no es válido.")
        lat_f, lng_f = coords_mx(data.get("lat"), data.get("lng"))
        accuracy = accuracy_ok(data.get("accuracy"))
        with connect() as con:
            prev = con.execute(
                "SELECT updated_at FROM live_shares WHERE user_id = ?",
                (row["id"],),
            ).fetchone()
            if prev and modo == "vivo":
                try:
                    previo = datetime.fromisoformat(prev["updated_at"])
                except ValueError:
                    previo = None
                if previo and (now() - previo).total_seconds() < 3:
                    self.send_json(200, {"ok": True})
                    return
            save_share(con, row, data, lat_f, lng_f, modo, accuracy)
        self.send_json(200, {"ok": True})

    def parar_ubicacion(self):
        row = self.user()
        if not row or row["role"] != "client":
            self.send_json(401, {"error": "Entra con tu cuenta de cliente para compartir la ubicación."})
            return
        with connect() as con:
            con.execute(
                "UPDATE live_shares SET activo = 0, updated_at = ? WHERE user_id = ?",
                (iso(now()), row["id"]),
            )
        self.send_json(200, {"ok": True})

    def guardar_producto(self, data):
        nombre = clip(data.get("nombre"), 180)
        linea = clip(data.get("linea"), 80)
        presentacion = clip(data.get("presentacion"), 80)
        nota = clip(data.get("nota"), 240)
        if len(nombre) < 2:
            raise ValueError("Escribe el nombre de la pieza.")
        try:
            descuento = int(data.get("descuento") or 0)
        except (TypeError, ValueError):
            raise ValueError("El descuento va de 0 a 90.")
        if descuento < 0 or descuento > 90:
            raise ValueError("El descuento va de 0 a 90.")
        raw_precio = data.get("precio")
        precio = None
        if raw_precio not in (None, ""):
            try:
                precio = money(float(raw_precio))
            except (TypeError, ValueError):
                raise ValueError("El precio no es válido.")
            if precio < 0 or precio > 100000:
                raise ValueError("El precio no es válido.")
        banner = clip(data.get("banner"), 80)
        if descuento and not banner:
            banner = str(descuento) + "% en el pedido"
        if not descuento:
            banner = ""
        activo = 1 if data.get("activo", True) else 0
        pieza_id = clip(data.get("id"), 24)
        with connect() as con:
            if pieza_id:
                prev = con.execute("SELECT imagen FROM catalog_items WHERE id = ?", (pieza_id,)).fetchone()
                if not prev:
                    raise ValueError("No encontré esa pieza.")
                imagen = prev["imagen"] or ""
                con.execute(
                    """
                    UPDATE catalog_items
                    SET nombre = ?, linea = ?, presentacion = ?, precio = ?, nota = ?,
                        descuento = ?, banner = ?, imagen = ?, activo = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (nombre, linea, presentacion, precio, nota, descuento, banner, imagen, activo, iso(now()), pieza_id),
                )
            else:
                nums = []
                for row in con.execute("SELECT id FROM catalog_items"):
                    tail = row["id"][1:]
                    if row["id"].startswith("p") and tail.isdigit():
                        nums.append(int(tail))
                pieza_id = "p" + str((max(nums) if nums else 0) + 1).zfill(3)
                con.execute(
                    """
                    INSERT INTO catalog_items (
                      id, nombre, linea, presentacion, precio, nota, descuento, banner, imagen, activo, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
                    """,
                    (pieza_id, nombre, linea, presentacion, precio, nota, descuento, banner, activo, iso(now())),
                )
            saved = con.execute("SELECT * FROM catalog_items WHERE id = ?", (pieza_id,)).fetchone()
        self.send_json(200, {"producto": public_product(saved, owner=True)})

    def file(self, path):
        rel = urllib.parse.unquote(path.split("?", 1)[0])
        if rel in ("", "/"):
            rel = "/index.html"
        target = (ROOT / rel.lstrip("/")).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if not target.is_file() or "data" in target.parts or target.suffix in {".py", ".sqlite", ".command"}:
            self.send_error(404)
            return
        kind = "application/octet-stream"
        if target.suffix == ".html":
            kind = "text/html; charset=utf-8"
        elif target.suffix == ".css":
            kind = "text/css; charset=utf-8"
        elif target.suffix == ".js":
            kind = "text/javascript; charset=utf-8"
        elif target.suffix == ".svg":
            kind = "image/svg+xml"
        elif target.suffix in (".jpg", ".jpeg"):
            kind = "image/jpeg"
        elif target.suffix == ".png":
            kind = "image/png"
        elif target.suffix == ".webp":
            kind = "image/webp"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

if __name__ == "__main__":
    init_db()
    print(f"Medicalabs en http://{HOST}:{PORT}/", flush=True)
    ThreadingHTTPServer((HOST, PORT), App).serve_forever()
