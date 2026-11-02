# Kaveh CMS – Web App

A digital notebook for CMS machine programs: program number, X/Y/Z values, notes and **any number of tile photos**.
It runs on a server, so data is the same on phone, tablet and PC. Each user signs in with a username and password.

This replaces the offline prototype (`Kaveh_CMS_Starter.zip`). That version kept everything in browser `localStorage`
(~5 MB), so it failed after about two photos, and data existed only on one device.

## Features

- Accounts with username and password. **The first account created becomes the administrator.**
  Admins can add users, reset passwords, grant or remove admin rights and delete users (menu **Konto**).
  Public sign-up is off by default (see `KCMS_ALLOW_REGISTRATION`).
- Each user has their own private list of programs.
- Unlimited photos per program. Photos are shrunk in the browser before upload (max. 2400 px, location data stripped),
  stored on the server, and shown as a gallery with a full-screen viewer (swipe or arrow keys) and download.
- Edit mode: remove photos, change photo order, add more photos.
- Search by program number or keyword in the notes, plus a filter on the list.
- Backup: export everything (programs and photos) as one ZIP file; import it again on any account.
  Backups from the old offline prototype (`kaveh-cms-backup.json`) can also be imported.
- Installable as a home-screen app (PWA). When offline, the last loaded list and viewed photos stay readable.
- Security: scrypt password hashing, HttpOnly session cookies (30 days), login rate limiting, CSRF protection,
  content-type checking of uploads, strict Content-Security-Policy.

## Run locally

Needs only Python 3.9+ (no packages required):

```bash
python3 app.py            # → http://localhost:8000
```

Open it and create the first (admin) account. Data is stored in `./data/` (`kaveh-cms.db` + `photos/`).
**Back up this folder.**

Run the tests:

```bash
python3 -m unittest discover -s tests -v
```

Command-line admin tools (for example if the admin password is lost):

```bash
python3 app.py list-users
python3 app.py create-user NAME --admin
python3 app.py set-password NAME
```

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8000` / `0.0.0.0` | Listen address |
| `KCMS_DATA_DIR` | `./data` | Where database and photos are stored (must be persistent) |
| `KCMS_ALLOW_REGISTRATION` | `0` | `1` = anyone can create an account from the login page |
| `KCMS_MAX_PHOTO_MB` | `15` | Max size per photo |
| `KCMS_MAX_IMPORT_MB` | `300` | Max backup file size for import |
| `KCMS_COOKIE_SECURE` | `auto` | `auto` sets the Secure flag when served over HTTPS |
| `KCMS_TRUST_PROXY` | `1` | Use `X-Forwarded-For/Proto` from the reverse proxy |

## Put it online (a real address)

The server needs **persistent storage** for `KCMS_DATA_DIR`. Hosts with a temporary disk (for example
Render's free tier) lose all photos on every restart. Pick one of these:

### Option A – PythonAnywhere (free, no credit card) → `https://USERNAME.pythonanywhere.com`

1. Create an account at pythonanywhere.com.
2. **Files** tab: upload the `kaveh-cms` folder (or upload a zip and unzip it in a **Bash console**), e.g. to `/home/USERNAME/kaveh-cms`.
3. **Web** tab → *Add a new web app* → *Manual configuration* → Python 3.x.
4. Open the *WSGI configuration file* link and replace its contents with:
   ```python
   import sys
   sys.path.insert(0, '/home/USERNAME/kaveh-cms')
   from app import application
   ```
5. In the **Web** tab, turn on *Force HTTPS*, click **Reload**, open the address and create the admin account right away.

On the free tier you click "Run until 3 months from today" in the Web tab every 3 months. Disk space is 512 MB,
which is roughly 1,500–3,000 photos.

### Option B – Your own server/VPS with Docker (around €4/month, own domain, automatic HTTPS)

```bash
# on the server, inside the kaveh-cms folder
echo "DOMAIN=kaveh.example.com" > .env     # DNS A record must point to this server
docker compose up -d
```

Caddy gets a Let's Encrypt certificate automatically. Data is in `./data` next to `docker-compose.yml`.

### Option C – Fly.io (about $2–5/month)

```bash
fly launch --copy-config --no-deploy
fly volumes create kcms_data --size 1
fly deploy
```

→ `https://<app-name>.fly.dev`

## Notes

- Example values are demo data only. Always check them against the approved production data before using a machine.
- Follow your employer's rules on photos and technical production information.
