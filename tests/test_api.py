"""End-to-end API tests: starts the real server on a free port with a temporary data directory.

Run:  python3 -m unittest discover -s tests -v
"""
import base64
import http.cookiejar
import io
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def make_png(w=64, h=48, rgb=(200, 40, 40)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method, path, json_body=None, data=None, content_type=None, csrf=True):
        headers = {}
        if csrf and method != 'GET':
            headers['X-KCMS'] = '1'
        if json_body is not None:
            data = json.dumps(json_body).encode()
            content_type = 'application/json'
        if content_type:
            headers['Content-Type'] = content_type
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req) as res:
                return res.status, res.read(), res.headers
        except urllib.error.HTTPError as e:
            with e:
                return e.code, e.read(), e.headers

    def json(self, method, path, body=None, **kw):
        status, raw, _ = self.call(method, path, json_body=body, **kw)
        return status, (json.loads(raw) if raw else {})

    def upload(self, record_id, photo, thumb=None):
        boundary = uuid.uuid4().hex
        parts = [(b'photo', photo)] + ([(b'thumb', thumb)] if thumb else [])
        body = b''
        for name, blob in parts:
            body += (b'--' + boundary.encode() + b'\r\nContent-Disposition: form-data; name="' + name
                     + b'"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n' + blob + b'\r\n')
        body += b'--' + boundary.encode() + b'--\r\n'
        status, raw, _ = self.call('POST', '/api/records/%d/photos' % record_id, data=body,
                                   content_type='multipart/form-data; boundary=' + boundary)
        return status, json.loads(raw)


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
        env = dict(os.environ, KCMS_DATA_DIR=cls.tmp.name, PORT=str(port), HOST='127.0.0.1', KCMS_QUIET='1')
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, 'app.py')], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        cls.base = 'http://127.0.0.1:%d' % port
        for _ in range(100):
            try:
                urllib.request.urlopen(cls.base + '/api/status').read()
                break
            except OSError:
                time.sleep(0.05)
        cls.admin = Client(cls.base)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait()
        cls.proc.stderr.close()
        cls.tmp.cleanup()

    def photo_files(self):
        return sorted(os.listdir(os.path.join(self.tmp.name, 'photos')))

    def test_full_flow(self):
        a = self.admin
        status, data = a.json('GET', '/api/status')
        self.assertTrue(data['needsSetup'])
        self.assertEqual(a.json('GET', '/api/records')[0], 401)

        # first account becomes admin
        status, data = a.json('POST', '/api/register', {'username': 'kaveh', 'password': 'geheim123'})
        self.assertEqual(status, 201, data)
        self.assertTrue(data['user']['isAdmin'])
        # registration is now closed
        self.assertEqual(Client(self.base).json('POST', '/api/register', {'username': 'eve', 'password': 'geheim123'})[0], 403)

        # CSRF header required for writes
        self.assertEqual(a.json('POST', '/api/records', {'number': '1'}, csrf=False)[0], 403)

        status, data = a.json('POST', '/api/records', {'number': '1645540', 'x': '240', 'y': 560, 'z': '370',
                                                       'notes': 'Achtung: linker Bereich 5 mm'})
        self.assertEqual(status, 201, data)
        rid = data['record']['id']
        self.assertEqual(a.json('POST', '/api/records', {'number': '1645540'})[0], 409)

        # the old prototype failed at the 3rd photo – store many
        png = make_png()
        for i in range(12):
            status, data = a.upload(rid, make_png(rgb=(i * 20, 100, 50)), thumb=png)
            self.assertEqual(status, 201, data)
        self.assertEqual(len(data['photos']), 12)
        self.assertEqual(len(self.photo_files()), 24)  # full + thumb

        # reject non-images
        status, _ = a.upload(rid, b'<html><script>alert(1)</script></html>')
        self.assertEqual(status, 415)

        status, raw, headers = a.call('GET', data['photos'][0]['url'])
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'image/png')
        self.assertTrue(raw.startswith(b'\x89PNG'))
        self.assertEqual(a.call('GET', data['photos'][0]['thumb'])[0], 200)

        # reorder and delete a photo
        order = [p['id'] for p in data['photos']][::-1]
        status, data = a.json('PUT', '/api/records/%d/photo-order' % rid, {'order': order})
        self.assertEqual([p['id'] for p in data['photos']], order)
        self.assertEqual(a.json('DELETE', '/api/photos/' + order[0])[0], 200)
        status, data = a.json('GET', '/api/records/%d' % rid)
        self.assertEqual(len(data['record']['photos']), 11)
        self.assertEqual(len(self.photo_files()), 22)

        # edit
        status, data = a.json('PUT', '/api/records/%d' % rid, {'number': '1645540', 'x': '241', 'y': '560', 'z': '370', 'notes': 'neu'})
        self.assertEqual(data['record']['x'], '241')
        status, data = a.json('POST', '/api/records', {'number': '777'})
        other = data['record']['id']
        self.assertEqual(a.json('PUT', '/api/records/%d' % other, {'number': '1645540'})[0], 409)

        # search
        status, data = a.json('GET', '/api/records?q=neu')
        self.assertEqual([r['number'] for r in data['records']], ['1645540'])

        # second user cannot see admin's data
        status, data = a.json('POST', '/api/users', {'username': 'werker', 'password': 'passwort1'})
        self.assertEqual(status, 201, data)
        b = Client(self.base)
        self.assertEqual(b.json('POST', '/api/login', {'username': 'werker', 'password': 'falsch!!'})[0], 401)
        self.assertEqual(b.json('POST', '/api/login', {'username': 'WERKER', 'password': 'passwort1'})[0], 200)
        self.assertEqual(b.json('GET', '/api/records')[1]['records'], [])
        self.assertEqual(b.call('GET', '/photos/' + order[1])[0], 404)
        self.assertEqual(b.json('GET', '/api/records/%d' % rid)[0], 404)
        self.assertEqual(b.json('DELETE', '/api/records/%d' % rid)[0], 404)
        self.assertEqual(b.json('GET', '/api/users')[0], 403)

        # export → delete → import restores everything
        status, raw, headers = a.call('GET', '/api/export')
        self.assertEqual(status, 200)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        manifest = json.loads(zf.read('records.json'))
        self.assertEqual(len(manifest['records']), 2)
        self.assertEqual(a.json('DELETE', '/api/records/%d' % rid)[0], 200)
        self.assertEqual(self.photo_files(), [])
        status, data = a.json('POST', '/api/import', data=raw, content_type='application/zip')
        self.assertEqual(status, 200, data)
        self.assertEqual((data['imported'], data['photos']), (2, 11))
        status, data = a.json('GET', '/api/records')
        self.assertEqual(sorted(len(r['photos']) for r in data['records']), [0, 11])
        # re-import replaces instead of duplicating
        a.json('POST', '/api/import', data=raw, content_type='application/zip')
        status, data = a.json('GET', '/api/records')
        self.assertEqual(len(data['records']), 2)
        self.assertEqual(len(self.photo_files()), 11)

        # backup from the old localStorage prototype
        legacy = {'app': 'Kaveh CMS', 'version': 1, 'records': [
            {'number': '999', 'x': '1', 'y': '2', 'z': '3', 'notes': 'alt',
             'photo': 'data:image/png;base64,' + base64.b64encode(png).decode(), 'updatedAt': '2026-10-24T10:00:00.000Z'}]}
        status, data = a.json('POST', '/api/import', data=json.dumps(legacy).encode(), content_type='application/json')
        self.assertEqual((data['imported'], data['photos']), (1, 1))

        # password change logs out other sessions
        a2 = Client(self.base)
        a2.json('POST', '/api/login', {'username': 'kaveh', 'password': 'geheim123'})
        self.assertEqual(a.json('POST', '/api/me/password', {'current': 'geheim123', 'new': 'neuesPasswort'})[0], 200)
        self.assertEqual(a2.json('GET', '/api/records')[0], 401)
        self.assertEqual(a.json('GET', '/api/records')[0], 200)

        # deleting a user removes their data
        status, users = a.json('GET', '/api/users')
        werker = next(u for u in users['users'] if u['username'] == 'werker')
        b.json('POST', '/api/records', {'number': 'w1'})
        self.assertEqual(a.json('DELETE', '/api/users/%d' % werker['id'])[0], 200)
        self.assertEqual(b.json('GET', '/api/records')[0], 401)

        # logout
        self.assertEqual(a.json('POST', '/api/logout')[0], 200)
        self.assertEqual(a.json('GET', '/api/records')[0], 401)

    def test_throttle_and_static(self):
        c = Client(self.base)
        for _ in range(10):
            c.json('POST', '/api/login', {'username': 'nobody', 'password': 'x'})
        self.assertEqual(c.json('POST', '/api/login', {'username': 'nobody', 'password': 'x'})[0], 429)
        for path in ('/', '/app.js', '/style.css', '/sw.js', '/manifest.webmanifest', '/icon.svg'):
            status, _, headers = c.call('GET', path)
            self.assertEqual(status, 200, path)
            self.assertIn('Content-Security-Policy', headers)
        self.assertEqual(c.call('GET', '/../app.py')[0], 404)


if __name__ == '__main__':
    unittest.main()
