'use strict';
/* Kaveh CMS – client */

const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const AXES = ['x', 'y', 'z'];
const FIELDS = ['number', 'name', 'setup', 'pointLabel', 'x', 'y', 'z', 'x2', 'y2', 'z2', 'notes'];
const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#ffffff'];
const TOOL_NAMES = { arrow: 'Pfeil', circle: 'Kreis', text: 'Text', line: 'Linie' };

const state = {
  status: null, user: null, records: [], offline: false, view: null,
  current: null,      // record shown on the program sheet (same object as in state.records)
  photoIdx: 0,
  dirty: false,
  authMode: 'login',
};

/* ================================================================ helpers */

const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-3.6-3.6',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  cloud: 'M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 9a4.5 4.5 0 0 1-.5 9H7zM12 17v-6M9.5 13.5L12 11l2.5 2.5',
  printer: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  home: 'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',
  file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6',
  plus: 'M12 5v14M5 12h14',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  help: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4M12 17.5h.01',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chevleft: 'M15 18l-6-6 6-6',
  chevright: 'M9 18l6-6-6-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  sync: 'M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  dots: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  arrow: 'M5 19L19 5M10 5h9v9',
  circle: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  line: 'M5 19L19 5',
  eraser: 'M9 20h11M5.6 15.4l8.8-8.8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H9.2zM9.5 11.5l5 5',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  pdf: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 11v6M9.5 14.5L12 17l2.5-2.5',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14',
  upload: 'M12 20V9M7.5 13.5L12 9l4.5 4.5M5 4h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 8.5h.01',
  clip: 'M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8.3-8.3',
  pin: 'M12 17v5M5 17h14l-2-4V5h1V3H6v2h1v8z',
  x: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
};

function icon(name) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', ICONS[name] || '');
  if (name === 'dots') path.setAttribute('stroke-width', '3.2');
  svg.append(path);
  return svg;
}

function hydrateIcons(root) {
  root.querySelectorAll('[data-icon]').forEach(n => { n.prepend(icon(n.dataset.icon)); n.removeAttribute('data-icon'); });
}

function axesLogo(labels = true) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<g stroke-width="6" stroke-linecap="round" fill="none">' +
    '<path d="M42 60V16" stroke="#1e74e0"/><path d="M42 60L82 45" stroke="#2e9d4b"/><path d="M42 60L18 84" stroke="#e53935"/></g>' +
    '<path d="M42 5l-8 14h16z" fill="#1e74e0"/><path d="M92 41l-13 13-3-16z" fill="#2e9d4b"/><path d="M10 92l4-17 13 13z" fill="#e53935"/>' +
    '<circle cx="42" cy="60" r="5" fill="#8fa6c4"/>' +
    (labels ? '<g font-family="Arial,sans-serif" font-weight="700" font-size="17">' +
      '<text x="53" y="18" fill="#1e74e0">Z</text><text x="84" y="70" fill="#2e9d4b">Y</text><text x="2" y="72" fill="#e53935">X</text></g>' : '');
  return svg;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
}

async function api(path, { method = 'GET', json, body, headers = {}, keepalive = false } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin', keepalive };
  if (method !== 'GET') opts.headers['X-KCMS'] = '1';
  if (json !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json); }
  else if (body !== undefined) opts.body = body;
  let res;
  try { res = await fetch(path, opts); }
  catch (e) { throw new ApiError('Keine Verbindung zum Server. Bitte Internetverbindung prüfen.', 0); }
  if (method === 'GET') setOffline(res.headers.get('X-KCMS-Offline') === '1');
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && state.user && !path.startsWith('/api/login')) sessionExpired();
    throw new ApiError(data.error || ('Fehler ' + res.status), res.status, data);
  }
  return data;
}

let toastTimer;
function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
}

function showError(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }

/** Promise-based replacement for confirm()/prompt(). Returns true/false, or the entered text/null. */
function ask(text, { okText = 'OK', danger = false, input = null } = {}) {
  return new Promise(resolve => {
    const dlg = $('askDlg'), inp = $('askInput'), ok = $('askOk');
    $('askText').textContent = text;
    ok.textContent = okText;
    ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    inp.hidden = !input;
    if (input) { inp.type = input.type || 'text'; inp.value = input.value || ''; inp.placeholder = input.placeholder || ''; }
    dlg.returnValue = '';
    dlg.addEventListener('close', () => {
      const confirmed = dlg.returnValue === 'ok';
      resolve(input ? (confirmed ? inp.value : null) : confirmed);
    }, { once: true });
    dlg.showModal();
    if (input) { inp.focus(); inp.select(); } else ok.focus();
  });
}

function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return withTime
    ? d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE');
}
function fmtSize(n) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function recordTitle(r) { return r.number + (r.name ? ' - ' + r.name : ''); }
const byNumber = (a, b) => a.number.localeCompare(b.number, 'de', { numeric: true });
const byId = id => state.records.find(r => r.id === id);

function matches(r, q) {
  q = q.toLowerCase();
  return [r.number, r.name, r.setup, r.notes].some(v => (v || '').toLowerCase().includes(q));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ================================================================ theme */

function themePref() { return document.documentElement.getAttribute('data-theme-pref') || 'system'; }

function applyTheme(pref) {
  try { localStorage.setItem('kcms-theme', pref); } catch (e) { /* storage blocked */ }
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pref', pref);
  document.querySelector('meta[name=theme-color]').content = dark ? '#08101c' : '#0f2747';
  document.querySelectorAll('[data-theme-toggle]').forEach(b => {
    b.replaceChildren(icon(dark ? 'sun' : 'moon'));
    b.title = dark ? 'Helles Design' : 'Dunkles Design';
    b.setAttribute('aria-label', b.title);
  });
  document.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('active', b.dataset.themeSet === pref));
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-theme-toggle]');
  if (t) applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  const s = e.target.closest('[data-theme-set]');
  if (s) applyTheme(s.dataset.themeSet);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themePref() === 'system') applyTheme('system'); });

/* ================================================================ images */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = src;
  });
}

function scaleToJpeg(img, maxSide, quality) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const s = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * s));
  canvas.height = Math.max(1, Math.round(h * s));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(b => resolve({ blob: b, width: canvas.width, height: canvas.height }), 'image/jpeg', quality));
}

/** Shrink a photo before upload (saves bandwidth and storage, strips EXIF/GPS). Falls back to the original. */
async function preparePhoto(file) {
  if (file.type === 'image/gif') return { full: file, thumb: null, width: 0, height: 0 };
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const full = await scaleToJpeg(img, 2400, 0.86);
    const thumb = await scaleToJpeg(img, 480, 0.75);
    if (!full.blob) throw new Error('encode');
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } catch (e) {
    return { full: file, thumb: null, width: 0, height: 0 };
  } finally { URL.revokeObjectURL(url); }
}

/* ================================================================ annotations (drawn on top of photos) */

function photoDims(p) { return p && p.width && p.height ? [p.width, p.height] : null; }

/** SVG element for one annotation. Coordinates are stored normalised (0..1) and drawn in image pixels. */
function shapeEl(a, W, H, index) {
  const sw = Math.max(W, H) * 0.006;
  const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
  const g = svgEl('g', { class: 'shape', 'data-i': index });
  const stroke = { stroke: a.c, 'stroke-width': sw, 'stroke-linecap': 'round', fill: 'none' };
  const hit = { stroke: 'transparent', 'stroke-width': sw * 5, fill: 'none' };
  if (a.t === 'line' || a.t === 'arrow') {
    let ex = x2, ey = y2;
    if (a.t === 'arrow') {
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const head = Math.min(sw * 5, len * 0.6), half = head * 0.55;
      ex = x2 - ux * head * 0.8; ey = y2 - uy * head * 0.8;
      const bx = x2 - ux * head, by = y2 - uy * head;
      g.append(svgEl('polygon', { points: `${x2},${y2} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`, fill: a.c }));
    }
    g.prepend(svgEl('line', { x1, y1, x2: ex, y2: ey, ...stroke }));
    g.append(svgEl('line', { x1, y1, x2, y2, ...hit }));
  } else if (a.t === 'circle') {
    const r = Math.hypot(x2 - x1, y2 - y1);
    g.append(svgEl('circle', { cx: x1, cy: y1, r, ...stroke }), svgEl('circle', { cx: x1, cy: y1, r, ...hit }));
  } else if (a.t === 'text') {
    const fs = Math.max(W, H) * 0.04;
    const t = svgEl('text', { x: x1, y: y1, 'font-size': fs, 'font-family': 'Kalam, cursive', 'font-weight': 700, fill: a.c,
      stroke: a.c === '#ffffff' || a.c === '#fdd835' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.75)', 'stroke-width': fs * 0.1,
      'paint-order': 'stroke', 'dominant-baseline': 'middle' });
    t.textContent = a.text;
    g.append(t);
  }
  return g;
}

function renderOverlay(svg, photo, { cover = false, extra = null } = {}) {
  svg.replaceChildren();
  const d = photoDims(photo);
  if (!d) return;
  const [W, H] = d;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', cover ? 'xMidYMid slice' : 'xMidYMid meet');
  (photo.annotations || []).forEach((a, i) => svg.append(shapeEl(a, W, H, i)));
  if (extra) svg.append(shapeEl(extra, W, H, -1));
}

function drawShapesOnCanvas(ctx, annotations, W, H) {
  const sw = Math.max(W, H) * 0.006;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const a of annotations) {
    const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
    ctx.strokeStyle = ctx.fillStyle = a.c;
    ctx.lineWidth = sw;
    if (a.t === 'line' || a.t === 'arrow') {
      let ex = x2, ey = y2;
      if (a.t === 'arrow') {
        const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        const head = Math.min(sw * 5, len * 0.6), half = head * 0.55, bx = x2 - ux * head, by = y2 - uy * head;
        ex = x2 - ux * head * 0.8; ey = y2 - uy * head * 0.8;
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(bx - uy * half, by + ux * half); ctx.lineTo(bx + uy * half, by - ux * half); ctx.closePath(); ctx.fill();
      }
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
    } else if (a.t === 'circle') {
      ctx.beginPath(); ctx.arc(x1, y1, Math.hypot(x2 - x1, y2 - y1), 0, Math.PI * 2); ctx.stroke();
    } else if (a.t === 'text') {
      const fs = Math.max(W, H) * 0.04;
      ctx.font = `700 ${fs}px Kalam, cursive`;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = fs * 0.1;
      ctx.strokeStyle = a.c === '#ffffff' || a.c === '#fdd835' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.75)';
      ctx.strokeText(a.text, x1, y1);
      ctx.fillText(a.text, x1, y1);
    }
  }
}

/** Thumbnail button with the photo's markings drawn on top. */
function thumbEl(p, { active = false, onclick } = {}) {
  const svg = svgEl('svg', { class: 'overlay' });
  renderOverlay(svg, p, { cover: true });
  return el('button', { type: 'button', class: 'tthumb' + (active ? ' active' : ''), onclick, 'aria-label': 'Foto anzeigen' },
    el('img', { src: p.thumb, alt: '', loading: 'lazy' }), svg);
}

/* ================================================================ auth */

async function boot() {
  hydrateIcons(document);
  document.querySelectorAll('[data-logo]').forEach(n => n.append(axesLogo(true)));
  document.querySelectorAll('[data-axes]').forEach(n => n.append(axesLogo(true)));
  applyTheme(themePref());
  try {
    state.status = await api('/api/status');
  } catch (e) {
    showAuth('login', e.message);
    return;
  }
  if (state.status.user) startApp(state.status.user);
  else showAuth(state.status.needsSetup ? 'setup' : 'login');
}

function showAuth(mode, message) {
  state.authMode = mode;
  $('appView').hidden = true;
  $('authView').hidden = false;
  const reg = mode !== 'login';
  $('authTitle').textContent = mode === 'setup' ? 'Ersten Administrator anlegen' : mode === 'register' ? 'Konto erstellen' : 'Anmelden';
  $('authIntro').textContent = mode === 'setup'
    ? 'Willkommen! Lege jetzt das erste Konto an. Es erhält Administratorrechte und kann weitere Benutzer anlegen.'
    : mode === 'register' ? 'Wähle einen Benutzernamen und ein Passwort (mind. 8 Zeichen).'
      : 'Melde dich mit deinem Benutzernamen und Passwort an.';
  $('authSubmit').textContent = reg ? 'Konto erstellen' : 'Anmelden';
  $('authPass2Wrap').hidden = !reg;
  $('authPass').autocomplete = reg ? 'new-password' : 'current-password';
  $('authSwitchWrap').hidden = !(state.status && state.status.registrationOpen && mode !== 'setup');
  $('authSwitch').textContent = mode === 'register' ? 'Ich habe schon ein Konto – anmelden' : 'Neues Konto erstellen';
  showError('authError', message);
  $('authUser').focus();
}

$('authSwitch').addEventListener('click', e => { e.preventDefault(); showAuth(state.authMode === 'register' ? 'login' : 'register'); });

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('authError');
  const username = $('authUser').value.trim(), password = $('authPass').value;
  const register = state.authMode !== 'login';
  if (register && password !== $('authPass2').value) return showError('authError', 'Die Passwörter stimmen nicht überein.');
  const btn = $('authSubmit');
  btn.disabled = true;
  try {
    const data = await api(register ? '/api/register' : '/api/login', { method: 'POST', json: { username, password } });
    $('authForm').reset();
    state.status = { ...(state.status || {}), needsSetup: false };
    startApp(data.user);
  } catch (err) {
    showError('authError', err.message);
  } finally { btn.disabled = false; }
});

function sessionExpired() {
  state.user = null;
  showAuth('login', 'Deine Sitzung ist abgelaufen. Bitte erneut anmelden.');
}

$('logoutBtn').addEventListener('click', async () => {
  await flushAll();
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  if (window.caches) { try { await caches.delete('kaveh-cms-data'); } catch (e) { /* ignore */ } }
  state.user = null; state.records = []; state.current = null;
  $('userPop').hidden = true;
  history.replaceState(null, '', '#/');
  showAuth('login');
});

async function startApp(user) {
  state.user = user;
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('userName').textContent = user.username;
  $('userRole').textContent = user.isAdmin ? 'Administrator' : 'Benutzer';
  $('avatarBtn').textContent = user.username.slice(0, 2).toUpperCase();
  try { if (localStorage.getItem('kcms-collapsed') === '1') $('appView').classList.add('collapsed'); } catch (e) { /* ignore */ }
  await refresh();
  route();
}

/* ================================================================ data */

async function refresh() {
  try {
    state.records = (await api('/api/records')).records;
  } catch (e) {
    if (e.status !== 401) toast(e.message, true);
  }
  renderSidebar();
}

/** Insert or update a record in the local list, keeping object identity. */
function upsert(record) {
  const existing = byId(record.id);
  if (existing) return Object.assign(existing, record);
  state.records.unshift(record);
  return record;
}

/* ================================================================ routing & shell */

window.addEventListener('hashchange', route);

async function route() {
  if (!state.user) return;
  const h = location.hash || '#/';
  closeNav();
  closeSearch();
  const m = h.match(/^#\/p\/(\d+)/);
  if (state.view === 'program' && (!m || +m[1] !== (state.current && state.current.id))) await leaveProgram();
  if (m) return openProgram(+m[1]);
  const view = { '#/programme': 'list', '#/backup': 'backup', '#/einstellungen': 'settings', '#/hilfe': 'help' }[h] || 'home';
  showView(view);
}

function showView(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  $('content').scrollTop = 0;
  if (name === 'home') renderHome();
  if (name === 'list') renderList();
  if (name === 'settings') renderSettings();
  if (name !== 'program') renderSidebar();
}

function renderSidebar() {
  const q = $('sideFilter').value.trim();
  const list = [...state.records].filter(r => !q || matches(r, q)).sort(byNumber);
  $('sideCount').textContent = state.records.length;
  $('statusCount').textContent = plural(state.records.length, 'Programm', 'Programme');
  const box = $('sideItems');
  if (!list.length) {
    box.replaceChildren(el('div', { class: 'none', text: state.records.length ? 'Keine Treffer.' : 'Noch keine Programme.' }));
    return;
  }
  const currentId = state.view === 'program' && state.current ? state.current.id : null;
  box.replaceChildren(...list.map(r => el('a', { href: '#/p/' + r.id, class: r.id === currentId ? 'active' : null, title: recordTitle(r) },
    icon('file'), el('span', { text: recordTitle(r) }))));
}
const renderSidebarSoon = debounce(renderSidebar, 300);
$('sideFilter').addEventListener('input', renderSidebar);

$('collapseBtn').addEventListener('click', () => {
  const on = $('appView').classList.toggle('collapsed');
  try { localStorage.setItem('kcms-collapsed', on ? '1' : '0'); } catch (e) { /* ignore */ }
});
$('menuBtn').addEventListener('click', () => $('appView').classList.add('navopen'));
$('scrim').addEventListener('click', closeNav);
function closeNav() { $('appView').classList.remove('navopen'); }

$('avatarBtn').addEventListener('click', e => { e.stopPropagation(); $('userPop').hidden = !$('userPop').hidden; });
document.addEventListener('click', e => {
  const closer = e.target.closest('[data-close]');
  if (closer) closer.closest('dialog').close('cancel');
  if (!e.target.closest('.usermenu')) $('userPop').hidden = true;
  if (!e.target.closest('#photoMenu') && !e.target.closest('[data-menu-btn]')) $('photoMenu').hidden = true;
  if (!e.target.closest('.globalsearch')) closeSearch();
});

function setOffline(off) {
  if (state.offline === off) return;
  state.offline = off;
  $('offlineBar').hidden = !off;
  if (state.view === 'program') applyReadOnly();
}
window.addEventListener('online', () => { if (state.user) refresh(); });

/* ---- save indicator */
function setSave(kind, text) {
  const s = $('saveState');
  s.dataset.state = kind;
  s.querySelector('svg').replaceWith(icon({ saved: 'check', saving: 'sync', dirty: 'edit', error: 'alert' }[kind]));
  $('saveText').textContent = text || { saved: 'Gespeichert', saving: 'Speichert …', dirty: 'Ungespeicherte Änderungen', error: 'Nicht gespeichert' }[kind];
  s.title = kind === 'error' ? (text || '') : '';
}

/* ================================================================ global search */

let searchSel = 0;
function closeSearch() { $('searchDrop').hidden = true; }

function renderSearch() {
  const q = $('globalSearch').value.trim();
  const drop = $('searchDrop');
  if (!q) { drop.hidden = true; return; }
  const hits = state.records.filter(r => matches(r, q)).sort((a, b) =>
    (b.number.toLowerCase().startsWith(q.toLowerCase())) - (a.number.toLowerCase().startsWith(q.toLowerCase())) || byNumber(a, b)).slice(0, 8);
  searchSel = Math.min(searchSel, Math.max(0, hits.length - 1));
  drop.replaceChildren(...(hits.length ? hits.map((r, i) => el('button', { type: 'button', class: i === searchSel ? 'active' : null,
    onclick: () => { $('globalSearch').value = ''; closeSearch(); location.hash = '#/p/' + r.id; } },
    icon('file'), el('span', {}, el('b', { text: r.number }), r.name ? ' – ' + r.name : '', el('small', { text: 'Geändert ' + fmtDate(r.updatedAt) }))))
    : [el('div', { class: 'none', text: 'Kein Programm gefunden.' }),
      el('button', { type: 'button', onclick: () => { closeSearch(); openNewDialog(q); } }, icon('plus'), el('span', { text: 'Neues Programm „' + q + '“ anlegen' }))]));
  drop.hidden = false;
}

$('globalSearch').addEventListener('input', () => { searchSel = 0; renderSearch(); });
$('globalSearch').addEventListener('focus', renderSearch);
$('globalSearch').addEventListener('keydown', e => {
  const buttons = [...$('searchDrop').querySelectorAll('button')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % Math.max(1, buttons.length);
    buttons.forEach((b, i) => b.classList.toggle('active', i === searchSel));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const q = $('globalSearch').value.trim();
    const exact = state.records.find(r => r.number.toLowerCase() === q.toLowerCase());
    if (exact) { $('globalSearch').value = ''; closeSearch(); location.hash = '#/p/' + exact.id; }
    else if (buttons[searchSel]) buttons[searchSel].click();
  } else if (e.key === 'Escape') { closeSearch(); e.target.blur(); }
});

/* ================================================================ home & list */

function cardEl(r) {
  const p = r.photos[0];
  return el('a', { class: 'pcard', href: '#/p/' + r.id },
    el('div', { class: 'pimg' }, p ? [el('img', { src: p.thumb, alt: '', loading: 'lazy' }), (() => { const s = svgEl('svg', { class: 'overlay' }); renderOverlay(s, p, { cover: true }); return s; })()] : icon('image')),
    el('div', { class: 'pbody' },
      el('b', { text: r.number }),
      el('div', { class: 'pname', text: r.name || r.notes.split('\n')[0] || '—' }),
      el('div', { class: 'pmeta' },
        el('span', { text: plural(r.photos.length, 'Foto', 'Fotos') }),
        r.files.length ? el('span', { text: plural(r.files.length, 'Anhang', 'Anhänge') }) : null,
        el('span', { text: fmtDate(r.updatedAt, false) }))));
}

function renderHome() {
  const hour = new Date().getHours();
  $('homeHello').textContent = (hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend') + ', ' + state.user.username;
  const photos = state.records.reduce((n, r) => n + r.photos.length, 0);
  const marks = state.records.reduce((n, r) => n + r.photos.reduce((m, p) => m + (p.annotations || []).length, 0), 0);
  const files = state.records.reduce((n, r) => n + r.files.length, 0);
  const stat = (ic, n, label) => el('div', { class: 'stat' }, el('span', { class: 'ico' }, icon(ic)), el('div', {}, el('b', { text: n }), el('span', { text: label })));
  $('homeStats').replaceChildren(stat('file', state.records.length, 'Programme'), stat('image', photos, 'Fotos'),
    stat('arrow', marks, 'Markierungen'), stat('clip', files, 'Anhänge'));
  const recent = [...state.records].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8);
  $('homeRecent').replaceChildren(...(recent.length ? recent.map(cardEl) : [el('div', { class: 'emptybox' },
    el('p', { text: 'Noch keine Programme gespeichert.' }),
    el('button', { type: 'button', class: 'btn primary', onclick: () => openNewDialog() }, icon('plus'), 'Erstes Programm anlegen'))]));
}

function renderList() {
  const q = $('listFilter').value.trim();
  const sort = $('listSort').value;
  let list = state.records.filter(r => !q || matches(r, q));
  list = [...list].sort(sort === 'number' ? byNumber : sort === 'name'
    ? (a, b) => (a.name || '~').localeCompare(b.name || '~', 'de') || byNumber(a, b)
    : (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('listCount').textContent = plural(state.records.length, 'Programm', 'Programme') + (q ? ' · ' + list.length + ' Treffer' : '');
  $('listCards').replaceChildren(...(list.length ? list.map(cardEl)
    : [el('div', { class: 'emptybox', text: state.records.length ? 'Keine Programme passen zum Filter.' : 'Noch keine Programme gespeichert.' })]));
}
$('listFilter').addEventListener('input', renderList);
$('listSort').addEventListener('change', renderList);

/* ================================================================ new program */

function openNewDialog(number = '') {
  closeNav();
  $('newForm').reset();
  $('newNumber').value = number;
  showError('newError');
  $('newDlg').showModal();
  $(number ? 'newName' : 'newNumber').focus();
}
document.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openNewDialog()));
$('navNew').addEventListener('click', () => openNewDialog());

$('newForm').addEventListener('submit', async e => {
  if (!e.submitter || e.submitter.value !== 'ok') return;
  e.preventDefault();
  const number = $('newNumber').value.trim();
  if (!number) { showError('newError', 'Bitte eine Programmnummer eingeben.'); return; }
  $('newOk').disabled = true;
  try {
    const { record } = await api('/api/records', { method: 'POST', json: { number, name: $('newName').value.trim() } });
    upsert(record);
    $('newDlg').close();
    location.hash = '#/p/' + record.id;
  } catch (err) {
    if (err.status === 409 && err.data.recordId) {
      $('newDlg').close();
      toast('Programm ' + number + ' existiert bereits – geöffnet.');
      location.hash = '#/p/' + err.data.recordId;
    } else showError('newError', err.message);
  } finally { $('newOk').disabled = false; }
});

/* ================================================================ program sheet */

function buildAxes() {
  document.querySelectorAll('.axis').forEach(box => {
    const a = box.dataset.axis, A = a.toUpperCase();
    const row = (label, field, chg) => el('div', { class: 'axrow' },
      el('label', { for: 'f_' + field, text: label }),
      el('div', { class: 'unitinput' + (chg ? ' chg' : '') },
        el('input', { id: 'f_' + field, 'data-field': field, inputmode: 'decimal', autocomplete: 'off', 'aria-label': A + ' ' + label })));
    box.replaceChildren(el('div', { class: 'axbadge', text: A }), row('Original', a), row('Geändert', a + '2', true),
      el('div', { class: 'delta', id: 'delta_' + a }));
  });
}

function num(v) {
  const s = String(v || '').trim().replace(/\s/g, '').replace(',', '.');
  return s && /^[-+]?\d*\.?\d+$/.test(s) ? parseFloat(s) : null;
}

function renderDeltas() {
  for (const a of AXES) {
    const o = $('f_' + a).value, c = $('f_' + a + '2').value;
    const d = $('delta_' + a);
    const no = num(o), nc = num(c);
    if (no == null || nc == null) { d.textContent = ''; d.className = 'delta'; continue; }
    const diff = Math.round((nc - no) * 1000) / 1000;
    const comma = (o + c).includes(',');
    let txt = (diff > 0 ? '+' : diff < 0 ? '−' : '±') + Math.abs(diff).toString();
    if (comma) txt = txt.replace('.', ',');
    d.textContent = 'Δ ' + txt + ' mm';
    d.className = 'delta' + (diff > 0 ? ' up' : diff < 0 ? ' down' : '');
  }
}

async function openProgram(id) {
  let r = byId(id);
  if (!r) {
    try { r = upsert((await api('/api/records/' + id)).record); }
    catch (e) { toast(e.message, true); location.hash = '#/'; return; }
  }
  const same = state.current && state.current.id === id;
  state.current = r;
  if (!same) { state.photoIdx = 0; undo.stack = []; setTool(null); }
  showView('program');
  for (const f of FIELDS) {
    const input = document.querySelector(`[data-field="${f}"]`);
    if (input) input.value = r[f] || '';
  }
  $('fNumber').classList.remove('invalid');
  state.dirty = false;
  setSave('saved');
  renderDeltas();
  renderInfo();
  renderPhotos();
  renderAttachments();
  applyReadOnly();
  renderSidebar();
  document.title = recordTitle(r) + ' · Kaveh CMS';
}

async function leaveProgram() {
  await flushAll();
  setTool(null);
  state.current = null;
  document.title = 'Kaveh CMS';
}

function applyReadOnly() {
  const ro = state.offline;
  document.querySelectorAll('#sheet [data-field]').forEach(i => { i.readOnly = ro; });
  $('tools').classList.toggle('disabled', ro);
  ['photoInput', 'attachInput'].forEach(id => { $(id).disabled = ro; });
}

function renderInfo() {
  const r = state.current;
  $('infoCreated').textContent = fmtDate(r.createdAt);
  $('infoUpdated').textContent = fmtDate(r.updatedAt);
  $('infoEditor').textContent = r.editor || state.user.username;
}

/* ---- autosave of the text fields */
const save = { timer: null, inflight: null, again: false };

document.addEventListener('input', e => {
  const f = e.target.dataset && e.target.dataset.field;
  if (!f || !state.current || !e.target.closest('#sheet')) return;
  state.current[f] = e.target.value;
  if (f === 'number') $('fNumber').classList.remove('invalid');
  if (AXES.includes(f.replace('2', ''))) renderDeltas();
  if (f === 'number' || f === 'name') renderSidebarSoon();
  state.dirty = true;
  setSave('dirty');
  clearTimeout(save.timer);
  save.timer = setTimeout(flushSave, 900);
});
document.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.field && state.dirty) flushSave(); });

function flushSave() {
  clearTimeout(save.timer);
  const r = state.current;
  if (!state.dirty || !r) return save.inflight || Promise.resolve();
  if (save.inflight) { save.again = true; return save.inflight; }
  if (!r.number.trim()) { setSave('error', 'Programmnummer fehlt'); $('fNumber').classList.add('invalid'); return Promise.resolve(); }
  const fields = {};
  for (const f of FIELDS) fields[f] = r[f] || '';
  state.dirty = false;
  setSave('saving');
  save.inflight = api('/api/records/' + r.id, { method: 'PUT', json: fields, keepalive: true })
    .then(({ record }) => {
      r.updatedAt = record.updatedAt; r.editor = record.editor;
      if (state.current === r) { renderInfo(); setSave(state.dirty ? 'dirty' : 'saved'); document.title = recordTitle(r) + ' · Kaveh CMS'; }
      renderSidebar();
    })
    .catch(err => {
      state.dirty = true;
      setSave('error', err.message);
      if (err.status === 409) $('fNumber').classList.add('invalid');
      toast(err.message, true);
    })
    .finally(() => {
      save.inflight = null;
      if (save.again) { save.again = false; if (state.dirty) flushSave(); }
    });
  return save.inflight;
}

async function flushAll() {
  await Promise.all([flushSave(), flushAnnotations()]);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
window.addEventListener('beforeunload', e => { if (state.dirty) { flushSave(); e.preventDefault(); } });

/* ---- photos */

function curPhoto() { return state.current && state.current.photos[state.photoIdx]; }

function renderPhotos() {
  const r = state.current;
  const photos = r.photos;
  if (state.photoIdx >= photos.length) state.photoIdx = Math.max(0, photos.length - 1);
  const p = curPhoto();
  $('stage').hidden = !p;
  $('dropzone').hidden = !!p;
  $('tools').classList.toggle('disabled', !p || state.offline);
  if (p) {
    const img = $('stageImg');
    if (img.dataset.id !== p.id) {
      img.dataset.id = p.id;
      $('stageSvg').replaceChildren();
      img.src = p.url;
    }
    renderStageOverlay();
    $('stagePrev').disabled = state.photoIdx === 0;
    $('stageNext').disabled = state.photoIdx >= photos.length - 1;
    $('stageCap').textContent = 'Bild ' + (state.photoIdx + 1) + ' von ' + photos.length + (p.caption ? ' · ' + p.caption : '');
  } else {
    $('stageImg').removeAttribute('src');
    $('stageImg').dataset.id = '';
    $('stageCap').textContent = '';
  }
  $('thumbCol').replaceChildren(...photos.map((ph, i) => thumbEl(ph, { active: i === state.photoIdx, onclick: () => selectPhoto(i) })),
    el('label', { class: 'tthumb add', for: 'photoInput', title: 'Fotos hinzufügen' }, icon('plus')));
  renderPhotoList();
  renderMarks();
}

function renderStageOverlay(extra) {
  const p = curPhoto();
  if (p) renderOverlay($('stageSvg'), p, { extra });
}

$('stageImg').addEventListener('load', () => {
  const p = curPhoto();
  const img = $('stageImg');
  if (!p || img.dataset.id !== p.id || photoDims(p)) return;
  // photos uploaded before sizes were recorded: remember the size once
  p.width = img.naturalWidth; p.height = img.naturalHeight;
  renderStageOverlay();
  api('/api/photos/' + p.id, { method: 'PUT', json: { width: p.width, height: p.height } }).catch(() => {});
});

function selectPhoto(i) {
  flushAnnotations();
  state.photoIdx = i;
  undo.stack = [];
  renderPhotos();
}

function renderPhotoList() {
  const r = state.current;
  const box = $('photoList');
  if (!r.photos.length) { box.replaceChildren(el('p', { class: 'none', text: 'Noch keine Fotos.' })); return; }
  box.replaceChildren(...r.photos.map((p, i) => el('div', { class: 'pitem' + (i === state.photoIdx ? ' active' : ''), onclick: e => { if (!e.target.closest('.pacts')) selectPhoto(i); } },
    thumbEl(p, { onclick: () => selectPhoto(i) }),
    el('div', {},
      el('div', { class: 'pname', text: (i + 1) + '. ' + (p.caption || 'Foto') }),
      el('div', { class: 'pacts' },
        el('button', { type: 'button', class: 'iconbtn', title: 'Markieren', 'aria-label': 'Foto markieren', disabled: state.offline,
          onclick: () => { selectPhoto(i); if (!draw.tool) setTool('arrow'); $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, icon('edit')),
        el('button', { type: 'button', class: 'iconbtn', title: 'Löschen', 'aria-label': 'Foto löschen', disabled: state.offline, onclick: () => deletePhoto(p) }, icon('trash')),
        el('button', { type: 'button', class: 'iconbtn', title: 'Mehr', 'aria-label': 'Weitere Aktionen', 'data-menu-btn': '1', onclick: e => openPhotoMenu(e.currentTarget, i) }, icon('dots')))))));
}

function renderMarks() {
  const p = curPhoto();
  const counts = { arrow: 0, circle: 0, text: 0, line: 0 };
  if (p) for (const a of p.annotations || []) counts[a.t]++;
  $('markList').replaceChildren(...Object.keys(counts).map(t => el('button', { type: 'button', disabled: !p || state.offline,
    onclick: () => setTool(t), title: TOOL_NAMES[t] + ' auswählen' },
  icon(t), el('span', { text: TOOL_NAMES[t] + ' (' + counts[t] + ')' }), el('span', { class: 'chev' }, icon('chevright')))));
}

$('stagePrev').addEventListener('click', () => selectPhoto(Math.max(0, state.photoIdx - 1)));
$('stageNext').addEventListener('click', () => selectPhoto(Math.min(state.current.photos.length - 1, state.photoIdx + 1)));
$('stageZoom').addEventListener('click', () => openViewer(state.current.photos, state.photoIdx));

$('photoInput').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; uploadPhotos(files); });
$('dropzone').addEventListener('click', () => $('photoInput').click());
for (const zone of ['dropzone', 'stage', 'thumbCol']) {
  const z = $(zone);
  z.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); z.classList.add('over'); } });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('over'); uploadPhotos([...e.dataTransfer.files]); });
}

async function uploadPhotos(files) {
  const r = state.current;
  if (!r || state.offline) return;
  files = files.filter(f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name));
  if (!files.length) { toast('Bitte Bilddateien auswählen.', true); return; }
  const problems = [];
  for (let i = 0; i < files.length; i++) {
    setSave('saving', 'Foto ' + (i + 1) + '/' + files.length + ' wird hochgeladen …');
    try {
      const { full, thumb, width, height } = await preparePhoto(files[i]);
      const fd = new FormData();
      fd.append('photo', full, 'photo.jpg');
      if (thumb) fd.append('thumb', thumb, 'thumb.jpg');
      fd.append('width', String(width));
      fd.append('height', String(height));
      const res = await api('/api/records/' + r.id + '/photos', { method: 'POST', body: fd });
      r.photos = res.photos;
      r.updatedAt = new Date().toISOString(); r.editor = state.user.username;
      if (state.current === r) { state.photoIdx = r.photos.length - 1; renderPhotos(); renderInfo(); }
    } catch (err) {
      problems.push((files[i].name || 'Foto') + ': ' + err.message);
    }
  }
  if (problems.length) { setSave('error', 'Nicht alle Fotos hochgeladen'); toast(problems.join('\n'), true); }
  else { setSave(state.dirty ? 'dirty' : 'saved'); toast(plural(files.length, 'Foto', 'Fotos') + ' gespeichert.'); }
}

async function deletePhoto(p) {
  const r = state.current;
  if (!await ask('Dieses Foto samt Markierungen löschen?', { okText: 'Löschen', danger: true })) return;
  try {
    await api('/api/photos/' + p.id, { method: 'DELETE' });
    r.photos = r.photos.filter(x => x.id !== p.id);
    if (state.current === r) renderPhotos();
    toast('Foto gelöscht.');
  } catch (err) { toast(err.message, true); }
}

async function movePhoto(i, d) {
  const r = state.current;
  const j = i + d;
  if (j < 0 || j >= r.photos.length) return;
  const photos = [...r.photos];
  [photos[i], photos[j]] = [photos[j], photos[i]];
  try {
    const res = await api('/api/records/' + r.id + '/photo-order', { method: 'PUT', json: { order: photos.map(p => p.id) } });
    r.photos = res.photos;
    state.photoIdx = j;
    renderPhotos();
  } catch (err) { toast(err.message, true); }
}

async function captionPhoto(p) {
  const text = await ask('Bildbeschriftung:', { okText: 'Speichern', input: { value: p.caption, placeholder: 'z. B. Anpassung am Halter' } });
  if (text == null) return;
  try {
    const { photo } = await api('/api/photos/' + p.id, { method: 'PUT', json: { caption: text } });
    p.caption = photo.caption;
    renderPhotos();
  } catch (err) { toast(err.message, true); }
}

function openPhotoMenu(btn, i) {
  const p = state.current.photos[i];
  const menu = $('photoMenu');
  const item = (ic, label, fn, disabled) => el('button', { type: 'button', class: 'popitem', disabled, onclick: () => { menu.hidden = true; fn(); } }, icon(ic), label);
  const ro = state.offline;
  menu.replaceChildren(
    item('tag', 'Beschriften …', () => captionPhoto(p), ro),
    item('up', 'Nach vorne', () => movePhoto(i, -1), ro || i === 0),
    item('down', 'Nach hinten', () => movePhoto(i, 1), ro || i === state.current.photos.length - 1),
    item('expand', 'Vollbild', () => openViewer(state.current.photos, i)),
    item('download', 'Original herunterladen', () => { const a = el('a', { href: p.url + '?download=1', download: '' }); a.click(); }),
    item('image', 'Mit Markierungen speichern', () => saveAnnotatedImage(p, i)));
  menu.hidden = false;
  const rect = btn.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(rect.right - mw, innerWidth - mw - 8)) + 'px';
  menu.style.top = (rect.bottom + mh + 8 > innerHeight ? rect.top - mh - 6 : rect.bottom + 6) + 'px';
}

/* ---- drawing */

const draw = { tool: null, color: COLORS[0], active: null, pointer: null };
const undo = { stack: [] };
const pendingAnn = new Map(); // photo id -> annotations not yet saved
let annTimer;

function buildColors() {
  $('colors').replaceChildren(...COLORS.map(c => el('button', { type: 'button', 'data-color': c, title: 'Farbe', 'aria-label': 'Farbe ' + c,
    style: 'background:' + c, class: c === draw.color ? 'active' : null,
    onclick: () => { draw.color = c; $('colors').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.color === c)); if (!draw.tool || draw.tool === 'eraser') setTool('arrow'); } })));
}

const TOOL_HINTS = {
  arrow: 'Auf dem Foto vom Anfang zur Spitze ziehen.',
  line: 'Auf dem Foto ziehen, um eine Linie zu zeichnen.',
  circle: 'Im Mittelpunkt ansetzen und nach außen ziehen.',
  text: 'Auf das Foto tippen, wo der Text stehen soll.',
  eraser: 'Markierung antippen, um sie zu löschen.',
};

function setTool(t) {
  draw.tool = draw.tool === t ? null : t;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === draw.tool));
  const stage = $('stage');
  stage.classList.toggle('drawing', !!draw.tool && draw.tool !== 'eraser');
  stage.classList.toggle('erasing', draw.tool === 'eraser');
  $('toolHint').textContent = draw.tool ? TOOL_HINTS[draw.tool] : 'Werkzeug wählen, um das Foto zu markieren.';
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

function svgPoint(e) {
  const svg = $('stageSvg');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const [W, H] = photoDims(curPhoto());
  return { x: Math.min(1, Math.max(0, p.x / W)), y: Math.min(1, Math.max(0, p.y / H)) };
}

function changeAnnotations(p, next) {
  undo.stack.push({ id: p.id, before: p.annotations || [] });
  if (undo.stack.length > 50) undo.stack.shift();
  p.annotations = next;
  pendingAnn.set(p.id, p);
  setSave('dirty');
  clearTimeout(annTimer);
  annTimer = setTimeout(flushAnnotations, 600);
  renderPhotos();
}

function flushAnnotations() {
  clearTimeout(annTimer);
  if (!pendingAnn.size) return Promise.resolve();
  const items = [...pendingAnn.values()];
  pendingAnn.clear();
  setSave('saving');
  return Promise.all(items.map(p => api('/api/photos/' + p.id, { method: 'PUT', json: { annotations: p.annotations }, keepalive: true })))
    .then(() => { if (state.current) { state.current.updatedAt = new Date().toISOString(); state.current.editor = state.user.username; renderInfo(); } setSave(state.dirty ? 'dirty' : 'saved'); renderPhotoList(); })
    .catch(err => { items.forEach(p => pendingAnn.set(p.id, p)); setSave('error', err.message); toast('Markierungen nicht gespeichert: ' + err.message, true); });
}

$('undoBtn').addEventListener('click', () => {
  const p = curPhoto();
  const last = undo.stack.pop();
  if (!p || !last || last.id !== p.id) { toast('Nichts zum Rückgängigmachen.'); return; }
  p.annotations = last.before;
  pendingAnn.set(p.id, p);
  clearTimeout(annTimer);
  annTimer = setTimeout(flushAnnotations, 300);
  renderPhotos();
});

const stageSvg = $('stageSvg');
stageSvg.addEventListener('pointerdown', async e => {
  const p = curPhoto();
  if (!p || state.offline || !photoDims(p) || !draw.tool) return;
  if (draw.tool === 'eraser') {
    const g = e.target.closest('.shape');
    if (g && +g.dataset.i >= 0) changeAnnotations(p, p.annotations.filter((_, i) => i !== +g.dataset.i));
    return;
  }
  e.preventDefault();
  const pt = svgPoint(e);
  if (draw.tool === 'text') {
    const text = await ask('Text für die Markierung:', { okText: 'Einfügen', input: { placeholder: 'z. B. +4,3 mm' } });
    if (text && text.trim()) changeAnnotations(p, [...(p.annotations || []), { t: 'text', c: draw.color, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, text: text.trim().slice(0, 200) }]);
    return;
  }
  draw.active = { t: draw.tool, c: draw.color, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
  draw.pointer = { x: e.clientX, y: e.clientY };
  stageSvg.setPointerCapture(e.pointerId);
  renderStageOverlay(draw.active);
});
stageSvg.addEventListener('click', () => { if (!draw.tool && curPhoto()) openViewer(state.current.photos, state.photoIdx); });
stageSvg.addEventListener('pointermove', e => {
  if (!draw.active) return;
  const pt = svgPoint(e);
  draw.active.x2 = pt.x; draw.active.y2 = pt.y;
  renderStageOverlay(draw.active);
});
function endStroke(e) {
  if (!draw.active) return;
  const a = draw.active;
  draw.active = null;
  const moved = Math.hypot(e.clientX - draw.pointer.x, e.clientY - draw.pointer.y);
  const p = curPhoto();
  if (moved < 6 || !p) { renderStageOverlay(); return; }
  for (const k of ['x1', 'y1', 'x2', 'y2']) a[k] = Math.round(a[k] * 100000) / 100000;
  changeAnnotations(p, [...(p.annotations || []), a]);
}
stageSvg.addEventListener('pointerup', endStroke);
stageSvg.addEventListener('pointercancel', () => { draw.active = null; renderStageOverlay(); });

document.addEventListener('keydown', e => {
  if (state.view !== 'program' || e.target.matches('input, textarea') || document.querySelector('dialog[open]')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('undoBtn').click(); }
  else if (e.key === 'Escape') setTool(null);
  else if (e.key === 'ArrowLeft' && state.current.photos.length) $('stagePrev').click();
  else if (e.key === 'ArrowRight' && state.current.photos.length) $('stageNext').click();
});

async function saveAnnotatedImage(p, i) {
  if (!p) { toast('Kein Foto vorhanden.', true); return; }
  try {
    try { await document.fonts.load('700 40px Kalam'); } catch (e) { /* fallback font */ }
    const img = await loadImage(p.url);
    const W = img.naturalWidth, H = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    drawShapesOnCanvas(ctx, p.annotations || [], W, H);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    const url = URL.createObjectURL(blob);
    const name = (state.current.number + '-foto-' + (i + 1)).replace(/[^\w.-]+/g, '_') + '.jpg';
    el('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) { toast('Bild konnte nicht gespeichert werden.', true); }
}

/* ---- attachments */

function renderAttachments() {
  const r = state.current;
  const box = $('attachList');
  if (!r.files.length) { box.replaceChildren(el('div', { class: 'none', text: 'Keine Anhänge (z. B. Zeichnung als PDF).' })); return; }
  box.replaceChildren(...r.files.map(f => el('div', { class: 'attach' },
    icon(f.mime === 'application/pdf' ? 'pdf' : f.mime.startsWith('image/') ? 'image' : 'file'),
    el('a', { href: f.url, target: '_blank', rel: 'noopener', text: f.name, title: f.name }),
    el('small', { text: fmtSize(f.size) }),
    el('button', { type: 'button', class: 'iconbtn small noprint', title: 'Anhang löschen', 'aria-label': 'Anhang ' + f.name + ' löschen', disabled: state.offline,
      onclick: async () => {
        if (!await ask('Anhang „' + f.name + '“ löschen?', { okText: 'Löschen', danger: true })) return;
        try { await api('/api/files/' + f.id, { method: 'DELETE' }); r.files = r.files.filter(x => x.id !== f.id); renderAttachments(); }
        catch (err) { toast(err.message, true); }
      } }, icon('x')))));
}

$('attachInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  const r = state.current;
  for (let i = 0; i < files.length; i++) {
    setSave('saving', 'Anhang ' + (i + 1) + '/' + files.length + ' wird hochgeladen …');
    try {
      const res = await api('/api/records/' + r.id + '/files', { method: 'POST', body: files[i],
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(files[i].name) } });
      r.files = res.files;
      if (state.current === r) renderAttachments();
    } catch (err) { toast(files[i].name + ': ' + err.message, true); }
  }
  setSave(state.dirty ? 'dirty' : 'saved');
});

/* ---- print, duplicate, delete */

async function printSheet(asPdf) {
  if (state.view !== 'program' || !state.current) { toast('Bitte zuerst ein Programm öffnen.', true); return; }
  await flushAll();
  const r = state.current;
  const box = $('printPhotos');
  box.replaceChildren(...r.photos.map((p, i) => {
    const svg = svgEl('svg', { class: 'overlay' });
    renderOverlay(svg, p);
    return el('figure', { class: 'printphoto' }, el('div', { class: 'pp' }, el('img', { src: p.url, alt: '' }), svg),
      el('figcaption', { text: 'Bild ' + (i + 1) + (p.caption ? ' – ' + p.caption : '') }));
  }));
  const notes = $('fNotes');
  notes.style.height = notes.scrollHeight + 4 + 'px';
  setSave('saving', 'Druck wird vorbereitet …');
  await Promise.all([...box.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
  setSave('saved');
  if (asPdf) toast('Im Druckdialog als Ziel „Als PDF speichern“ wählen.');
  const prevTitle = document.title;
  document.title = 'Programm ' + recordTitle(r);
  window.print();
  document.title = prevTitle;
  notes.style.height = '';
}
$('printBtn').addEventListener('click', () => printSheet(false));
$('pdfBtn').addEventListener('click', () => printSheet(true));
$('topPrint').addEventListener('click', () => printSheet(false));
$('saveImgBtn').addEventListener('click', () => saveAnnotatedImage(curPhoto(), state.photoIdx));

$('dupBtn').addEventListener('click', async () => {
  const r = state.current;
  await flushAll();
  const number = await ask('Programm ' + r.number + ' duplizieren.\nNeue Programmnummer (Fotos, Markierungen und Anhänge werden mitkopiert):',
    { okText: 'Duplizieren', input: { value: r.number + '-2' } });
  if (number == null || !number.trim()) return;
  try {
    const { record } = await api('/api/records/' + r.id + '/duplicate', { method: 'POST', json: { number: number.trim() } });
    upsert(record);
    toast('Kopie ' + record.number + ' angelegt.');
    location.hash = '#/p/' + record.id;
  } catch (err) { toast(err.message, true); }
});

$('deleteBtn').addEventListener('click', async () => {
  const r = state.current;
  const extra = [r.photos.length ? plural(r.photos.length, 'Foto', 'Fotos') : '', r.files.length ? plural(r.files.length, 'Anhang', 'Anhänge') : ''].filter(Boolean).join(' und ');
  if (!await ask('Programm ' + recordTitle(r) + ' wirklich löschen?' + (extra ? '\nDabei werden auch ' + extra + ' gelöscht.' : ''), { okText: 'Löschen', danger: true })) return;
  try {
    clearTimeout(save.timer); state.dirty = false; pendingAnn.clear();
    await api('/api/records/' + r.id, { method: 'DELETE' });
    state.records = state.records.filter(x => x.id !== r.id);
    state.current = null;
    toast('Programm gelöscht.');
    location.hash = '#/programme';
  } catch (err) { toast(err.message, true); }
});

/* ================================================================ viewer */

const viewer = { photos: [], index: 0 };

function openViewer(photos, index) {
  if (!photos.length) return;
  viewer.photos = photos;
  viewer.index = index;
  updateViewer();
  $('viewer').showModal();
}

function updateViewer() {
  const p = viewer.photos[viewer.index];
  $('viewerImg').src = p.url;
  renderOverlay($('viewerSvg'), p);
  $('viewerDownload').href = p.url + '?download=1';
  $('viewerCount').textContent = (viewer.index + 1) + ' / ' + viewer.photos.length;
  $('viewerPrev').disabled = viewer.index === 0;
  $('viewerNext').disabled = viewer.index === viewer.photos.length - 1;
}

function stepViewer(d) {
  const i = viewer.index + d;
  if (i < 0 || i >= viewer.photos.length) return;
  viewer.index = i;
  updateViewer();
}

$('viewerPrev').addEventListener('click', () => stepViewer(-1));
$('viewerNext').addEventListener('click', () => stepViewer(1));
$('viewerClose').addEventListener('click', () => $('viewer').close());
$('viewer').addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') stepViewer(-1);
  if (e.key === 'ArrowRight') stepViewer(1);
});
let touchX = null;
$('viewerInner').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('viewerInner').addEventListener('touchend', e => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
});

/* ================================================================ backup */

$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!await ask('Backup „' + file.name + '“ importieren?\nProgramme mit gleicher Nummer werden durch die importierten Daten ersetzt.', { okText: 'Importieren' })) return;
  toast('Import läuft …');
  try {
    const res = await api('/api/import', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
    await refresh();
    toast('Import abgeschlossen: ' + plural(res.imported, 'Programm', 'Programme') + ', ' + plural(res.photos, 'Foto', 'Fotos') +
      (res.files ? ', ' + plural(res.files, 'Anhang', 'Anhänge') : '') + (res.skipped ? ', ' + res.skipped + ' übersprungen' : '') + '.');
  } catch (err) { toast(err.message, true); }
});

$('exportBtn').addEventListener('click', e => {
  if (!state.records.length) { e.preventDefault(); toast('Es gibt noch keine Programme zum Exportieren.', true); }
});

$('sampleBtn').addEventListener('click', async () => {
  const sample = { number: '1645540', name: 'Beispiel-Fliese', setup: 'E-245', pointLabel: '9 Punkte (Original)',
    x: '240', y: '560', z: '370', x2: '244.3', y2: '565', z2: '364.6',
    notes: '– Achtung: Der linke Bereich der Fliese muss nach dem Schnitt unbedingt 5 mm betragen.\n– Die Länge X wurde um 4,3 mm erhöht.\n– Prüfen, ob die neue Einstellung mit dem Werkzeug kompatibel ist.' };
  let id;
  try {
    const { record } = await api('/api/records', { method: 'POST', json: sample });
    upsert(record);
    id = record.id;
    toast('Beispieldatensatz angelegt.');
  } catch (err) {
    if (err.status === 409) id = err.data.recordId;
    else return toast(err.message, true);
  }
  location.hash = '#/p/' + id;
});

/* ================================================================ settings */

function renderSettings() {
  $('settingsUser').textContent = 'Angemeldet als ' + state.user.username + (state.user.isAdmin ? ' (Administrator)' : '');
  $('pwForm').reset();
  $('newUserForm').reset();
  showError('pwError'); showError('nuError');
  $('pwUser').value = state.user.username;
  $('adminSection').hidden = !state.user.isAdmin;
  applyTheme(themePref());
  if (state.user.isAdmin) loadUsers();
}

$('pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('pwError');
  if ($('pwNew').value !== $('pwNew2').value) return showError('pwError', 'Die neuen Passwörter stimmen nicht überein.');
  try {
    await api('/api/me/password', { method: 'POST', json: { current: $('pwCurrent').value, new: $('pwNew').value } });
    $('pwForm').reset();
    toast('Passwort geändert. Andere Geräte wurden abgemeldet.');
  } catch (err) { showError('pwError', err.message); }
});

async function loadUsers() {
  const box = $('userList');
  try {
    const { users } = await api('/api/users');
    box.replaceChildren(...users.map(u => el('div', { class: 'userrow' },
      el('div', {}, el('b', { text: u.username }), u.isAdmin ? el('span', { class: 'muted', text: ' · Admin' }) : null,
        el('div', { class: 'muted', text: plural(u.records, 'Programm', 'Programme') })),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn small', text: 'Passwort', title: 'Passwort zurücksetzen', onclick: () => resetUserPassword(u) }),
        u.id !== state.user.id ? el('button', { type: 'button', class: 'btn small', text: u.isAdmin ? 'Admin entziehen' : 'Zum Admin', onclick: () => toggleAdmin(u) }) : null,
        u.id !== state.user.id ? el('button', { type: 'button', class: 'btn small danger', text: 'Löschen', onclick: () => deleteUser(u) }) : null))));
  } catch (err) { box.replaceChildren(el('p', { class: 'error', text: err.message })); }
}

async function resetUserPassword(u) {
  const pw = await ask('Neues Passwort für ' + u.username + ' (mind. 8 Zeichen):', { okText: 'Setzen', input: { type: 'text' } });
  if (pw == null) return;
  try { await api('/api/users/' + u.id, { method: 'PUT', json: { password: pw } }); toast('Passwort für ' + u.username + ' gesetzt.'); }
  catch (err) { toast(err.message, true); }
}

async function toggleAdmin(u) {
  try { await api('/api/users/' + u.id, { method: 'PUT', json: { isAdmin: !u.isAdmin } }); loadUsers(); }
  catch (err) { toast(err.message, true); }
}

async function deleteUser(u) {
  if (!await ask('Benutzer ' + u.username + ' und alle seine ' + plural(u.records, 'Programm', 'Programme') + ' samt Fotos endgültig löschen?', { okText: 'Löschen', danger: true })) return;
  try { await api('/api/users/' + u.id, { method: 'DELETE' }); toast('Benutzer gelöscht.'); loadUsers(); }
  catch (err) { toast(err.message, true); }
}

$('newUserForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('nuError');
  try {
    await api('/api/users', { method: 'POST', json: { username: $('nuName').value.trim(), password: $('nuPass').value, isAdmin: $('nuAdmin').checked } });
    toast('Benutzer ' + $('nuName').value.trim() + ' angelegt.');
    $('newUserForm').reset();
    loadUsers();
  } catch (err) { showError('nuError', err.message); }
});

/* ================================================================ start */

buildAxes();
buildColors();
setTool(null);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
