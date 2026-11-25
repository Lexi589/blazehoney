import { db, uid } from './db.js';
import { Editor, newPage } from './editor.js';
import { importFileAsNote, fileToPages, exportBackup, readBackup } from './import.js';
import { Sync } from './sync.js';
import { escapeHTML } from './sanitize.js';
import { platform } from './transport.js';
import { normalizeNcUrl } from './nextcloud.js';

const $ = sel => document.querySelector(sel);
const COLORS = ['#1d1d1f', '#1c56c9', '#d6336c', '#2f9e44', '#f08c00', '#ffd43b'];
const TRASH = '__trash', ALL = '__all';

const state = {
  notes: [],
  current: null,
  folder: ALL,
  search: '',
  extraFolders: [],
};

/* ---------------- Asset-URLs ---------------- */
const assetURLs = new Map();
async function getAssetURL(id) {
  if (assetURLs.has(id)) return assetURLs.get(id);
  const a = await db.getAsset(id);
  if (!a) return null;
  const url = URL.createObjectURL(a.blob);
  assetURLs.set(id, url);
  return url;
}

/* ---------------- Editor ---------------- */
const editor = new Editor($('#pages'), {
  getAssetURL,
  onChange: () => scheduleSave(),
  onHistory: (u, r) => { $('#btn-undo').disabled = !u; $('#btn-redo').disabled = !r; },
  onZoom: z => { $('#zoom-label').textContent = Math.round(z * 100) + '%'; },
});

let saveTimer = null;
function scheduleSave() {
  const note = state.current;
  if (!note || note.deleted) return;
  note.updatedAt = Date.now();
  note.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNote(note), 500);
}
async function saveNote(note) {
  clearTimeout(saveTimer);
  await db.putNote(note);
  renderList();
}
async function flushSave() {
  if (saveTimer && state.current) await saveNote(state.current);
}

/* ---------------- Notizen ---------------- */
function visibleNotes() {
  const q = state.search.trim().toLowerCase();
  return state.notes
    .filter(n => !n.purged)
    .filter(n => state.folder === TRASH ? n.deleted : !n.deleted)
    .filter(n => state.folder === ALL || state.folder === TRASH || n.folder === state.folder)
    .filter(n => !q || searchText(n).toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

const textCache = new WeakMap();
function noteBodyText(n) {
  const cached = textCache.get(n);
  if (cached && cached.at === n.updatedAt) return cached.text;
  const div = document.createElement('div');
  const parts = [];
  for (const p of n.pages) {
    for (const t of p.texts) { div.innerHTML = (t.html || '').replace(/<(\/?(?:div|p|li|h[1-3]|br)\b[^>]*)>/gi, ' <$1>'); parts.push(div.textContent); }
    if (p.searchText) parts.push(p.searchText);
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  textCache.set(n, { at: n.updatedAt, text });
  return text;
}
const searchText = n => `${n.title} ${n.folder} ${noteBodyText(n)}`;

function folders() {
  const set = new Set(state.extraFolders);
  state.notes.forEach(n => { if (n.folder && !n.deleted && !n.purged) set.add(n.folder); });
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

async function createNote(extra = {}) {
  $('#note-title').focus();          // sofort fokussieren, damit schnelles Tippen im Titel landet
  await flushSave();
  const folder = state.folder !== ALL && state.folder !== TRASH ? state.folder : (state.current && state.current.folder) || '';
  const now = Date.now();
  const note = {
    id: uid(), title: '', folder, paper: 'lined', pages: [newPage()],
    createdAt: now, updatedAt: now, deleted: false, dirty: true, ...extra,
  };
  state.notes.push(note);
  await db.putNote(note);
  if (state.folder === TRASH) state.folder = ALL;
  await openNote(note);
  $('#note-title').focus();
  return note;
}

async function openNote(note) {
  await flushSave();
  state.current = note;
  document.body.classList.toggle('no-note', !note);
  $('#trash-bar').hidden = !(note && note.deleted);
  if (note) {
    $('#note-title').value = note.title || '';
    $('#paper').value = note.paper || 'lined';
    renderFolderSelect();
    db.setMeta('lastNote', note.id);
    if (window.matchMedia('(max-width: 760px)').matches) document.body.classList.add('side-hidden');
  }
  editor.load(note, { readOnly: !!(note && note.deleted) });
  renderList();
}

async function trashNote(note) {
  note.deleted = true; note.updatedAt = Date.now(); note.dirty = true;
  await db.putNote(note);
  toast('In den Papierkorb verschoben');
  openNote(visibleNotes()[0] || null);
}

/* ---------------- Rendering ---------------- */
function renderFolders() {
  const counts = {};
  let all = 0, trash = 0;
  for (const n of state.notes) {
    if (n.purged) continue;
    if (n.deleted) { trash++; continue; }
    all++;
    counts[n.folder] = (counts[n.folder] || 0) + 1;
  }
  const chips = [[ALL, 'Alle', all], ...folders().map(f => [f, f, counts[f] || 0])];
  if (trash) chips.push([TRASH, '🗑 Papierkorb', trash]);
  const el = $('#folders');
  el.innerHTML = '';
  for (const [key, label, n] of chips) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.folder === key ? ' active' : '');
    b.innerHTML = `${escapeHTML(label)}<span class="n">${n}</span>`;
    b.onclick = () => { state.folder = key; renderList(); };
    el.appendChild(b);
  }
  const add = document.createElement('button');
  add.className = 'chip'; add.textContent = '+ Ordner'; add.title = 'Neuen Ordner / neues Fach anlegen';
  add.onclick = async () => {
    const name = (prompt('Name des Ordners (z. B. Mathe, Deutsch, Bio):') || '').trim();
    if (!name) return;
    if (!state.extraFolders.includes(name)) state.extraFolders.push(name);
    await db.setMeta('folders', state.extraFolders);
    state.folder = name;
    renderList(); renderFolderSelect();
  };
  el.appendChild(add);
  $('#folder-datalist').innerHTML = folders().map(f => `<option value="${escapeHTML(f)}">`).join('');
}

function renderList() {
  renderFolders();
  const list = $('#note-list');
  const notes = visibleNotes();
  const q = state.search.trim();
  list.innerHTML = '';
  if (!notes.length) {
    list.innerHTML = `<div class="empty-list">${q ? 'Nichts gefunden.' : state.folder === TRASH ? 'Papierkorb ist leer.' : 'Noch keine Notizen.<br>Alt+N oder „Importieren“.'}</div>`;
    return;
  }
  for (const n of notes) {
    const item = document.createElement('div');
    item.className = 'note-item' + (state.current && state.current.id === n.id ? ' active' : '');
    item.setAttribute('role', 'listitem');
    const body = noteBodyText(n);
    let snippet = body.slice(0, 90);
    if (q) {
      const i = body.toLowerCase().indexOf(q.toLowerCase());
      if (i >= 0) snippet = (i > 30 ? '…' : '') + body.slice(Math.max(0, i - 30), i + 60);
    }
    const hl = s => q ? escapeHTML(s).replace(new RegExp(escapeRe(escapeHTML(q)), 'gi'), m => `<mark>${m}</mark>`) : escapeHTML(s);
    const date = new Date(n.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
    item.innerHTML = `<div class="t">${hl(n.title || 'Unbenannt')}</div>
      <div class="m"><span>${date}</span>${n.folder ? `<span>${escapeHTML(n.folder)}</span>` : ''}<span>${n.pages.length} S.</span>${n.dirty && sync.configured ? '<span title="noch nicht synchronisiert">↑</span>' : ''}</div>
      ${snippet ? `<div class="s">${hl(snippet)}</div>` : ''}`;
    item.onclick = () => openNote(n);
    list.appendChild(item);
  }
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function renderFolderSelect() {
  const sel = $('#note-folder');
  const cur = state.current ? state.current.folder : '';
  const opts = ['', ...folders()];
  if (cur && !opts.includes(cur)) opts.push(cur);
  sel.innerHTML = opts.map(f => `<option value="${escapeHTML(f)}">${f ? escapeHTML(f) : '– kein Ordner –'}</option>`).join('')
    + '<option value="__new">+ Neuer Ordner …</option>';
  sel.value = cur;
}

/* ---------------- Werkzeuge ---------------- */
const TOOLS = ['pen', 'highlighter', 'eraser', 'lasso', 'text'];
let colorIndex = 0;

function setTool(tool) {
  editor.tool = tool;
  if (tool !== 'lasso') editor.clearSelection();
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  const w = $('#width');
  w.disabled = tool === 'lasso' || tool === 'text';
  if (editor.widths[tool] != null) {
    w.min = tool === 'highlighter' ? 8 : tool === 'eraser' ? 6 : 0.5;
    w.max = tool === 'highlighter' ? 50 : tool === 'eraser' ? 80 : 12;
    w.value = editor.widths[tool];
  }
  $('#pages').dataset.tool = tool;
  savePrefs();
}

function setColor(color) {
  if (editor.recolorSelection(color)) return;
  editor.color = color;
  colorIndex = Math.max(0, COLORS.indexOf(color));
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.color === color));
  if (editor.tool === 'eraser' || editor.tool === 'lasso') setTool('pen');
  savePrefs();
}

function renderColors() {
  const el = $('#colors');
  el.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c; b.dataset.color = c; b.title = c;
    b.onclick = () => setColor(c);
    el.appendChild(b);
  }
  const custom = document.createElement('label');
  custom.className = 'swatch custom'; custom.title = 'Eigene Farbe';
  custom.innerHTML = '<input type="color">';
  custom.querySelector('input').oninput = e => setColor(e.target.value);
  el.appendChild(custom);
}

let prefsTimer;
function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => db.setMeta('prefs', {
    tool: editor.tool, color: editor.color, widths: editor.widths, zoom: editor.zoom, fingerDraws: editor.fingerDraws,
    sideHidden: document.body.classList.contains('side-hidden'),
  }), 300);
}

/* ---------------- Import ---------------- */
let pendingFiles = [];
let insertMode = false;

function chooseFiles(insert) {
  insertMode = insert;
  const input = $('#file-input');
  input.value = '';
  input.click();
}

function startImport(files) {
  pendingFiles = [...files];
  if (!pendingFiles.length) return;
  const backups = pendingFiles.filter(f => f.name.toLowerCase().endsWith('.json'));
  if (backups.length) {
    pendingFiles = pendingFiles.filter(f => !backups.includes(f));
    importBackups(backups);
    if (!pendingFiles.length) return;
  }
  if (insertMode && state.current && !state.current.deleted) { insertIntoCurrent(pendingFiles); return; }
  $('#imp-files').textContent = pendingFiles.length === 1 ? pendingFiles[0].name : `${pendingFiles.length} Dateien: ${pendingFiles.map(f => f.name).join(', ')}`;
  $('#imp-folder').value = state.folder !== ALL && state.folder !== TRASH ? state.folder : 'Schule';
  $('#dlg-import').showModal();
}

async function runImport(files, folder) {
  let last = null, ok = 0;
  for (const f of files) {
    try {
      const note = await importFileAsNote(f, folder, msg => toast(msg, 60000));
      state.notes.push(note);
      await db.putNote(note);
      last = note; ok++;
    } catch (err) {
      console.error(err);
      toast(err.message, 6000);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  if (folder) state.folder = folder;
  renderList();
  if (last) { openNote(last); toast(`${ok} von ${files.length} Datei(en) importiert`); sync.sync(); }
}

async function insertIntoCurrent(files) {
  for (const f of files) {
    try {
      const pages = await fileToPages(f, msg => toast(msg, 60000));
      const at = editor.pages.indexOf(editor.visiblePage()) + 1;
      pages.forEach((p, i) => editor.addPage(false, p, at + i));
      toast(`${pages.length} Seite(n) eingefügt`);
    } catch (err) { toast(err.message, 6000); }
  }
}

async function importBackups(files) {
  let count = 0;
  for (const f of files) {
    try {
      const notes = await readBackup(f);
      for (const n of notes) {
        const local = state.notes.find(x => x.id === n.id);
        if (local && local.updatedAt >= n.updatedAt) continue;
        const note = { ...n, dirty: true };
        if (local) Object.assign(local, note); else state.notes.push(note);
        await db.putNote(local || note);
        count++;
      }
    } catch (err) { toast(err.message, 6000); }
  }
  renderList();
  toast(`${count} Notiz(en) aus Backup übernommen`);
}

/* ---------------- Sync ---------------- */
const sync = new Sync({
  getNotes: () => state.notes,
  onStatus: (kind, text) => {
    const el = $('#sync-status');
    el.className = 'sync-status ' + kind;
    el.textContent = text;
  },
  onRemoteNote: async note => {
    const i = state.notes.findIndex(n => n.id === note.id);
    const isOpen = state.current && state.current.id === note.id;
    if (i >= 0) state.notes[i] = note; else state.notes.push(note);
    await db.putNote(note);
    if (isOpen) {
      const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tb, #note-title');
      if (!typing) { const top = $('#pages').scrollTop; state.current = note; openNote(note).then(() => { $('#pages').scrollTop = top; }); }
      else state.current = note;
    }
    renderList();
  },
});

let autoTimer = null;
function setupAutoSync() {
  clearInterval(autoTimer);
  if (sync.configured && sync.config.auto) autoTimer = setInterval(() => sync.sync(), 60_000);
}
async function syncNow() { await flushSave(); await sync.sync(); renderList(); }

/* ---------------- Dialoge & Menüs ---------------- */
function openSettings() {
  const cfg = sync.config || {};
  const mode = cfg.mode || (cfg.url ? 'server' : 'nextcloud');
  document.querySelector(`input[name=set-mode][value=${mode}]`).checked = true;
  $('#set-url').value = cfg.url || (location.protocol.startsWith('http') && location.port ? location.origin : '');
  $('#set-token').value = cfg.token || '';
  $('#set-nc-url').value = cfg.ncUrl || '';
  $('#set-nc-user').value = cfg.ncUser || '';
  $('#set-nc-pass').value = cfg.ncPass || '';
  $('#set-nc-folder').value = cfg.ncFolder || 'FederNotes';
  $('#set-nc-webhint').hidden = platform !== 'web';
  $('#set-auto').checked = cfg.auto !== false;
  $('#set-result').textContent = '';
  showMode();
  $('#dlg-settings').showModal();
}
function showMode() {
  const nc = document.querySelector('input[name=set-mode]:checked').value === 'nextcloud';
  $('#set-nc').hidden = !nc;
  $('#set-srv').hidden = nc;
}
const readSettings = () => ({
  mode: document.querySelector('input[name=set-mode]:checked').value,
  url: $('#set-url').value.trim(), token: $('#set-token').value.trim(),
  ncUrl: normalizeNcUrl($('#set-nc-url').value), ncUser: $('#set-nc-user').value.trim(),
  ncPass: $('#set-nc-pass').value.trim(), ncFolder: $('#set-nc-folder').value.trim().replace(/^\/+|\/+$/g, '') || 'FederNotes',
  auto: $('#set-auto').checked,
});

let toastTimer;
function toast(msg, ms = 2500) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function toggleSidebar(force) {
  document.body.classList.toggle('side-hidden', force);
  setTimeout(() => editor.relayout(), 220);
  savePrefs();
}

/* ---------------- Tastatur ---------------- */
function isEditable(el) {
  return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const editing = isEditable(document.activeElement);
  if (document.querySelector('dialog[open]')) return;

  // Strg+N ist in manchen Browsern reserviert (neues Fenster) → zusätzlich Alt+N
  if ((mod && k === 'n') || (e.altKey && e.code === 'KeyN')) { e.preventDefault(); createNote(); return; }
  if (mod && k === 'f') { e.preventDefault(); toggleSidebar(false); $('#search').focus(); $('#search').select(); return; }
  if (mod && k === 's') { e.preventDefault(); syncNow(); return; }
  if (mod && k === '\\') { e.preventDefault(); toggleSidebar(); return; }
  if (mod && k === 'p') { e.preventDefault(); printNote(); return; }
  if (!state.current) return;
  if (mod && (k === '+' || k === '=')) { e.preventDefault(); editor.setZoom(editor.zoom * 1.15); savePrefs(); return; }
  if (mod && k === '-') { e.preventDefault(); editor.setZoom(editor.zoom / 1.15); savePrefs(); return; }
  if (mod && k === '0') { e.preventDefault(); editor.setZoom(1); savePrefs(); return; }
  if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); editor.addPage(); return; }
  if (e.altKey && !mod && /^Digit[1-5]$/.test(e.code)) { e.preventDefault(); setTool(TOOLS[+e.code.slice(5) - 1]); return; }
  if (e.altKey && !mod && (e.code === 'KeyQ' || e.code === 'KeyW')) {
    e.preventDefault();
    colorIndex = (colorIndex + (e.code === 'KeyW' ? 1 : COLORS.length - 1)) % COLORS.length;
    setColor(COLORS[colorIndex]); return;
  }
  if (editing) return;   // ab hier nur außerhalb von Eingabefeldern

  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); return; }
  if ((mod && k === 'y') || (mod && e.shiftKey && k === 'z')) { e.preventDefault(); editor.redo(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selection) { e.preventDefault(); editor.deleteSelection(); return; }
  if (e.key === 'Escape') { editor.clearSelection(); return; }
  if (e.key === '?' ) { e.preventDefault(); $('#dlg-shortcuts').showModal(); return; }
  if (e.key === 'PageDown' || e.key === 'PageUp') return;

  // Einfach lostippen → Textfeld
  if (!mod && !e.altKey && (e.key.length === 1 || e.key === 'Enter') && !state.current.deleted) {
    e.preventDefault();
    editor.typeAnywhere(e.key === 'Enter' ? '' : e.key);
  }
});

/* ---------------- Drucken ---------------- */
function printNote() {
  if (!state.current) return;
  const prevZoom = editor.zoom;
  // Seite für den Druck auf A4-Breite rendern (210 mm ≈ 794 CSS-px)
  const pagesEl = $('#pages');
  const prevWidth = pagesEl.style.width;
  editor.zoom = 794 / Math.min(900, Math.max(200, pagesEl.clientWidth - 32));
  editor.relayout();
  const done = () => { editor.zoom = prevZoom; pagesEl.style.width = prevWidth; editor.relayout(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

/* ---------------- Verdrahtung ---------------- */
function wire() {
  $('#btn-new').onclick = () => createNote();
  $('#btn-import').onclick = () => chooseFiles(false);
  $('#file-input').onchange = e => startImport(e.target.files);
  $('#imp-ok').onclick = e => {
    e.preventDefault();
    const folder = $('#imp-folder').value.trim();
    $('#dlg-import').close();
    runImport(pendingFiles, folder);
  };
  $('#btn-toggle-side').onclick = () => toggleSidebar();
  $('#search').oninput = e => { state.search = e.target.value; renderList(); };
  $('#search').onkeydown = e => {
    if (e.key === 'Enter') { const n = visibleNotes()[0]; if (n) openNote(n); }
    if (e.key === 'Escape') { e.target.value = ''; state.search = ''; renderList(); e.target.blur(); }
  };
  $('#note-title').oninput = e => { if (state.current) { state.current.title = e.target.value; scheduleSave(); } };
  $('#note-title').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); editor.typeAnywhere(''); } };
  $('#note-folder').onchange = async e => {
    let v = e.target.value;
    if (v === '__new') {
      v = (prompt('Name des neuen Ordners:') || '').trim();
      if (v && !state.extraFolders.includes(v)) { state.extraFolders.push(v); await db.setMeta('folders', state.extraFolders); }
      if (!v) { renderFolderSelect(); return; }
    }
    state.current.folder = v;
    scheduleSave(); renderFolderSelect(); renderList();
  };
  document.querySelectorAll('.tool').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
  $('#width').oninput = e => { if (editor.widths[editor.tool] != null) { editor.widths[editor.tool] = +e.target.value; savePrefs(); } };
  $('#btn-undo').onclick = () => editor.undo();
  $('#btn-redo').onclick = () => editor.redo();
  $('#btn-zoom-in').onclick = () => { editor.setZoom(editor.zoom * 1.15); savePrefs(); };
  $('#btn-zoom-out').onclick = () => { editor.setZoom(editor.zoom / 1.15); savePrefs(); };
  $('#zoom-label').onclick = () => { editor.setZoom(1); savePrefs(); };

  const menu = $('#more-menu');
  $('#btn-more').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('.menu-wrap')) menu.hidden = true; });
  $('#paper').onchange = e => editor.setPaper(e.target.value);
  $('#opt-finger').onchange = e => { editor.fingerDraws = e.target.checked; savePrefs(); };
  menu.addEventListener('click', e => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    menu.hidden = true;
    if (act === 'add-page') editor.addPage();
    if (act === 'insert-file') chooseFiles(true);
    if (act === 'print') printNote();
    if (act === 'shortcuts') $('#dlg-shortcuts').showModal();
    if (act === 'delete' && state.current) trashNote(state.current);
  });

  $('#btn-restore').onclick = async () => {
    const n = state.current;
    n.deleted = false; n.updatedAt = Date.now(); n.dirty = true;
    await db.putNote(n); state.folder = ALL; openNote(n);
  };
  $('#btn-purge').onclick = async () => {
    if (!confirm('Notiz endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return;
    const n = state.current;
    // Grabstein behalten, damit die Löschung auch auf andere Geräte synchronisiert wird
    Object.assign(n, { purged: true, deleted: true, pages: [], title: '', updatedAt: Date.now(), dirty: true });
    await db.putNote(n);
    openNote(visibleNotes()[0] || null);
  };

  $('#btn-settings').onclick = openSettings;
  document.querySelectorAll('input[name=set-mode]').forEach(r => { r.onchange = showMode; });
  $('#btn-sync').onclick = () => (sync.configured ? syncNow() : openSettings());
  $('#btn-test').onclick = async () => {
    const out = $('#set-result');
    out.textContent = 'Teste …';
    try {
      const cfg = readSettings();
      const r = await sync.test(cfg);
      out.textContent = `✓ Verbunden – ${r.notes} Notiz(en) ${cfg.mode === 'nextcloud' ? 'in deiner Nextcloud' : 'auf dem Server'}.`;
    } catch (err) { out.textContent = '✗ ' + (err.message === 'Failed to fetch' ? 'Server nicht erreichbar (Adresse/Netzwerk prüfen)' : err.message); }
  };
  $('#btn-save-settings').onclick = async () => {
    await sync.saveConfig(readSettings());
    $('#dlg-settings').close();
    setupAutoSync();
    syncNow();
  };
  $('#btn-backup').onclick = async () => {
    const blob = await exportBackup(state.notes.filter(n => !n.purged));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `feder-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  // Drag & Drop von Dateien
  let dragDepth = 0, overlay = null;
  window.addEventListener('dragenter', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth++;
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'drop-overlay'; overlay.textContent = 'Dateien hier ablegen zum Importieren'; document.body.appendChild(overlay); }
  });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0 && overlay) { overlay.remove(); overlay = null; dragDepth = 0; } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0; if (overlay) { overlay.remove(); overlay = null; }
    if (e.dataTransfer.files.length) { insertMode = false; startImport(e.dataTransfer.files); }
  });

  window.addEventListener('online', () => sync.sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushSave().then(() => sync.configured && sync.config.auto && sync.sync()); }
    else if (sync.configured && sync.config.auto) sync.sync();
  });
  window.addEventListener('beforeunload', () => { if (saveTimer && state.current) db.putNote(state.current); });
}

/* ---------------- Start ---------------- */
async function init() {
  renderColors();
  wire();
  const prefs = await db.getMeta('prefs', {});
  if (prefs.widths) Object.assign(editor.widths, prefs.widths);
  if (prefs.zoom) { editor.zoom = prefs.zoom; $('#zoom-label').textContent = Math.round(prefs.zoom * 100) + '%'; }
  editor.fingerDraws = !!prefs.fingerDraws;
  $('#opt-finger').checked = editor.fingerDraws;
  if (prefs.sideHidden) document.body.classList.add('side-hidden');
  setColor(prefs.color || COLORS[0]);
  setTool(prefs.tool || 'pen');

  state.extraFolders = await db.getMeta('folders', []);
  state.notes = await db.allNotes();
  await sync.loadConfig();
  sync.onStatus(sync.configured ? 'ok' : 'off', sync.configured ? 'Sync bereit' : 'Sync: nicht eingerichtet');
  setupAutoSync();

  const lastId = await db.getMeta('lastNote');
  const last = state.notes.find(n => n.id === lastId && !n.deleted);
  if (last) openNote(last);
  else { document.body.classList.add('no-note'); renderList(); }
  if (sync.configured) syncNow();

  document.body.dataset.platform = platform;
  if (platform !== 'web') $('#file-input').removeAttribute('accept');   // Android kennt .sdocx nicht als Dateityp
  if (platform === 'web' && 'serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker:', err));
  }
}

init();
