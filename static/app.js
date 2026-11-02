'use strict';
/* Kaveh CMS – client */

const $ = id => document.getElementById(id);
const state = {
  status: null, user: null, records: [], offline: false,
  editing: null,      // record being edited (null = new record)
  order: [],          // existing photo ids of the edited record, in display order
  removed: new Set(), // existing photo ids marked for deletion
  pending: [],        // new photos: {file, url}
  currentId: null,    // record shown in the search panel
  authMode: 'login',
};

/* ---------------------------------------------------------------- helpers */

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
}

async function api(path, { method = 'GET', json, body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
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
    ok.className = danger ? 'danger' : 'primary';
    inp.hidden = !input;
    if (input) { inp.type = input.type || 'text'; inp.value = input.value || ''; inp.placeholder = input.placeholder || ''; }
    dlg.returnValue = '';
    dlg.addEventListener('close', () => {
      const confirmed = dlg.returnValue === 'ok';
      resolve(input ? (confirmed ? inp.value : null) : confirmed);
    }, { once: true });
    dlg.showModal();
    (input ? inp : ok).focus();
  });
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

function setOffline(off) {
  state.offline = off;
  $('offlineBar').hidden = !off;
}

/* ---------------------------------------------------------------- images */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
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
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Shrink a photo before upload (saves bandwidth and storage, strips EXIF/GPS). Falls back to the original. */
async function preparePhoto(file) {
  if (file.type === 'image/gif') return { full: file, thumb: null };
  try {
    const { img, url } = await loadImage(file);
    try {
      const full = await scaleToJpeg(img, 2400, 0.86);
      const thumb = await scaleToJpeg(img, 480, 0.75);
      if (!full) throw new Error('encode');
      return { full, thumb };
    } finally { URL.revokeObjectURL(url); }
  } catch (e) {
    return { full: file, thumb: null };
  }
}

/* ---------------------------------------------------------------- auth */

async function boot() {
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
  $('userMenu').hidden = true;
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
  const canRegister = state.status && state.status.registrationOpen && mode !== 'setup';
  $('authSwitchWrap').hidden = !canRegister;
  $('authSwitch').textContent = mode === 'register' ? 'Ich habe schon ein Konto – anmelden' : 'Neues Konto erstellen';
  showError('authError', message);
  $('authUser').focus();
}

$('authSwitch').addEventListener('click', e => {
  e.preventDefault();
  showAuth(state.authMode === 'register' ? 'login' : 'register');
});

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
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  if (window.caches) { try { await caches.delete('kaveh-cms-data'); } catch (e) { /* ignore */ } }
  state.user = null; state.records = []; state.currentId = null;
  resetForm();
  $('searchResult').replaceChildren();
  $('search').value = '';
  showAuth('login');
});

async function startApp(user) {
  state.user = user;
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('userMenu').hidden = false;
  $('userName').textContent = user.username + (user.isAdmin ? ' (Admin)' : '');
  resetForm();
  await refresh();
  renderSearchIntro();
}

/* ---------------------------------------------------------------- records */

async function refresh() {
  try {
    const data = await api('/api/records');
    state.records = data.records;
  } catch (e) {
    if (e.status !== 401) toast(e.message, true);
  }
  renderList();
}

const byId = id => state.records.find(r => r.id === id);

function renderSearchIntro() {
  if (state.currentId && byId(state.currentId)) return showRecord(state.currentId);
  $('searchResult').replaceChildren(el('p', { class: 'empty', text: state.records.length
    ? 'Programmnummer oder Stichwort eingeben und suchen – oder unten ein Programm öffnen.'
    : 'Noch keine Programme gespeichert. Lege unten ein neues Programm an oder lade den Beispieldatensatz.' }));
}

function matches(r, q) {
  q = q.toLowerCase();
  return r.number.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q);
}

function runSearch() {
  const q = $('search').value.trim();
  if (!q) { state.currentId = null; return renderSearchIntro(); }
  const exact = state.records.find(r => r.number.toLowerCase() === q.toLowerCase());
  if (exact) return showRecord(exact.id);
  const hits = state.records.filter(r => matches(r, q));
  state.currentId = null;
  const box = $('searchResult');
  if (!hits.length) {
    box.replaceChildren(
      el('p', { class: 'empty', text: 'Kein Programm mit „' + q + '“ gefunden.' }),
      el('div', { class: 'actions' }, el('button', { type: 'button', text: 'Neues Programm ' + q + ' anlegen', onclick: () => {
        resetForm(); $('number').value = q; $('x').focus(); $('formPanel').scrollIntoView({ behavior: 'smooth' });
      } })));
    return;
  }
  box.replaceChildren(el('p', { class: 'muted', text: plural(hits.length, 'Treffer', 'Treffer') + ':' }), ...hits.map(listRow));
}

$('searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch(); });

function photoThumb(p, photos, i) {
  return el('button', { type: 'button', class: 'thumb', title: 'Foto vergrößern', onclick: () => openViewer(photos, i) },
    el('img', { src: p.thumb, alt: 'Tile-Foto ' + (i + 1), loading: 'lazy' }));
}

function showRecord(id) {
  const r = byId(id);
  const box = $('searchResult');
  if (!r) { state.currentId = null; box.replaceChildren(el('p', { class: 'empty', text: 'Programm nicht gefunden.' })); return; }
  state.currentId = id;
  box.replaceChildren(el('div', { class: 'result' },
    el('div', { class: 'recordhead' },
      el('div', {}, el('div', { class: 'muted', text: 'Programmnummer' }), el('div', { class: 'program', text: r.number })),
      el('div', { class: 'actions' },
        el('button', { type: 'button', text: 'Bearbeiten', disabled: state.offline, onclick: () => editRecord(r.id) }),
        el('button', { type: 'button', class: 'danger', text: 'Löschen', disabled: state.offline, onclick: () => deleteRecord(r.id) }))),
    el('div', { class: 'xyz' }, ...['x', 'y', 'z'].map(k => el('div', {}, el('b', { text: k.toUpperCase() }), el('span', { text: r[k] || '—' })))),
    el('div', {}, el('div', { class: 'muted', text: 'Hinweise' }), el('p', { class: 'noteText', text: r.notes || 'Keine Hinweise gespeichert.' })),
    r.photos.length ? el('div', {}, el('div', { class: 'muted', text: plural(r.photos.length, 'Foto', 'Fotos') }),
      el('div', { class: 'gallery' }, r.photos.map((p, i) => photoThumb(p, r.photos, i)))) : null,
    el('div', { class: 'small', text: 'Zuletzt geändert: ' + fmtDate(r.updatedAt) })));
}

function listRow(r) {
  const coords = 'X ' + (r.x || '—') + ' · Y ' + (r.y || '—') + ' · Z ' + (r.z || '—') +
    (r.photos.length ? ' · ' + plural(r.photos.length, 'Foto', 'Fotos') : '');
  const open = () => { $('search').value = r.number; showRecord(r.id); $('searchResult').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return el('div', { class: 'row' },
    el('div', { class: 'info' },
      r.photos.length ? el('img', { src: r.photos[0].thumb, alt: '', loading: 'lazy' }) : el('div', { class: 'ph' }),
      el('div', {}, el('b', { text: r.number }), el('div', { class: 'muted', text: coords }))),
    el('button', { type: 'button', text: 'Öffnen', onclick: open }));
}

function renderList() {
  const q = $('filter').value.trim();
  const list = q ? state.records.filter(r => matches(r, q)) : state.records;
  $('count').textContent = plural(state.records.length, 'Programm', 'Programme');
  const box = $('recordsList');
  if (!state.records.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Noch keine Einträge.' })); return; }
  if (!list.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Keine Programme passen zum Filter.' })); return; }
  box.replaceChildren(...list.map(listRow));
}

$('filter').addEventListener('input', renderList);

async function deleteRecord(id) {
  const r = byId(id);
  if (!r) return;
  const extra = r.photos.length ? ' Dabei werden auch ' + plural(r.photos.length, 'Foto', 'Fotos') + ' gelöscht.' : '';
  if (!await ask('Programm ' + r.number + ' wirklich löschen?' + extra, { okText: 'Löschen', danger: true })) return;
  try {
    await api('/api/records/' + id, { method: 'DELETE' });
    if (state.editing && state.editing.id === id) resetForm();
    state.currentId = null;
    await refresh();
    $('searchResult').replaceChildren(el('p', { class: 'empty', text: 'Programm ' + r.number + ' gelöscht.' }));
    toast('Programm gelöscht.');
  } catch (e) { toast(e.message, true); }
}

/* ---------------------------------------------------------------- form */

function resetForm() {
  state.editing = null;
  state.order = [];
  state.removed = new Set();
  state.pending.forEach(p => URL.revokeObjectURL(p.url));
  state.pending = [];
  $('recordForm').reset();
  $('formTitle').textContent = 'Programm hinzufügen';
  $('saveBtn').textContent = 'Speichern';
  $('newBtn').textContent = 'Leeren';
  showError('formError');
  renderPhotoEditor();
}

function editRecord(id) {
  const r = byId(id);
  if (!r) return;
  const keepPending = state.pending;
  state.pending = [];
  resetForm();
  state.pending = keepPending;
  state.editing = r;
  state.order = r.photos.map(p => p.id);
  for (const k of ['number', 'x', 'y', 'z', 'notes']) $(k).value = r[k];
  $('formTitle').textContent = 'Programm ' + r.number + ' bearbeiten';
  $('newBtn').textContent = 'Abbrechen';
  renderPhotoEditor();
  $('formPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPhotoEditor() {
  const box = $('photoEditor');
  const items = [];
  if (state.editing) {
    const photos = state.editing.photos;
    state.order.forEach((pid, i) => {
      const p = photos.find(x => x.id === pid);
      if (!p) return;
      const removed = state.removed.has(pid);
      items.push(el('div', { class: 'thumb' + (removed ? ' removed' : '') },
        el('img', { src: p.thumb, alt: 'Foto ' + (i + 1) }),
        removed ? el('span', { class: 'badge', text: 'wird gelöscht' }) : null,
        el('button', { type: 'button', class: 'x', title: removed ? 'Wiederherstellen' : 'Foto entfernen', text: removed ? '↺' : '✕',
          onclick: () => { removed ? state.removed.delete(pid) : state.removed.add(pid); renderPhotoEditor(); } }),
        i > 0 && !removed ? el('button', { type: 'button', class: 'move', title: 'Nach vorne verschieben', text: '◀',
          onclick: () => { const o = state.order; [o[i - 1], o[i]] = [o[i], o[i - 1]]; renderPhotoEditor(); } }) : null));
    });
  }
  state.pending.forEach((p, i) => {
    items.push(el('div', { class: 'thumb pending' },
      el('img', { src: p.url, alt: 'Neues Foto ' + (i + 1) }),
      el('span', { class: 'badge', text: 'neu' }),
      el('button', { type: 'button', class: 'x', title: 'Nicht hochladen', text: '✕',
        onclick: () => { URL.revokeObjectURL(p.url); state.pending.splice(i, 1); renderPhotoEditor(); } })));
  });
  box.replaceChildren(...items);
}

$('photo').addEventListener('change', e => {
  for (const file of e.target.files) {
    if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(file.name)) {
      toast(file.name + ' ist kein Bild.', true);
      continue;
    }
    state.pending.push({ file, url: URL.createObjectURL(file) });
  }
  e.target.value = '';
  renderPhotoEditor();
});

$('newBtn').addEventListener('click', resetForm);

$('recordForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('formError');
  const fields = {};
  for (const k of ['number', 'x', 'y', 'z', 'notes']) fields[k] = $(k).value.trim();
  if (!fields.number) { showError('formError', 'Bitte eine Programmnummer eingeben.'); $('number').focus(); return; }
  const btn = $('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Speichert …';
  let rec;
  try {
    rec = state.editing
      ? (await api('/api/records/' + state.editing.id, { method: 'PUT', json: fields })).record
      : (await api('/api/records', { method: 'POST', json: fields })).record;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Speichern';
    if (err.status === 409 && err.data.recordId && !state.editing) {
      if (await ask(err.message + '\nVorhandenes Programm öffnen und bearbeiten? Die ausgewählten neuen Fotos bleiben erhalten.', { okText: 'Öffnen' })) {
        await refresh();
        editRecord(err.data.recordId);
      }
    } else showError('formError', err.message);
    return;
  }

  const problems = [];
  try {
    for (const pid of state.removed) {
      try { await api('/api/photos/' + pid, { method: 'DELETE' }); }
      catch (err) { problems.push('Foto konnte nicht gelöscht werden: ' + err.message); }
    }
    const kept = state.order.filter(pid => !state.removed.has(pid));
    const original = state.editing ? state.editing.photos.map(p => p.id).filter(pid => !state.removed.has(pid)) : [];
    if (kept.join() !== original.join()) {
      try { await api('/api/records/' + rec.id + '/photo-order', { method: 'PUT', json: { order: kept } }); }
      catch (err) { problems.push('Reihenfolge nicht gespeichert: ' + err.message); }
    }
    const failed = [];
    for (let i = 0; i < state.pending.length; i++) {
      const p = state.pending[i];
      btn.textContent = 'Foto ' + (i + 1) + '/' + state.pending.length + ' …';
      try {
        const { full, thumb } = await preparePhoto(p.file);
        const fd = new FormData();
        fd.append('photo', full, 'photo.jpg');
        if (thumb) fd.append('thumb', thumb, 'thumb.jpg');
        await api('/api/records/' + rec.id + '/photos', { method: 'POST', body: fd });
        URL.revokeObjectURL(p.url);
      } catch (err) {
        failed.push(p);
        problems.push((p.file.name || 'Foto') + ': ' + err.message);
      }
    }
    state.pending = failed;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Speichern';
  }

  await refresh();
  $('search').value = rec.number;
  showRecord(rec.id);
  if (problems.length) {
    editRecord(rec.id); // stay in edit mode so failed photos can be retried
    showError('formError', problems.join('\n'));
    toast('Programm gespeichert, aber nicht alle Fotos konnten verarbeitet werden.', true);
  } else {
    resetForm();
    toast('Programm ' + rec.number + ' gespeichert.');
    $('searchResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

/* ---------------------------------------------------------------- viewer */

const viewer = { photos: [], index: 0 };

function openViewer(photos, index) {
  viewer.photos = photos;
  viewer.index = index;
  updateViewer();
  $('viewer').showModal();
}

function updateViewer() {
  const p = viewer.photos[viewer.index];
  $('viewerImg').src = p.url;
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
$('viewerImg').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('viewerImg').addEventListener('touchend', e => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
});
$('viewerImg').addEventListener('click', () => { if (viewer.photos.length === 1) $('viewer').close(); });

/* ---------------------------------------------------------------- backup */

$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!await ask('Backup „' + file.name + '“ importieren?\nProgramme mit gleicher Nummer werden durch die importierten Daten ersetzt.', { okText: 'Importieren' })) return;
  toast('Import läuft …');
  try {
    const res = await api('/api/import', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
    await refresh();
    renderSearchIntro();
    toast('Import abgeschlossen: ' + plural(res.imported, 'Programm', 'Programme') + ', ' + plural(res.photos, 'Foto', 'Fotos') +
      (res.skipped ? ', ' + res.skipped + ' übersprungen' : '') + '.');
  } catch (err) { toast(err.message, true); }
});

$('exportBtn').addEventListener('click', e => {
  if (!state.records.length) { e.preventDefault(); toast('Es gibt noch keine Programme zum Exportieren.', true); }
});

$('sampleBtn').addEventListener('click', async () => {
  const sample = { number: '1645540', x: '240', y: '560', z: '370',
    notes: 'Achtung: Der linke Bereich der Fliese muss nach dem Schnitt unbedingt 5 mm betragen.' };
  let id;
  try {
    id = (await api('/api/records', { method: 'POST', json: sample })).record.id;
    toast('Beispieldatensatz angelegt.');
  } catch (err) {
    if (err.status === 409) id = err.data.recordId;
    else return toast(err.message, true);
  }
  await refresh();
  $('search').value = sample.number;
  showRecord(id);
  $('searchResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------------------------------------------------------------- settings */

$('settingsBtn').addEventListener('click', async () => {
  $('pwForm').reset();
  $('newUserForm').reset();
  showError('pwError'); showError('nuError');
  $('pwUser').value = state.user.username;
  $('adminSection').hidden = !state.user.isAdmin;
  $('settingsDlg').showModal();
  if (state.user.isAdmin) loadUsers();
});

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
        el('button', { type: 'button', text: 'Passwort', title: 'Passwort zurücksetzen', onclick: () => resetUserPassword(u) }),
        u.id !== state.user.id ? el('button', { type: 'button', text: u.isAdmin ? 'Admin entziehen' : 'Zum Admin', onclick: () => toggleAdmin(u) }) : null,
        u.id !== state.user.id ? el('button', { type: 'button', class: 'danger', text: 'Löschen', onclick: () => deleteUser(u) }) : null))));
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

/* ---------------------------------------------------------------- start */

window.addEventListener('online', () => { if (state.user) refresh(); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
