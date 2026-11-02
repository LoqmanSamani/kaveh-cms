#!/usr/bin/env python3
"""Kaveh CMS – web server.

A plain WSGI application that only needs the Python standard library (3.9+).

  python app.py                       start the server (default http://0.0.0.0:8000)
  python app.py create-user NAME [--admin]
  python app.py set-password NAME
  python app.py list-users

Any WSGI host (waitress, gunicorn, PythonAnywhere, ...) can serve `app.application`.
Configuration is done with environment variables, see README.md.
"""
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from base64 import b64decode, b64encode
from datetime import datetime, timezone
from http import HTTPStatus
from urllib.parse import parse_qsl

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
DATA_DIR = os.path.abspath(os.environ.get('KCMS_DATA_DIR') or os.path.join(BASE_DIR, 'data'))
DB_PATH = os.path.join(DATA_DIR, 'kaveh-cms.db')
PHOTO_DIR = os.path.join(DATA_DIR, 'photos')
FILE_DIR = os.path.join(DATA_DIR, 'files')


def env_flag(name, default=False):
    value = os.environ.get(name)
    if value is None or value == '':
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')


MAX_PHOTO_BYTES = int(float(os.environ.get('KCMS_MAX_PHOTO_MB', '15')) * 1024 * 1024)
MAX_FILE_BYTES = int(float(os.environ.get('KCMS_MAX_FILE_MB', '25')) * 1024 * 1024)
MAX_IMPORT_BYTES = int(float(os.environ.get('KCMS_MAX_IMPORT_MB', '300')) * 1024 * 1024)
MAX_JSON_BYTES = 1024 * 1024
ALLOW_REGISTRATION = env_flag('KCMS_ALLOW_REGISTRATION')
TRUST_PROXY = env_flag('KCMS_TRUST_PROXY', True)
COOKIE_SECURE = os.environ.get('KCMS_COOKIE_SECURE', 'auto').strip().lower()
SESSION_COOKIE = 'kcms_session'
SESSION_SECONDS = 60 * 60 * 24 * 30
CSRF_HEADER = 'HTTP_X_KCMS'

USERNAME_RE = re.compile(r'^[A-Za-z0-9._-]{3,32}$')
MIN_PASSWORD = 8
# (JSON key, database column, max length)
RECORD_FIELDS = [
    ('number', 'number', 64), ('name', 'name', 120), ('setup', 'setup_no', 64), ('pointLabel', 'point_label', 80),
    ('x', 'x', 32), ('y', 'y', 32), ('z', 'z', 32), ('x2', 'x2', 32), ('y2', 'y2', 32), ('z2', 'z2', 32),
    ('notes', 'notes', 20000),
]
ANNOTATION_TYPES = ('arrow', 'line', 'circle', 'text')
MAX_ANNOTATIONS = 300

STATIC_FILES = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
    '/style.css': ('style.css', 'text/css; charset=utf-8'),
    '/sw.js': ('sw.js', 'text/javascript; charset=utf-8'),
    '/theme.js': ('theme.js', 'text/javascript; charset=utf-8'),
    '/manifest.webmanifest': ('manifest.webmanifest', 'application/manifest+json'),
    '/icon.svg': ('icon.svg', 'image/svg+xml'),
    '/fonts/kalam-400.woff2': ('fonts/kalam-400.woff2', 'font/woff2'),
    '/fonts/kalam-700.woff2': ('fonts/kalam-700.woff2', 'font/woff2'),
}

SECURITY_HEADERS = [
    ('X-Content-Type-Options', 'nosniff'),
    ('Referrer-Policy', 'same-origin'),
    ('X-Frame-Options', 'DENY'),
    ('Content-Security-Policy',
     "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; "
     "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"),
]


# --------------------------------------------------------------------------- helpers

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return 'scrypt$16384$8$1$%s$%s' % (b64encode(salt).decode(), b64encode(digest).decode())


def verify_password(password, stored):
    try:
        algo, n, r, p, salt, digest = stored.split('$')
        if algo != 'scrypt':
            return False
        expected = b64decode(digest)
        actual = hashlib.scrypt(password.encode(), salt=b64decode(salt), n=int(n), r=int(r), p=int(p),
                                dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def sniff_image(data):
    """Return the MIME type of an image by its magic bytes, or None if it is not a supported image."""
    if data[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[4:8] == b'ftyp':
        brand = data[8:12]
        if brand in (b'heic', b'heix', b'hevc', b'hevx', b'heim', b'heis', b'mif1', b'msf1'):
            return 'image/heic'
        if brand in (b'avif', b'avis'):
            return 'image/avif'
    return None


EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
              'image/heic': 'heic', 'image/avif': 'avif'}


def photo_path(photo_id, thumb=False):
    if not re.fullmatch(r'[0-9a-f]{32}', photo_id):
        raise ValueError('bad photo id')
    return os.path.join(PHOTO_DIR, photo_id + ('_t' if thumb else ''))


def write_file_atomic(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def file_path(file_id):
    if not re.fullmatch(r'[0-9a-f]{32}', file_id):
        raise ValueError('bad file id')
    return os.path.join(FILE_DIR, file_id)


def blob_paths(photo_ids=(), file_ids=()):
    """Disk paths belonging to photos/attachments, to delete after the database rows are gone."""
    paths = []
    for pid in photo_ids:
        paths += [photo_path(pid), photo_path(pid, True)]
    for fid in file_ids:
        paths.append(file_path(fid))
    return paths


def remove_paths(paths):
    for path in paths:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def sniff_file(data):
    if data[:5] == b'%PDF-':
        return 'application/pdf'
    return sniff_image(data) or 'application/octet-stream'


def content_disposition(kind, filename):
    from urllib.parse import quote
    ascii_name = re.sub(r'[^A-Za-z0-9._ -]', '_', filename) or 'datei'
    return '%s; filename="%s"; filename*=UTF-8\'\'%s' % (kind, ascii_name, quote(filename))


def parse_multipart(content_type, body):
    match = re.search(r'boundary=(?:"([^"]+)"|([^;\s]+))', content_type or '')
    if not match:
        raise ApiError(400, 'Ungültige Anfrage (multipart boundary fehlt).')
    boundary = b'--' + (match.group(1) or match.group(2)).encode('latin-1')
    parts = {}
    for chunk in body.split(boundary)[1:]:
        if chunk.startswith(b'--'):
            break
        if chunk.startswith(b'\r\n'):
            chunk = chunk[2:]
        head, sep, data = chunk.partition(b'\r\n\r\n')
        if not sep:
            continue
        if data.endswith(b'\r\n'):
            data = data[:-2]
        name = re.search(rb'name="([^"]*)"', head)
        if name:
            parts[name.group(1).decode('utf-8', 'replace')] = data
    return parts


class ApiError(Exception):
    def __init__(self, status, message, **extra):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


# --------------------------------------------------------------------------- database

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    x TEXT NOT NULL DEFAULT '',
    y TEXT NOT NULL DEFAULT '',
    z TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, number)
);
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_record ON files(record_id, created_at);
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    has_thumb INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_record ON photos(record_id, position);
CREATE INDEX IF NOT EXISTS records_user ON records(user_id, updated_at);
"""

# Columns added after the first release; added to existing databases on start-up.
MIGRATIONS = {
    'records': [('name', "TEXT NOT NULL DEFAULT ''"), ('setup_no', "TEXT NOT NULL DEFAULT ''"),
                ('point_label', "TEXT NOT NULL DEFAULT ''"), ('x2', "TEXT NOT NULL DEFAULT ''"),
                ('y2', "TEXT NOT NULL DEFAULT ''"), ('z2', "TEXT NOT NULL DEFAULT ''"),
                ('editor', "TEXT NOT NULL DEFAULT ''")],
    'photos': [('caption', "TEXT NOT NULL DEFAULT ''"), ('annotations', "TEXT NOT NULL DEFAULT '[]'"),
               ('width', 'INTEGER NOT NULL DEFAULT 0'), ('height', 'INTEGER NOT NULL DEFAULT 0')],
}


def migrate(con):
    for table, columns in MIGRATIONS.items():
        existing = {r[1] for r in con.execute('PRAGMA table_info(%s)' % table)}
        for name, decl in columns:
            if name not in existing:
                con.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, name, decl))
    con.commit()

_init_lock = threading.Lock()
_initialized = False


def connect():
    global _initialized
    if not _initialized:
        with _init_lock:
            if not _initialized:
                os.makedirs(PHOTO_DIR, exist_ok=True)
                os.makedirs(FILE_DIR, exist_ok=True)
                con = sqlite3.connect(DB_PATH, timeout=30)
                con.execute('PRAGMA journal_mode=WAL')
                con.executescript(SCHEMA)
                migrate(con)
                con.close()
                _initialized = True
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA busy_timeout=30000')
    return con


def user_count(db):
    return db.execute('SELECT COUNT(*) FROM users').fetchone()[0]


def create_user(db, username, password, is_admin=False):
    username = (username or '').strip()
    if not USERNAME_RE.match(username):
        raise ApiError(400, 'Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.')
    if len(password or '') < MIN_PASSWORD:
        raise ApiError(400, 'Das Passwort muss mindestens %d Zeichen lang sein.' % MIN_PASSWORD)
    try:
        cur = db.execute('INSERT INTO users (username, pw_hash, is_admin, created_at) VALUES (?,?,?,?)',
                         (username, hash_password(password), 1 if is_admin else 0, now_iso()))
    except sqlite3.IntegrityError:
        raise ApiError(409, 'Dieser Benutzername ist bereits vergeben.')
    return cur.lastrowid


def parse_annotations(raw):
    try:
        value = json.loads(raw or '[]')
        return value if isinstance(value, list) else []
    except ValueError:
        return []


def photo_json(p):
    return {
        'id': p['id'],
        'url': '/photos/' + p['id'],
        'thumb': '/photos/' + p['id'] + ('/thumb' if p['has_thumb'] else ''),
        'mime': p['mime'], 'size': p['size'], 'width': p['width'], 'height': p['height'],
        'caption': p['caption'], 'annotations': parse_annotations(p['annotations']),
    }


def photos_for(db, record_ids):
    result = {rid: [] for rid in record_ids}
    if not record_ids:
        return result
    marks = ','.join('?' * len(record_ids))
    rows = db.execute('SELECT * FROM photos WHERE record_id IN (%s) ORDER BY position, created_at' % marks,
                      list(record_ids)).fetchall()
    for p in rows:
        result[p['record_id']].append(photo_json(p))
    return result


def files_for(db, record_ids):
    result = {rid: [] for rid in record_ids}
    if not record_ids:
        return result
    marks = ','.join('?' * len(record_ids))
    rows = db.execute('SELECT * FROM files WHERE record_id IN (%s) ORDER BY created_at, rowid' % marks,
                      list(record_ids)).fetchall()
    for f in rows:
        result[f['record_id']].append({'id': f['id'], 'name': f['name'], 'mime': f['mime'], 'size': f['size'],
                                       'url': '/files/' + f['id'], 'createdAt': f['created_at']})
    return result


def record_json(row, photos, files=()):
    out = {'id': row['id']}
    for key, column, _ in RECORD_FIELDS:
        out[key] = row[column]
    out.update({'editor': row['editor'], 'createdAt': row['created_at'], 'updatedAt': row['updated_at'],
                'photos': photos, 'files': list(files)})
    return out


def full_record(db, row):
    return record_json(row, photos_for(db, [row['id']])[row['id']], files_for(db, [row['id']])[row['id']])


def clean_record_fields(data, base=None):
    """Validate record fields. Keys missing from `data` keep their value from `base` (a DB row) or become ''."""
    if not isinstance(data, dict):
        raise ApiError(400, 'Ungültige Daten.')
    out = {}
    for key, column, limit in RECORD_FIELDS:
        if key in data:
            value = data[key]
        else:
            value = base[column] if base is not None else ''
        if value is None:
            value = ''
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            value = str(value)
        if not isinstance(value, str):
            raise ApiError(400, 'Ungültiger Wert für %s.' % key)
        value = value.strip()
        if len(value) > limit:
            raise ApiError(400, 'Feld %s ist zu lang (max. %d Zeichen).' % (key, limit))
        out[column] = value
    if not out['number']:
        raise ApiError(400, 'Bitte eine Programmnummer eingeben.')
    return out


def clean_annotations(value):
    if not isinstance(value, list) or len(value) > MAX_ANNOTATIONS:
        raise ApiError(400, 'Ungültige Markierungen.')
    out = []
    for a in value:
        if not isinstance(a, dict) or a.get('t') not in ANNOTATION_TYPES:
            raise ApiError(400, 'Ungültige Markierung.')
        item = {'t': a['t']}
        color = a.get('c', '#e53935')
        if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            raise ApiError(400, 'Ungültige Farbe.')
        item['c'] = color.lower()
        for k in ('x1', 'y1', 'x2', 'y2'):
            v = a.get(k, 0)
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not -1 <= v <= 2:
                raise ApiError(400, 'Ungültige Koordinate.')
            item[k] = round(float(v), 5)
        if a['t'] == 'text':
            text = a.get('text')
            if not isinstance(text, str) or not text.strip() or len(text) > 200:
                raise ApiError(400, 'Ungültiger Text.')
            item['text'] = text.strip()
        out.append(item)
    return out


def get_record(db, user_id, record_id):
    row = db.execute('SELECT * FROM records WHERE id=? AND user_id=?', (record_id, user_id)).fetchone()
    if not row:
        raise ApiError(404, 'Programm nicht gefunden.')
    return row


def delete_records(db, where, params):
    """Delete records matching WHERE clause; returns disk paths that must be removed after commit."""
    photo_ids = [r[0] for r in db.execute('SELECT p.id FROM photos p JOIN records r ON r.id=p.record_id WHERE '
                                          + where, params)]
    file_ids = [r[0] for r in db.execute('SELECT f.id FROM files f JOIN records r ON r.id=f.record_id WHERE '
                                         + where, params)]
    db.execute('DELETE FROM records WHERE id IN (SELECT r.id FROM records r WHERE %s)' % where, params)
    return blob_paths(photo_ids, file_ids)


def store_photo(db, user_id, record_id, data, thumb=None, width=0, height=0, caption='', annotations=()):
    mime = sniff_image(data)
    if not mime:
        raise ApiError(415, 'Dateiformat nicht unterstützt. Erlaubt: JPEG, PNG, WebP, GIF, HEIC, AVIF.')
    if len(data) > MAX_PHOTO_BYTES:
        raise ApiError(413, 'Foto ist zu groß (max. %d MB).' % (MAX_PHOTO_BYTES // (1024 * 1024)))
    if thumb is not None and (sniff_image(thumb) not in ('image/jpeg', 'image/png', 'image/webp')
                              or len(thumb) > 2 * 1024 * 1024):
        thumb = None
    pid = uuid.uuid4().hex
    write_file_atomic(photo_path(pid), data)
    if thumb:
        write_file_atomic(photo_path(pid, True), thumb)
    pos = db.execute('SELECT COALESCE(MAX(position), -1) + 1 FROM photos WHERE record_id=?', (record_id,)).fetchone()[0]
    db.execute('INSERT INTO photos (id, record_id, user_id, mime, size, has_thumb, position, created_at, '
               'width, height, caption, annotations) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
               (pid, record_id, user_id, mime, len(data), 1 if thumb else 0, pos, now_iso(),
                width, height, caption[:200], json.dumps(list(annotations), separators=(',', ':'))))
    return pid


def store_file(db, user_id, record_id, name, data):
    if not data:
        raise ApiError(400, 'Die Datei ist leer.')
    if len(data) > MAX_FILE_BYTES:
        raise ApiError(413, 'Datei ist zu groß (max. %d MB).' % (MAX_FILE_BYTES // (1024 * 1024)))
    name = re.sub(r'[\x00-\x1f/\\]', '_', (name or '').strip())[-150:] or 'datei'
    fid = uuid.uuid4().hex
    write_file_atomic(file_path(fid), data)
    db.execute('INSERT INTO files (id, record_id, user_id, name, mime, size, created_at) VALUES (?,?,?,?,?,?,?)',
               (fid, record_id, user_id, name, sniff_file(data), len(data), now_iso()))
    return fid


def touch_record(db, req, record_id):
    db.execute('UPDATE records SET updated_at=?, editor=? WHERE id=?', (now_iso(), req.user['username'], record_id))


# --------------------------------------------------------------------------- login throttling

_failures = {}
_failures_lock = threading.Lock()
FAIL_WINDOW = 15 * 60
FAIL_LIMIT = 10


def _throttle_keys(ip, username):
    return ('ip:' + ip, 'user:' + (username or '').lower())


def check_throttle(ip, username):
    cutoff = time.time() - FAIL_WINDOW
    with _failures_lock:
        for key in _throttle_keys(ip, username):
            hits = [t for t in _failures.get(key, []) if t > cutoff]
            _failures[key] = hits
            limit = FAIL_LIMIT * 3 if key.startswith('ip:') else FAIL_LIMIT
            if len(hits) >= limit:
                raise ApiError(429, 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.')


def record_failure(ip, username):
    with _failures_lock:
        for key in _throttle_keys(ip, username):
            _failures.setdefault(key, []).append(time.time())


def clear_failures(username):
    with _failures_lock:
        _failures.pop('user:' + (username or '').lower(), None)


# --------------------------------------------------------------------------- request / response

class Request:
    def __init__(self, environ):
        self.environ = environ
        self.method = environ.get('REQUEST_METHOD', 'GET').upper()
        self.path = environ.get('PATH_INFO', '/') or '/'
        self.query = dict(parse_qsl(environ.get('QUERY_STRING') or '', keep_blank_values=True))
        self.cookies = {}
        for item in (environ.get('HTTP_COOKIE') or '').split(';'):
            k, sep, v = item.strip().partition('=')
            if sep:
                self.cookies[k] = v
        self.user = None
        self.session_token = None

    @property
    def content_type(self):
        return self.environ.get('CONTENT_TYPE', '')

    @property
    def is_https(self):
        if self.environ.get('wsgi.url_scheme') == 'https':
            return True
        return TRUST_PROXY and self.environ.get('HTTP_X_FORWARDED_PROTO', '').split(',')[0].strip() == 'https'

    @property
    def client_ip(self):
        if TRUST_PROXY and self.environ.get('HTTP_X_FORWARDED_FOR'):
            return self.environ['HTTP_X_FORWARDED_FOR'].split(',')[0].strip()
        return self.environ.get('REMOTE_ADDR', '?')

    def content_length(self):
        try:
            return int(self.environ.get('CONTENT_LENGTH') or 0)
        except ValueError:
            raise ApiError(400, 'Ungültige Content-Length.')

    def read_body(self, limit):
        length = self.content_length()
        if length > limit:
            raise ApiError(413, 'Die Anfrage ist zu groß (max. %d MB).' % (limit // (1024 * 1024)))
        stream = self.environ['wsgi.input']
        chunks, remaining = [], length
        while remaining > 0:
            chunk = stream.read(min(remaining, 1024 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        return b''.join(chunks)

    def body_to_tempfile(self, limit):
        length = self.content_length()
        if length > limit:
            raise ApiError(413, 'Die Datei ist zu groß (max. %d MB).' % (limit // (1024 * 1024)))
        tmp = tempfile.TemporaryFile()
        stream, remaining = self.environ['wsgi.input'], length
        while remaining > 0:
            chunk = stream.read(min(remaining, 1024 * 1024))
            if not chunk:
                break
            tmp.write(chunk)
            remaining -= len(chunk)
        tmp.seek(0)
        return tmp

    def json(self):
        raw = self.read_body(MAX_JSON_BYTES)
        try:
            return json.loads(raw.decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, 'Ungültiges JSON.')


class Response:
    def __init__(self, body=b'', status=200, content_type='application/json; charset=utf-8', headers=None):
        self.status = status
        self.headers = [('Content-Type', content_type)] + list(headers or [])
        self.body = body  # bytes or iterable of bytes
        self.length = len(body) if isinstance(body, bytes) else None


def json_response(data, status=200, headers=None):
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    return Response(body, status, headers=[('Cache-Control', 'no-store')] + list(headers or []))


def session_cookie(req, token, max_age):
    parts = ['%s=%s' % (SESSION_COOKIE, token), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=%d' % max_age]
    if COOKIE_SECURE in ('1', 'true', 'yes') or (COOKIE_SECURE == 'auto' and req.is_https):
        parts.append('Secure')
    return ('Set-Cookie', '; '.join(parts))


class file_iter:
    """WSGI body that streams an open file and closes it when the server is done."""

    def __init__(self, f, chunk=256 * 1024):
        self.f, self.chunk = f, chunk

    def __iter__(self):
        while True:
            data = self.f.read(self.chunk)
            if not data:
                break
            yield data

    def close(self):
        self.f.close()


# --------------------------------------------------------------------------- routing

ROUTES = []


def route(method, pattern, auth=True, admin=False):
    regex = re.compile('^' + pattern + '$')

    def deco(fn):
        ROUTES.append((method, regex, fn, auth, admin))
        return fn
    return deco


def load_session(req, db):
    token = req.cookies.get(SESSION_COOKIE)
    if not token:
        return
    row = db.execute('SELECT u.id, u.username, u.is_admin, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id '
                     'WHERE s.token_hash=?', (token_hash(token),)).fetchone()
    if not row or row['expires_at'] < time.time():
        return
    req.user = {'id': row['id'], 'username': row['username'], 'isAdmin': bool(row['is_admin'])}
    req.session_token = token


def start_session(req, db, user_id):
    token = secrets.token_urlsafe(32)
    now = time.time()
    db.execute('DELETE FROM sessions WHERE expires_at < ?', (now,))
    db.execute('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
               (token_hash(token), user_id, now, now + SESSION_SECONDS))
    return session_cookie(req, token, SESSION_SECONDS)


# ---- setup & auth

@route('GET', '/api/status', auth=False)
def api_status(req, db):
    count = user_count(db)
    return json_response({
        'user': req.user,
        'needsSetup': count == 0,
        'registrationOpen': count == 0 or ALLOW_REGISTRATION,
    })


@route('POST', '/api/register', auth=False)
def api_register(req, db):
    data = req.json()
    first = user_count(db) == 0
    if not first and not ALLOW_REGISTRATION:
        raise ApiError(403, 'Die Registrierung ist deaktiviert. Bitte den Administrator um ein Konto bitten.')
    uid = create_user(db, data.get('username'), data.get('password'), is_admin=first)
    cookie = start_session(req, db, uid)
    db.commit()
    load_session_from_id(req, db, uid)
    return json_response({'user': req.user}, 201, headers=[cookie])


def load_session_from_id(req, db, uid):
    row = db.execute('SELECT id, username, is_admin FROM users WHERE id=?', (uid,)).fetchone()
    req.user = {'id': row['id'], 'username': row['username'], 'isAdmin': bool(row['is_admin'])}


@route('POST', '/api/login', auth=False)
def api_login(req, db):
    data = req.json()
    username = str(data.get('username') or '').strip()
    password = str(data.get('password') or '')
    check_throttle(req.client_ip, username)
    row = db.execute('SELECT id, pw_hash FROM users WHERE username=?', (username,)).fetchone()
    if not row or not verify_password(password, row['pw_hash']):
        record_failure(req.client_ip, username)
        raise ApiError(401, 'Benutzername oder Passwort ist falsch.')
    clear_failures(username)
    cookie = start_session(req, db, row['id'])
    db.commit()
    load_session_from_id(req, db, row['id'])
    return json_response({'user': req.user}, headers=[cookie])


@route('POST', '/api/logout', auth=False)
def api_logout(req, db):
    if req.session_token:
        db.execute('DELETE FROM sessions WHERE token_hash=?', (token_hash(req.session_token),))
        db.commit()
    return json_response({'ok': True}, headers=[session_cookie(req, '', 0)])


@route('POST', '/api/me/password')
def api_change_password(req, db):
    data = req.json()
    row = db.execute('SELECT pw_hash FROM users WHERE id=?', (req.user['id'],)).fetchone()
    if not verify_password(str(data.get('current') or ''), row['pw_hash']):
        raise ApiError(400, 'Das aktuelle Passwort ist falsch.')
    new = str(data.get('new') or '')
    if len(new) < MIN_PASSWORD:
        raise ApiError(400, 'Das neue Passwort muss mindestens %d Zeichen lang sein.' % MIN_PASSWORD)
    db.execute('UPDATE users SET pw_hash=? WHERE id=?', (hash_password(new), req.user['id']))
    # sign out all other devices
    db.execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', (req.user['id'], token_hash(req.session_token)))
    db.commit()
    return json_response({'ok': True})


# ---- user administration

def user_json(row):
    return {'id': row['id'], 'username': row['username'], 'isAdmin': bool(row['is_admin']),
            'createdAt': row['created_at'], 'records': row['records']}


@route('GET', '/api/users', admin=True)
def api_users(req, db):
    rows = db.execute('SELECT u.*, (SELECT COUNT(*) FROM records r WHERE r.user_id=u.id) AS records '
                      'FROM users u ORDER BY u.username COLLATE NOCASE').fetchall()
    return json_response({'users': [user_json(r) for r in rows]})


@route('POST', '/api/users', admin=True)
def api_create_user(req, db):
    data = req.json()
    uid = create_user(db, data.get('username'), data.get('password'), bool(data.get('isAdmin')))
    db.commit()
    row = db.execute('SELECT u.*, 0 AS records FROM users u WHERE id=?', (uid,)).fetchone()
    return json_response({'user': user_json(row)}, 201)


@route('PUT', r'/api/users/(\d+)', admin=True)
def api_update_user(req, db, uid):
    uid = int(uid)
    data = req.json()
    row = db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
    if not row:
        raise ApiError(404, 'Benutzer nicht gefunden.')
    if data.get('password'):
        if len(data['password']) < MIN_PASSWORD:
            raise ApiError(400, 'Das Passwort muss mindestens %d Zeichen lang sein.' % MIN_PASSWORD)
        db.execute('UPDATE users SET pw_hash=? WHERE id=?', (hash_password(data['password']), uid))
        if uid != req.user['id']:
            db.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
    if 'isAdmin' in data:
        make_admin = bool(data['isAdmin'])
        if not make_admin and row['is_admin']:
            if uid == req.user['id']:
                raise ApiError(400, 'Du kannst dir die Administratorrechte nicht selbst entziehen.')
        db.execute('UPDATE users SET is_admin=? WHERE id=?', (1 if make_admin else 0, uid))
    db.commit()
    return json_response({'ok': True})


@route('DELETE', r'/api/users/(\d+)', admin=True)
def api_delete_user(req, db, uid):
    uid = int(uid)
    if uid == req.user['id']:
        raise ApiError(400, 'Du kannst dein eigenes Konto nicht löschen.')
    if not db.execute('SELECT 1 FROM users WHERE id=?', (uid,)).fetchone():
        raise ApiError(404, 'Benutzer nicht gefunden.')
    paths = delete_records(db, 'r.user_id=?', (uid,))
    db.execute('DELETE FROM users WHERE id=?', (uid,))
    db.commit()
    remove_paths(paths)
    return json_response({'ok': True})


# ---- records

def insert_record(db, req, fields, created=None, updated=None):
    ts = now_iso()
    columns = [c for _, c, _ in RECORD_FIELDS]
    cur = db.execute('INSERT INTO records (user_id, %s, editor, created_at, updated_at) VALUES (?, %s, ?, ?, ?)'
                     % (', '.join(columns), ', '.join('?' * len(columns))),
                     [req.user['id']] + [fields[c] for c in columns]
                     + [req.user['username'], created or updated or ts, updated or ts])
    return cur.lastrowid


def number_clash(db, req, number, own_id=None):
    clash = db.execute('SELECT id FROM records WHERE user_id=? AND number=? AND id<>?',
                       (req.user['id'], number, own_id or 0)).fetchone()
    if clash:
        raise ApiError(409, 'Programm %s existiert bereits.' % number, recordId=clash['id'])


@route('GET', '/api/records')
def api_records(req, db):
    q = (req.query.get('q') or '').strip()
    sql, params = 'SELECT * FROM records WHERE user_id=?', [req.user['id']]
    if q:
        like = '%' + q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        sql += " AND (number LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')"
        params += [like, like, like]
    rows = db.execute(sql + ' ORDER BY updated_at DESC, id DESC', params).fetchall()
    ids = [r['id'] for r in rows]
    photos, files = photos_for(db, ids), files_for(db, ids)
    return json_response({'records': [record_json(r, photos[r['id']], files[r['id']]) for r in rows]})


@route('GET', r'/api/records/(\d+)')
def api_record(req, db, rid):
    return json_response({'record': full_record(db, get_record(db, req.user['id'], int(rid)))})


@route('POST', '/api/records')
def api_create_record(req, db):
    fields = clean_record_fields(req.json())
    number_clash(db, req, fields['number'])
    rid = insert_record(db, req, fields)
    db.commit()
    return json_response({'record': full_record(db, get_record(db, req.user['id'], rid))}, 201)


@route('PUT', r'/api/records/(\d+)')
def api_update_record(req, db, rid):
    row = get_record(db, req.user['id'], int(rid))
    fields = clean_record_fields(req.json(), base=row)
    number_clash(db, req, fields['number'], row['id'])
    changed = [c for c in fields if fields[c] != row[c]]
    if changed:
        db.execute('UPDATE records SET %s, updated_at=?, editor=? WHERE id=?' % ', '.join(c + '=?' for c in changed),
                   [fields[c] for c in changed] + [now_iso(), req.user['username'], row['id']])
        db.commit()
    return json_response({'record': full_record(db, get_record(db, req.user['id'], row['id']))})


@route('POST', r'/api/records/(\d+)/duplicate')
def api_duplicate_record(req, db, rid):
    row = get_record(db, req.user['id'], int(rid))
    fields = clean_record_fields(req.json(), base=row)
    number_clash(db, req, fields['number'])
    new_id = insert_record(db, req, fields)
    new_paths = []
    try:
        for p in db.execute('SELECT * FROM photos WHERE record_id=? ORDER BY position, created_at', (row['id'],)).fetchall():
            pid = uuid.uuid4().hex
            shutil.copyfile(photo_path(p['id']), photo_path(pid))
            new_paths.append(photo_path(pid))
            if p['has_thumb'] and os.path.exists(photo_path(p['id'], True)):
                shutil.copyfile(photo_path(p['id'], True), photo_path(pid, True))
                new_paths.append(photo_path(pid, True))
            db.execute('INSERT INTO photos (id, record_id, user_id, mime, size, has_thumb, position, created_at, width, '
                       'height, caption, annotations) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                       (pid, new_id, req.user['id'], p['mime'], p['size'], p['has_thumb'], p['position'], now_iso(),
                        p['width'], p['height'], p['caption'], p['annotations']))
        for f in db.execute('SELECT * FROM files WHERE record_id=?', (row['id'],)).fetchall():
            fid = uuid.uuid4().hex
            shutil.copyfile(file_path(f['id']), file_path(fid))
            new_paths.append(file_path(fid))
            db.execute('INSERT INTO files (id, record_id, user_id, name, mime, size, created_at) VALUES (?,?,?,?,?,?,?)',
                       (fid, new_id, req.user['id'], f['name'], f['mime'], f['size'], now_iso()))
        db.commit()
    except Exception:
        db.rollback()
        remove_paths(new_paths)
        raise
    return json_response({'record': full_record(db, get_record(db, req.user['id'], new_id))}, 201)


@route('DELETE', r'/api/records/(\d+)')
def api_delete_record(req, db, rid):
    row = get_record(db, req.user['id'], int(rid))
    paths = delete_records(db, 'r.id=?', (row['id'],))
    db.commit()
    remove_paths(paths)
    return json_response({'ok': True})


# ---- photos

def int_field(raw, limit=100000):
    try:
        value = int((raw or b'0').decode('ascii', 'replace'))
        return value if 0 <= value <= limit else 0
    except ValueError:
        return 0


@route('POST', r'/api/records/(\d+)/photos')
def api_upload_photo(req, db, rid):
    row = get_record(db, req.user['id'], int(rid))
    body = req.read_body(MAX_PHOTO_BYTES * 2 + 64 * 1024)
    width = height = 0
    if req.content_type.startswith('multipart/form-data'):
        parts = parse_multipart(req.content_type, body)
        data, thumb = parts.get('photo'), parts.get('thumb') or None
        width, height = int_field(parts.get('width')), int_field(parts.get('height'))
    else:
        data, thumb = body, None
    if not data:
        raise ApiError(400, 'Keine Bilddaten empfangen.')
    pid = store_photo(db, req.user['id'], row['id'], data, thumb, width, height)
    touch_record(db, req, row['id'])
    db.commit()
    photos = photos_for(db, [row['id']])[row['id']]
    return json_response({'photo': next(p for p in photos if p['id'] == pid), 'photos': photos}, 201)


def get_photo(db, req, pid):
    row = db.execute('SELECT * FROM photos WHERE id=? AND user_id=?', (pid, req.user['id'])).fetchone()
    if not row:
        raise ApiError(404, 'Foto nicht gefunden.')
    return row


@route('PUT', r'/api/photos/([0-9a-f]{32})')
def api_update_photo(req, db, pid):
    row = get_photo(db, req, pid)
    data = req.json()
    if 'caption' in data:
        caption = data['caption']
        if not isinstance(caption, str) or len(caption) > 200:
            raise ApiError(400, 'Ungültige Bildbeschriftung.')
        db.execute('UPDATE photos SET caption=? WHERE id=?', (caption.strip(), pid))
    if 'annotations' in data:
        db.execute('UPDATE photos SET annotations=? WHERE id=?',
                   (json.dumps(clean_annotations(data['annotations']), separators=(',', ':')), pid))
    for key in ('width', 'height'):
        if isinstance(data.get(key), int) and 0 < data[key] <= 100000 and not row[key]:
            db.execute('UPDATE photos SET %s=? WHERE id=?' % key, (data[key], pid))
    touch_record(db, req, row['record_id'])
    db.commit()
    return json_response({'photo': photo_json(get_photo(db, req, pid))})


@route('DELETE', r'/api/photos/([0-9a-f]{32})')
def api_delete_photo(req, db, pid):
    row = get_photo(db, req, pid)
    db.execute('DELETE FROM photos WHERE id=?', (pid,))
    touch_record(db, req, row['record_id'])
    db.commit()
    remove_paths(blob_paths([pid]))
    return json_response({'ok': True})


@route('PUT', r'/api/records/(\d+)/photo-order')
def api_photo_order(req, db, rid):
    row = get_record(db, req.user['id'], int(rid))
    order = req.json().get('order')
    if not isinstance(order, list):
        raise ApiError(400, 'Ungültige Reihenfolge.')
    for pos, pid in enumerate(order):
        db.execute('UPDATE photos SET position=? WHERE id=? AND record_id=?', (pos, str(pid), row['id']))
    touch_record(db, req, row['id'])
    db.commit()
    return json_response({'photos': photos_for(db, [row['id']])[row['id']]})


@route('GET', r'/photos/([0-9a-f]{32})(/thumb)?')
def serve_photo(req, db, pid, thumb):
    row = get_photo(db, req, pid)
    use_thumb = bool(thumb) and row['has_thumb']
    path = photo_path(pid, use_thumb)
    if not os.path.exists(path):
        raise ApiError(404, 'Fotodatei fehlt.')
    mime = row['mime']
    if use_thumb:
        with open(path, 'rb') as f:
            mime = sniff_image(f.read(16))
    headers = [('Cache-Control', 'private, max-age=31536000, immutable'),
               ('Content-Length', str(os.path.getsize(path)))]
    if req.query.get('download'):
        headers.append(('Content-Disposition', content_disposition(
            'attachment', 'foto-%s.%s' % (pid[:8], EXTENSIONS.get(mime, 'bin')))))
    return Response(file_iter(open(path, 'rb')), 200, mime or 'application/octet-stream', headers)


# ---- attachments (PDF drawings etc.)

@route('POST', r'/api/records/(\d+)/files')
def api_upload_file(req, db, rid):
    from urllib.parse import unquote
    row = get_record(db, req.user['id'], int(rid))
    data = req.read_body(MAX_FILE_BYTES)
    name = unquote(req.environ.get('HTTP_X_FILENAME', '') or req.query.get('name', ''))
    store_file(db, req.user['id'], row['id'], name, data)
    touch_record(db, req, row['id'])
    db.commit()
    return json_response({'files': files_for(db, [row['id']])[row['id']]}, 201)


@route('DELETE', r'/api/files/([0-9a-f]{32})')
def api_delete_file(req, db, fid):
    row = db.execute('SELECT record_id FROM files WHERE id=? AND user_id=?', (fid, req.user['id'])).fetchone()
    if not row:
        raise ApiError(404, 'Datei nicht gefunden.')
    db.execute('DELETE FROM files WHERE id=?', (fid,))
    touch_record(db, req, row['record_id'])
    db.commit()
    remove_paths(blob_paths(file_ids=[fid]))
    return json_response({'ok': True})


@route('GET', r'/files/([0-9a-f]{32})')
def serve_file(req, db, fid):
    row = db.execute('SELECT * FROM files WHERE id=? AND user_id=?', (fid, req.user['id'])).fetchone()
    path = file_path(fid)
    if not row or not os.path.exists(path):
        raise ApiError(404, 'Datei nicht gefunden.')
    inline = row['mime'] in ('application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp') \
        and not req.query.get('download')
    headers = [('Cache-Control', 'private, max-age=31536000, immutable'),
               ('Content-Length', str(os.path.getsize(path))),
               ('Content-Disposition', content_disposition('inline' if inline else 'attachment', row['name']))]
    return Response(file_iter(open(path, 'rb')), 200, row['mime'], headers)


# ---- backup

@route('GET', '/api/export')
def api_export(req, db):
    rows = db.execute('SELECT * FROM records WHERE user_id=? ORDER BY number', (req.user['id'],)).fetchall()
    ids = [r['id'] for r in rows]
    photos, files = photos_for(db, ids), files_for(db, ids)
    tmp = tempfile.TemporaryFile()
    out_records = []
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_STORED) as zf:
        for r in rows:
            entry = record_json(r, [], [])
            del entry['id']
            for p in photos[r['id']]:
                path = photo_path(p['id'])
                if not os.path.exists(path):
                    continue
                name = 'photos/%s.%s' % (p['id'], EXTENSIONS.get(p['mime'], 'bin'))
                zf.write(path, name)
                entry['photos'].append({'file': name, 'mime': p['mime'], 'caption': p['caption'],
                                        'annotations': p['annotations'], 'width': p['width'], 'height': p['height']})
            for f in files[r['id']]:
                path = file_path(f['id'])
                if os.path.exists(path):
                    name = 'files/%s/%s' % (f['id'], f['name'])
                    zf.write(path, name)
                    entry['files'].append({'file': name, 'name': f['name']})
            out_records.append(entry)
        manifest = {'app': 'Kaveh CMS', 'version': 3, 'exportedAt': now_iso(), 'user': req.user['username'],
                    'records': out_records}
        zf.writestr('records.json', json.dumps(manifest, ensure_ascii=False, indent=2), zipfile.ZIP_DEFLATED)
    size = tmp.tell()
    tmp.seek(0)
    stamp = datetime.now().strftime('%Y-%m-%d')
    return Response(file_iter(tmp), 200, 'application/zip', [
        ('Content-Disposition', 'attachment; filename="kaveh-cms-backup-%s.zip"' % stamp),
        ('Content-Length', str(size)), ('Cache-Control', 'no-store')])


def decode_data_url(value):
    if not isinstance(value, str) or not value.startswith('data:') or ',' not in value:
        return None
    head, payload = value.split(',', 1)
    try:
        return b64decode(payload) if ';base64' in head else None
    except ValueError:
        return None


@route('POST', '/api/import')
def api_import(req, db):
    tmp = req.body_to_tempfile(MAX_IMPORT_BYTES)
    try:
        magic = tmp.read(4)
        tmp.seek(0)
        zf = None
        if magic == b'PK\x03\x04':
            try:
                zf = zipfile.ZipFile(tmp)
                manifest = json.loads(zf.read('records.json').decode('utf-8'))
            except (zipfile.BadZipFile, KeyError, ValueError):
                raise ApiError(400, 'Diese Backup-Datei ist ungültig (records.json fehlt oder ist beschädigt).')
        else:
            try:
                manifest = json.loads(tmp.read().decode('utf-8-sig'))
            except (ValueError, UnicodeDecodeError):
                raise ApiError(400, 'Diese Backup-Datei ist ungültig.')
        records = manifest.get('records') if isinstance(manifest, dict) else None
        if not isinstance(records, list):
            raise ApiError(400, 'Diese Backup-Datei enthält keine Programme.')

        def zip_blob(name):
            if zf is None or not isinstance(name, str):
                return None
            try:
                return zf.read(name)
            except KeyError:
                return None

        imported, photo_count, file_count, skipped = 0, 0, 0, 0
        stale_paths, new_paths = [], []
        try:
            for item in records:
                try:
                    fields = clean_record_fields(item)
                except ApiError:
                    skipped += 1
                    continue
                stale_paths += delete_records(db, 'r.user_id=? AND r.number=?', (req.user['id'], fields['number']))
                created = item.get('createdAt') if isinstance(item.get('createdAt'), str) else None
                updated = item.get('updatedAt') if isinstance(item.get('updatedAt'), str) else None
                rid = insert_record(db, req, fields, created, updated)
                if isinstance(item.get('editor'), str) and item['editor']:
                    db.execute('UPDATE records SET editor=? WHERE id=?', (item['editor'][:64], rid))
                photos = []  # (bytes, metadata)
                legacy = decode_data_url(item.get('photo'))  # backup from the old offline prototype
                if legacy:
                    photos.append((legacy, {}))
                for p in item.get('photos') or []:
                    if isinstance(p, dict):
                        blob = zip_blob(p.get('file')) or decode_data_url(p.get('data'))
                        meta = p
                    else:
                        blob, meta = decode_data_url(p), {}
                    if blob:
                        photos.append((blob, meta))
                for blob, meta in photos:
                    try:
                        annotations = clean_annotations(meta.get('annotations') or [])
                    except ApiError:
                        annotations = []
                    caption = meta.get('caption') if isinstance(meta.get('caption'), str) else ''
                    size = [meta.get(k) if isinstance(meta.get(k), int) and 0 < meta.get(k) <= 100000 else 0
                            for k in ('width', 'height')]
                    try:
                        pid = store_photo(db, req.user['id'], rid, blob, None, size[0], size[1], caption, annotations)
                        new_paths += blob_paths([pid])
                        photo_count += 1
                    except ApiError:
                        pass
                for f in item.get('files') or []:
                    if not isinstance(f, dict):
                        continue
                    blob = zip_blob(f.get('file'))
                    if blob:
                        try:
                            fid = store_file(db, req.user['id'], rid, str(f.get('name') or 'datei'), blob)
                            new_paths += blob_paths(file_ids=[fid])
                            file_count += 1
                        except ApiError:
                            pass
                imported += 1
            db.commit()
        except Exception:
            db.rollback()
            remove_paths(new_paths)
            raise
        remove_paths(stale_paths)
        return json_response({'imported': imported, 'photos': photo_count, 'files': file_count, 'skipped': skipped})
    finally:
        tmp.close()


# --------------------------------------------------------------------------- WSGI entry point

def serve_static(req, name, content_type):
    path = os.path.join(STATIC_DIR, name)
    st = os.stat(path)
    etag = '"%x-%x"' % (int(st.st_mtime), st.st_size)
    headers = [('ETag', etag), ('Cache-Control', 'no-cache')]
    if name == 'sw.js':
        headers.append(('Service-Worker-Allowed', '/'))
    if req.environ.get('HTTP_IF_NONE_MATCH') == etag:
        return Response(b'', 304, content_type, headers)
    with open(path, 'rb') as f:
        return Response(f.read(), 200, content_type, headers)


def dispatch(req):
    if req.method in ('GET', 'HEAD') and req.path in STATIC_FILES:
        return serve_static(req, *STATIC_FILES[req.path])
    db = connect()
    try:
        load_session(req, db)
        allowed = []
        for method, regex, fn, auth, admin in ROUTES:
            match = regex.match(req.path)
            if not match:
                continue
            allowed.append(method)
            if method != req.method and not (method == 'GET' and req.method == 'HEAD'):
                continue
            if req.method not in ('GET', 'HEAD') and not req.environ.get(CSRF_HEADER):
                raise ApiError(403, 'Anfrage abgelehnt (CSRF-Schutz).')
            if (auth or admin) and not req.user:
                raise ApiError(401, 'Bitte anmelden.')
            if admin and not req.user['isAdmin']:
                raise ApiError(403, 'Nur für Administratoren.')
            return fn(req, db, *match.groups())
        if allowed:
            raise ApiError(405, 'Methode nicht erlaubt.')
        raise ApiError(404, 'Nicht gefunden.')
    finally:
        db.close()


def application(environ, start_response):
    req = Request(environ)
    try:
        resp = dispatch(req)
    except ApiError as e:
        resp = json_response(dict({'error': e.message}, **e.extra), e.status)
    except Exception:
        import traceback
        traceback.print_exc(file=environ.get('wsgi.errors', sys.stderr))
        resp = json_response({'error': 'Interner Serverfehler.'}, 500)
    headers = resp.headers + SECURITY_HEADERS
    if resp.length is not None and not any(h[0] == 'Content-Length' for h in headers):
        headers.append(('Content-Length', str(resp.length)))
    status = '%d %s' % (resp.status, HTTPStatus(resp.status).phrase)
    start_response(status, headers)
    if req.method == 'HEAD':
        if hasattr(resp.body, 'close'):
            resp.body.close()
        return [b'']
    return [resp.body] if isinstance(resp.body, bytes) else resp.body


# --------------------------------------------------------------------------- CLI

def port_free(host, port):
    import socket
    with socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def lan_address():
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('192.0.2.1', 9))  # no packet is sent; only picks the outgoing interface
            return s.getsockname()[0]
    except OSError:
        return None


def serve():
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', '8000'))
    if not port_free(host, port):
        if os.environ.get('PORT'):
            sys.exit('Port %d ist bereits belegt. Anderen Port wählen, z. B.:  PORT=%d python3 app.py' % (port, port + 1))
        port = next((p for p in range(port + 1, port + 50) if port_free(host, p)), None)
        if port is None:
            sys.exit('Kein freier Port gefunden. Bitte mit PORT=... einen freien Port angeben.')
        print('Port 8000 ist belegt – verwende stattdessen Port %d.' % port)
    connect().close()
    try:
        from waitress import serve as waitress_serve
    except ImportError:
        waitress_serve = None
    print('Kaveh CMS läuft  (Daten: %s)' % DATA_DIR)
    print('  Auf diesem Computer:   http://localhost:%d' % port)
    lan = lan_address() if host in ('0.0.0.0', '::') else None
    if lan and not lan.startswith('127.'):
        print('  Handy im selben WLAN:  http://%s:%d' % (lan, port))
    print('Beenden mit Strg+C.', flush=True)
    if waitress_serve:
        waitress_serve(application, host=host, port=port, threads=8, max_request_body_size=MAX_IMPORT_BYTES + 1024 * 1024)
        return
    from socketserver import ThreadingMixIn
    from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

    class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
        daemon_threads = True

    class QuietHandler(WSGIRequestHandler):
        def log_request(self, code='-', size='-'):
            if not env_flag('KCMS_QUIET'):
                super().log_request(code, size)

    with make_server(host, port, application, ThreadingWSGIServer, QuietHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


def ask_password():
    pw = os.environ.get('KCMS_PASSWORD') or getpass.getpass('Passwort: ')
    if not os.environ.get('KCMS_PASSWORD') and getpass.getpass('Passwort wiederholen: ') != pw:
        sys.exit('Passwörter stimmen nicht überein.')
    return pw


def cli(argv):
    cmd = argv[0] if argv else 'serve'
    if cmd == 'serve':
        return serve()
    db = connect()
    try:
        if cmd == 'create-user' and len(argv) >= 2:
            uid = create_user(db, argv[1], ask_password(), '--admin' in argv)
            db.commit()
            print('Benutzer %s angelegt (id %d).' % (argv[1], uid))
        elif cmd == 'set-password' and len(argv) >= 2:
            row = db.execute('SELECT id FROM users WHERE username=?', (argv[1],)).fetchone()
            if not row:
                sys.exit('Benutzer nicht gefunden.')
            pw = ask_password()
            if len(pw) < MIN_PASSWORD:
                sys.exit('Das Passwort muss mindestens %d Zeichen lang sein.' % MIN_PASSWORD)
            db.execute('UPDATE users SET pw_hash=? WHERE id=?', (hash_password(pw), row['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?', (row['id'],))
            db.commit()
            print('Passwort geändert.')
        elif cmd == 'list-users':
            for r in db.execute('SELECT username, is_admin, created_at FROM users ORDER BY username'):
                print('%-32s %s  %s' % (r['username'], 'admin' if r['is_admin'] else '     ', r['created_at']))
        else:
            print(__doc__)
            sys.exit(1)
    except ApiError as e:
        sys.exit(e.message)
    finally:
        db.close()


if __name__ == '__main__':
    cli(sys.argv[1:])
