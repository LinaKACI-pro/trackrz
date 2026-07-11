#!/usr/bin/env python3
"""Muscu Tracker — serveur Python zéro-dépendance (Raspberry Pi).

Structure :
  public/   le front (index.html, css/, js/, icônes) — servi en statique
  data/     les données (muscu-data.json + backup) — via l'API

API : GET /api/data   → lit data/muscu-data.json
      PUT /api/data   → l'écrit (atomique, avec backup de la version précédente)

Lancer :  python3 server.py        puis ouvrir http://<adresse>:8000

Variables d'env :
  PORT            port d'écoute (défaut 8000)
  HOST            adresse d'écoute (défaut 0.0.0.0 ; mettre 127.0.0.1 derrière un reverse proxy)
  MUSCU_PASSWORD  mot de passe de l'API. S'il est défini (ou si data/password.txt existe),
                  /api/data exige `Authorization: Bearer <mot de passe>`.
                  Non défini → pas d'auth (usage local / réseau privé Tailscale).
"""
import datetime, hmac, json, math, os, re, shutil, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT     = os.environ.get("TRACKRZ_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLIC   = os.path.join(ROOT, "public")
DATA_DIR = os.path.join(ROOT, "data")
DATA     = os.path.join(DATA_DIR, "muscu-data.json")
BACKUP   = os.path.join(DATA_DIR, "muscu-data.bak.json")
PW_FILE  = os.path.join(DATA_DIR, "password.txt")
PORT     = int(os.environ.get("PORT", "8000"))
HOST     = os.environ.get("HOST", "0.0.0.0")
EMPTY    = {"version": 1, "revision": 0, "exercises": [], "sessions": []}
MAX_BODY = 2 * 1024 * 1024
DATA_LOCK = threading.RLock()
AUTH_LOCK = threading.Lock()
AUTH_FAILURES = {}


class DataValidationError(ValueError):
    pass


class DataReadError(RuntimeError):
    pass


def load_password():
    pw = os.environ.get("MUSCU_PASSWORD", "").strip()
    if pw:
        return pw
    try:
        with open(PW_FILE, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
        ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json", ".ico": "image/x-icon"}
NO_CACHE = {".html", ".js", ".css", ".webmanifest"}   # toujours frais après une mise à jour


def migrate_layout():
    """Déplace les données de l'ancienne arborescence (fichiers à la racine) vers data/."""
    os.makedirs(DATA_DIR, exist_ok=True)
    for old, new in ((os.path.join(ROOT, "muscu-data.json"), DATA),
                     (os.path.join(ROOT, "muscu-data.bak.json"), BACKUP)):
        if os.path.exists(old) and not os.path.exists(new):
            shutil.move(old, new)


def _identifier(value, field):
    if not isinstance(value, str) or not 1 <= len(value) <= 128 or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise DataValidationError(f"{field} invalide")
    return value


def _text(value, field, maximum=120):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise DataValidationError(f"{field} invalide")
    return value.strip()


def _number(value, field, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise DataValidationError(f"{field} invalide")
    if value < minimum or value > maximum:
        raise DataValidationError(f"{field} hors limites")
    return value


def validate_data(obj):
    """Valide et normalise le document avant qu'il atteigne le disque ou le front."""
    if not isinstance(obj, dict):
        raise DataValidationError("document invalide")
    exercises = obj.get("exercises")
    sessions = obj.get("sessions")
    if not isinstance(exercises, list) or len(exercises) > 1000:
        raise DataValidationError("exercises invalide")
    if not isinstance(sessions, list) or len(sessions) > 10000:
        raise DataValidationError("sessions invalide")

    clean_exercises, exercise_ids = [], set()
    for exercise in exercises:
        if not isinstance(exercise, dict):
            raise DataValidationError("exercice invalide")
        exercise_id = _identifier(exercise.get("id"), "exercise.id")
        if exercise_id in exercise_ids:
            raise DataValidationError("exercise.id dupliqué")
        exercise_ids.add(exercise_id)
        exercise_type = exercise.get("type", "charge")
        if exercise_type not in ("charge", "pdc", "assistance"):
            raise DataValidationError("exercise.type invalide")
        clean_exercises.append({
            "id": exercise_id,
            "name": _text(exercise.get("name"), "exercise.name"),
            "group": _text(exercise.get("group", "Autre"), "exercise.group", 60),
            "type": exercise_type,
        })

    clean_sessions, session_ids = [], set()
    for session in sessions:
        if not isinstance(session, dict):
            raise DataValidationError("session invalide")
        session_id = _identifier(session.get("id"), "session.id")
        if session_id in session_ids:
            raise DataValidationError("session.id dupliqué")
        session_ids.add(session_id)
        date = session.get("date")
        try:
            datetime.date.fromisoformat(date)
        except (TypeError, ValueError):
            raise DataValidationError("session.date invalide") from None
        session_exercises = session.get("exos")
        if not isinstance(session_exercises, list) or len(session_exercises) > 100:
            raise DataValidationError("session.exos invalide")
        clean_session_exercises, seen_exercises = [], set()
        for session_exercise in session_exercises:
            if not isinstance(session_exercise, dict):
                raise DataValidationError("session.exo invalide")
            exercise_id = _identifier(session_exercise.get("exoId"), "session.exoId")
            if exercise_id in seen_exercises:
                raise DataValidationError("session.exoId dupliqué")
            seen_exercises.add(exercise_id)
            sets = session_exercise.get("sets")
            if not isinstance(sets, list) or not sets or len(sets) > 100:
                raise DataValidationError("session.sets invalide")
            clean_sets = []
            for item in sets:
                if not isinstance(item, dict):
                    raise DataValidationError("série invalide")
                clean_sets.append({
                    "reps": _number(item.get("reps"), "set.reps", 0.01, 10000),
                    "weight": _number(item.get("weight", 0), "set.weight", 0, 100000),
                })
            clean_session_exercises.append({"exoId": exercise_id, "sets": clean_sets})
        clean_sessions.append({"id": session_id, "date": date, "exos": clean_session_exercises})

    revision = obj.get("revision", 0)
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise DataValidationError("revision invalide")
    return {"version": 1, "revision": revision, "exercises": clean_exercises, "sessions": clean_sessions}


def _read_data_unlocked():
    found = False
    for path in (DATA, BACKUP):
        if not os.path.exists(path):
            continue
        found = True
        try:
            with open(path, encoding="utf-8") as f:
                return validate_data(json.load(f))
        except (OSError, json.JSONDecodeError, DataValidationError) as exc:
            print(f"Données invalides dans {path}: {exc}")
    if found:
        raise DataReadError("aucun fichier de données valide")
    return dict(EMPTY)


def read_data():
    with DATA_LOCK:
        return _read_data_unlocked()


def _write_data_unlocked(obj):
    # Ne remplace jamais un backup valide par un fichier principal corrompu.
    if os.path.exists(DATA):
        try:
            with open(DATA, encoding="utf-8") as f:
                validate_data(json.load(f))
            shutil.copy2(DATA, BACKUP)
        except (OSError, json.JSONDecodeError, DataValidationError):
            pass
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, DATA)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def write_data(obj):
    with DATA_LOCK:
        _write_data_unlocked(validate_data(obj))


def etag_for(obj):
    return f'"{obj.get("revision", 0)}"'


def conditional_write(obj, expected_revision):
    """Compare puis écrit sous le même verrou pour éviter deux écrivains gagnants."""
    with DATA_LOCK:
        current = _read_data_unlocked()
        if expected_revision is None:
            return "required", current
        if expected_revision != etag_for(current):
            return "conflict", current
        updated = dict(obj)
        updated["revision"] = current["revision"] + 1
        _write_data_unlocked(updated)
        return "ok", updated


class Handler(BaseHTTPRequestHandler):
    def _authorized(self):
        if not PASSWORD:                                    # pas de mot de passe configuré → API ouverte (local/VPN)
            return True
        client = self.client_address[0]
        now = time.monotonic()
        with AUTH_LOCK:
            failures, blocked_until = AUTH_FAILURES.get(client, (0, 0))
            if blocked_until > now:
                return False
        h = self.headers.get("Authorization", "")
        token = h[7:] if h.startswith("Bearer ") else ""
        if hmac.compare_digest(token, PASSWORD):            # comparaison à temps constant
            with AUTH_LOCK:
                AUTH_FAILURES.pop(client, None)
            return True
        with AUTH_LOCK:
            failures += 1
            delay = min(60, 2 ** max(0, failures - 5))
            AUTH_FAILURES[client] = (failures, now + delay)
        return False

    def _send(self, code, body=b"", ctype="application/json", no_cache=False, headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        if no_cache:
            self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            if not self._authorized():
                return self._send(401, b'{"error":"unauthorized"}', no_cache=True)
            try:
                data = read_data()
            except DataReadError:
                return self._send(500, b'{"error":"data unavailable"}', no_cache=True)
            return self._send(200, json.dumps(data, ensure_ascii=False).encode("utf-8"), no_cache=True,
                              headers={"ETag": etag_for(data)})
        if path == "/":
            path = "/index.html"
        safe = os.path.normpath(path).lstrip("/")           # anti path-traversal
        if os.path.basename(safe).startswith("."):
            return self._send(404, b'{"error":"not found"}')
        fp = os.path.realpath(os.path.join(PUBLIC, safe))
        if os.path.commonpath((PUBLIC, fp)) != PUBLIC or not os.path.isfile(fp):
            return self._send(404, b'{"error":"not found"}')
        with open(fp, "rb") as f:
            body = f.read()
        ext = os.path.splitext(fp)[1]
        return self._send(200, body, MIME.get(ext, "application/octet-stream"), no_cache=ext in NO_CACHE)

    def do_PUT(self):
        if urlparse(self.path).path != "/api/data":
            return self._send(404, b'{"error":"not found"}')
        if not self._authorized():
            return self._send(401, b'{"error":"unauthorized"}', no_cache=True)
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send(400, b'{"error":"invalid content length"}', no_cache=True)
        if n <= 0:
            return self._send(400, b'{"error":"empty body"}', no_cache=True)
        if n > MAX_BODY:
            return self._send(413, b'{"error":"payload too large"}', no_cache=True)
        raw = self.rfile.read(n)
        try:
            obj = json.loads(raw.decode("utf-8"))
            obj = validate_data(obj)
        except (UnicodeDecodeError, json.JSONDecodeError, DataValidationError) as exc:
            body = json.dumps({"error": "invalid data", "detail": str(exc)}, ensure_ascii=False).encode("utf-8")
            return self._send(400, body, no_cache=True)

        try:
            result, data = conditional_write(obj, self.headers.get("If-Match"))
        except DataReadError:
            return self._send(500, b'{"error":"data unavailable"}', no_cache=True)
        current_etag = etag_for(data)
        if result == "required":
            return self._send(428, b'{"error":"revision required"}', no_cache=True,
                              headers={"ETag": current_etag})
        if result == "conflict":
            body = json.dumps({"error": "conflict", "revision": data["revision"], "data": data},
                              ensure_ascii=False).encode("utf-8")
            return self._send(409, body, no_cache=True, headers={"ETag": current_etag})
        body = json.dumps({"ok": True, "revision": data["revision"]}).encode("utf-8")
        return self._send(200, body, no_cache=True, headers={"ETag": current_etag})

    def do_POST(self):     # alias (sendBeacon / keepalive)
        return self.do_PUT()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    migrate_layout()
    PASSWORD = load_password()
    print(f"Muscu Tracker → http://{HOST}:{PORT}   (Ctrl+C pour arrêter)")
    print("Auth API : " + ("activée 🔒" if PASSWORD else "désactivée (usage local/VPN)"))
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
else:
    PASSWORD = load_password()
