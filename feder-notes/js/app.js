import { db, uid } from './db.js';
import { Editor, newPage, drawStroke, PAGE_W, FONTS, DEFAULT_TEXT, PAPER_COLORS, inkColor, tableRow, tableCol, renderLatex } from './editor.js';
import { importFileAsNote, fileToPages, exportBackup, readBackup, storeAsset } from './import.js';
import { Sync } from './sync.js';
import { escapeHTML } from './sanitize.js';
import { platform } from './transport.js';
import { normalizeNcUrl, ncLogin } from './nextcloud.js';
import { recognize, getApiKey, setApiKey } from './convert.js';

const $ = sel => document.querySelector(sel);
const TRASH = '__trash', ALL = '__all';
const DEFAULT_SLOTS = ['#1d1d1f', '#1c56c9', '#e03131', '#2f9e44', '#f08c00', '#ffd43b'];
const PALETTE = [
  '#000000', '#3d3d3d', '#7a7a7a', '#b8b8b8', '#ffffff', '#5c3a21', '#8d6e63', '#c9a27e',
  '#c92a2a', '#e03131', '#f06595', '#d6336c', '#ae3ec9', '#7048e8', '#4263eb', '#1c56c9',
  '#1098ad', '#0ca678', '#2f9e44', '#74b816', '#fab005', '#ffd43b', '#f08c00', '#e8590c',
];
const KINDS = [
  ['fountain', 'Füller'], ['ball', 'Kuli'], ['pencil', 'Bleistift'], ['calli', 'Kalligrafie'],
];
const TOOLS = ['pen', 'highlighter', 'eraser', 'lasso', 'keyboard', 'text'];
const FAV = '__fav';
// Drei schnelle Strichstärken wie bei Samsung Notes
const WIDTH_PRESETS = { pen: [1.5, 2.5, 4.5], highlighter: [12, 22, 34], eraser: [10, 20, 40] };
const wide = () => false;   // immer eine Ansicht: Übersicht ODER Notiz (auch am Tablet)
const FONT_NAMES = { sans: 'Sans', serif: 'Serif', mono: 'Schreibmaschine', hand: 'Handschrift' };
const SIZES = [16, 18, 20, 22, 24, 26, 28, 30, 32, 34];
const TEXT_COLORS = ['#1d1d1f', '#5c5c66', '#1c56c9', '#e03131', '#2f9e44', '#ae3ec9', '#f08c00'];
const PAPERS = [['lined', 'Liniert'], ['grid', 'Kariert'], ['dots', 'Punkte'], ['blank', 'Blanko']];

const state = {
  notes: [],
  current: null,
  folder: ALL,
  search: '',
  extraFolders: [],
  colorSlots: [...DEFAULT_SLOTS],
  defaults: { paper: 'lined', text: { ...DEFAULT_TEXT } },   // für neue Notizen
  typing: true,                                              // einfach lostippen → Textfeld
  theme: 'system',
};

/* ---------------- Bilder ---------------- */
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
let zoomTimer;
const editor = window.__federEditor = new Editor($('#pages'), {
  getAssetURL,
  onChange: () => scheduleSave(),
  onHistory: (u, r) => { $('#btn-undo').disabled = !u; $('#btn-redo').disabled = !r; },
  onTextFocus: wrap => showFormatBar(wrap),
  onShape: label => toast(label + ' ✓', 900),
  onInfo: msg => toast(msg),
  onWantLasso: () => { if (editor.tool !== 'lasso') { editor.tool = 'lasso'; $('#pages').dataset.tool = 'lasso'; renderToolbar(); } },
  onSelectionStyle: anchor => openSelectionStyle(anchor),
  onPlayAudio: (au, el) => playAudio(au, el),
  onRecognize: kind => startRecognize(kind),
  onEditFormula: (f, pv) => openFormulaEdit(f, pv),
  onKeyboardMode: () => { if (editor.tool !== 'keyboard') { editor.tool = 'keyboard'; $('#pages').dataset.tool = 'keyboard'; renderToolbar(); savePrefs(); } },
  onFormatChange: () => { const w = editor.focusedBox; if (w) showFormatBar(w); },
  onTextBlur: () => setTimeout(() => { if (!editor.focusedBox && !formatBarBusy) $('#formatbar').hidden = true; }, 150),
  onZoomPreview: z => { $('#zoom-chip').textContent = Math.round(z * 100) + ' %'; $('#zoom-chip').hidden = false; },
  onZoom: z => {
    const chip = $('#zoom-chip');
    chip.textContent = Math.round(z * 100) + ' %';
    chip.hidden = false;
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => { chip.hidden = true; }, 1800);
    savePrefs();
  },
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
  saveTimer = null;
  await db.putNote(note);
  renderHome();
}
async function flushSave() {
  if (saveTimer && state.current) await saveNote(state.current);
}

/* ---------------- Vorschaubilder ---------------- */
const thumbQueue = new Set();
let thumbBusy = false;
function wantThumb(n) {
  if (n.purged || (n.thumb && n.thumbAt === n.updatedAt)) return;
  thumbQueue.add(n);
  if (!thumbBusy) setTimeout(runThumbs, 400);
}
async function runThumbs() {
  thumbBusy = true;
  for (const n of [...thumbQueue]) {
    thumbQueue.delete(n);
    if (n === state.current && saveTimer) { thumbQueue.add(n); continue; }   // noch in Bearbeitung
    try {
      n.thumb = await makeThumb(n);
      n.thumbAt = n.updatedAt;
      await db.putNote(n);
      const img = document.querySelector(`.card[data-id="${n.id}"] .thumb`);
      if (img) img.innerHTML = `<img alt="" src="${n.thumb}">`;
    } catch (err) { console.warn('Vorschau', err); }
    await new Promise(r => setTimeout(r, 30));
  }
  thumbBusy = false;
  if (thumbQueue.size) setTimeout(runThumbs, 1500);
}

async function makeThumb(n) {
  const W = 240, s = W / PAGE_W, H = Math.round(W * 4 / 3);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const pc = PAPER_COLORS[n.paperColor || 'white'] || PAPER_COLORS.white;
  ctx.fillStyle = pc.bg; ctx.fillRect(0, 0, W, H);
  const page = n.pages[0];
  if (!page) return c.toDataURL('image/jpeg', 0.72);
  if (page.bg && page.bg.asset) {
    const url = await getAssetURL(page.bg.asset);
    if (url) {
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      if (img.naturalWidth) ctx.drawImage(img, 0, 0, W, page.h * s);
    }
  } else if ((n.paper || 'lined') !== 'blank') {
    ctx.strokeStyle = pc.line; ctx.lineWidth = 1;
    for (let y = 80; y < page.h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y * s); ctx.lineTo(W, y * s); ctx.stroke(); }
  }
  ctx.save();
  ctx.scale(s, s);
  for (const im of page.images || []) {
    const url = await getAssetURL(im.asset);
    if (!url) continue;
    const img = new Image(); img.src = url;
    await img.decode().catch(() => {});
    if (img.naturalWidth) ctx.drawImage(img, im.x, im.y, im.w, im.h);
  }
  for (const st of page.strokes) drawStroke(ctx, st, pc.dark);
  ctx.fillStyle = inkColor('#1d1d1f', pc.dark);
  ctx.font = '24px sans-serif';
  const div = document.createElement('div');
  for (const t of [page.main && { ...page.main, x: 96, y: 80, w: 864 }, ...page.texts].filter(Boolean)) {
    div.innerHTML = (t.html || '').replace(/<(\/?(?:div|p|li|h[1-3]|br)\b[^>]*)>/gi, '\n<$1>');
    const maxW = t.w || 840;
    let y = t.y + 28;
    for (const para of div.textContent.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, t.x + 6, y); y += 40; line = word; }
        else line = test;
        if (y > page.h) break;
      }
      if (line) { ctx.fillText(line, t.x + 6, y); y += 40; }
      if (y > page.h) break;
    }
  }
  for (const f of page.formulas || []) { ctx.font = `${f.size}px serif`; ctx.fillText(f.text || f.latex, f.x, f.y + f.size); }
  ctx.restore();
  return c.toDataURL('image/jpeg', 0.72);
}

/* ---------------- Notizen ---------------- */
function visibleNotes() {
  const q = state.search.trim().toLowerCase();
  return state.notes
    .filter(n => !n.purged)
    .filter(n => state.folder === TRASH ? n.deleted : !n.deleted)
    .filter(n => state.folder === ALL || state.folder === TRASH || (state.folder === FAV ? n.fav : n.folder === state.folder))
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
    for (const t of [p.main, ...p.texts].filter(Boolean)) { div.innerHTML = (t.html || '').replace(/<(\/?(?:div|p|li|h[1-3]|br)\b[^>]*)>/gi, ' <$1>'); parts.push(div.textContent); }
    if (p.searchText) parts.push(p.searchText);
    for (const f of p.formulas || []) parts.push(f.text || f.latex);
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

async function createNote() {
  await flushSave();
  const folder = state.folder !== ALL && state.folder !== TRASH && state.folder !== FAV ? state.folder : '';
  const now = Date.now();
  const note = {
    id: uid(), title: '', folder, paper: state.defaults.paper, paperColor: state.defaults.paperColor || 'white', textStyle: { ...state.defaults.text },
    pages: [newPage()], createdAt: now, updatedAt: now, deleted: false, dirty: true,
  };
  state.notes.push(note);
  await db.putNote(note);
  if (state.folder === TRASH) state.folder = ALL;
  await openNote(note);
  return note;
}

async function openNote(note) {
  await flushSave();
  closePopover();
  state.current = note;
  document.body.classList.toggle('no-note', !note);
  $('#trash-bar').hidden = !(note && note.deleted);
  if (note) {
    $('#note-title').value = note.title || '';
    $('#formatbar').hidden = true;
    renderFolderSelect();
    db.setMeta('lastNote', note.id);
    showEditor();
    await db.setMeta('openingNote', note.id);
  }
  editor.load(note, { readOnly: !!(note && note.deleted) });
  if (note) setTimeout(() => db.setMeta('openingNote', null), 1500);
  renderHome();
}

async function trashNote(note) {
  note.deleted = true; note.updatedAt = Date.now(); note.dirty = true;
  await db.putNote(note);
  toast('In den Papierkorb verschoben');
  await openNote(wide() ? visibleNotes()[0] || null : null);
  if (!wide()) showHome();
}

/* ---------------- Ansichten ---------------- */
function showEditor() {
  document.body.classList.remove('view-home');
  document.body.classList.add('view-editor');
  setTimeout(() => editor.relayout(), 0);
}
function showHome() {
  closePopover();
  flushSave();
  document.body.classList.remove('view-editor');
  document.body.classList.add('view-home');
  if (state.current) wantThumb(state.current);
  renderHome();
}

/** Zurück-Taste (Android) und Esc: schließt Ebenen von oben nach unten. true = behandelt. */
window.federBack = () => {
  if (!$('#popover').hidden) { closePopover(); return true; }
  if (document.body.classList.contains('drawer-open')) { toggleDrawer(false); return true; }
  const dlg = document.querySelector('dialog[open]');
  if (dlg) { dlg.close(); return true; }
  if (!$('#more-menu').hidden) { $('#more-menu').hidden = true; return true; }
  if (!$('#search-bar').hidden && document.body.classList.contains('view-home')) { closeSearch(); return true; }
  if (document.body.classList.contains('view-editor') && !wide()) { document.activeElement && document.activeElement.blur && document.activeElement.blur(); showHome(); return true; }
  return false;
};

function toggleDrawer(open) {
  const on = open ?? !document.body.classList.contains('drawer-open');
  document.body.classList.toggle('drawer-open', on);
  $('#scrim').hidden = !on;
}

function closeSearch() {
  $('#search-bar').hidden = true;
  $('#search').value = ''; state.search = '';
  renderHome();
}

/* ---------------- Übersicht zeichnen ---------------- */
function renderHome() {
  renderFolders();
  const title = state.folder === ALL ? 'Alle Notizen' : state.folder === TRASH ? 'Papierkorb' : state.folder === FAV ? 'Favoriten' : state.folder;
  $('#folder-title').textContent = title;
  const notes = visibleNotes();
  $('#note-count').textContent = `${notes.length} ${notes.length === 1 ? 'Notiz' : 'Notizen'}`;
  $('#connect-banner').hidden = sync.configured;
  $('#btn-empty-trash').hidden = !(state.folder === TRASH && notes.length);

  const grid = $('#note-grid');
  const q = state.search.trim();
  grid.innerHTML = '';
  if (!notes.length) {
    grid.innerHTML = `<div class="empty-list">${q ? 'Nichts gefunden.' : state.folder === TRASH ? 'Der Papierkorb ist leer.' : 'Noch keine Notizen.<br>Tippe auf <strong>+</strong> oder importiere deine Dateien.'}</div>`;
    return;
  }
  const hl = s => q ? escapeHTML(s).replace(new RegExp(escapeRe(escapeHTML(q)), 'gi'), m => `<mark>${m}</mark>`) : escapeHTML(s);
  for (const n of notes) {
    const card = document.createElement('button');
    card.className = 'card' + (state.current && state.current.id === n.id ? ' active' : '');
    card.dataset.id = n.id;
    card.setAttribute('role', 'listitem');
    const date = new Date(n.updatedAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: '2-digit' });
    let thumb;
    if (n.thumb) thumb = `<img alt="" src="${n.thumb}">`;
    else thumb = `<div class="ph">${escapeHTML(noteBodyText(n).slice(0, 220))}</div>`;
    let extra = '';
    if (q) {
      const body = noteBodyText(n), i = body.toLowerCase().indexOf(q.toLowerCase());
      if (i >= 0) extra = `<div class="m">${hl((i > 20 ? '…' : '') + body.slice(Math.max(0, i - 20), i + 40))}</div>`;
    }
    card.innerHTML = `<div class="thumb">${thumb}</div>
      <div class="t">${n.fav ? '<span class="up">★</span> ' : ''}${hl(n.title || 'Unbenannt')}</div>
      <div class="m"><span>${date}</span>${n.folder && state.folder === ALL ? `<span>· ${escapeHTML(n.folder)}</span>` : ''}${n.dirty && sync.configured ? '<span class="up" title="noch nicht synchronisiert">↑</span>' : ''}</div>${extra}`;
    card.insertAdjacentHTML('beforeend', '');
    card.querySelector('.thumb').insertAdjacentHTML('beforeend', '<span class="check"><svg><use href="#i-check"/></svg></span>');
    if (picked.has(n.id)) card.classList.add('selected');
    let pressT = null, longPressed = false;
    card.onpointerdown = () => {
      longPressed = false;
      pressT = setTimeout(() => {
        longPressed = true;
        if (navigator.vibrate) try { navigator.vibrate(15); } catch { /* egal */ }
        if (!document.body.classList.contains('selecting')) setSelecting(true);
        picked.add(n.id); updateSelectBar();
      }, 480);
    };
    const cancelPress = () => clearTimeout(pressT);
    card.onpointerup = cancelPress; card.onpointerleave = cancelPress; card.onpointercancel = cancelPress;
    card.oncontextmenu = e => { e.preventDefault(); cancelPress(); if (!longPressed) { if (!document.body.classList.contains('selecting')) setSelecting(true); picked.add(n.id); updateSelectBar(); } longPressed = true; };
    card.onclick = () => {
      if (longPressed) { longPressed = false; return; }
      if (document.body.classList.contains('selecting')) togglePick(n.id);
      else openNote(n);
    };
    grid.appendChild(card);
    wantThumb(n);
  }
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function renderFolders() {
  const counts = {};
  let all = 0, trash = 0;
  for (const n of state.notes) {
    if (n.purged) continue;
    if (n.deleted) { trash++; continue; }
    all++;
    counts[n.folder] = (counts[n.folder] || 0) + 1;
  }
  const favs = state.notes.filter(n => n.fav && !n.deleted && !n.purged).length;
  const items = [[ALL, 'Alle Notizen', all, 'i-notes'], [FAV, 'Favoriten', favs, 'i-star'], ...folders().map(f => [f, f, counts[f] || 0, 'i-folder'])];
  items.push([TRASH, 'Papierkorb', trash, 'i-trash']);
  const el = $('#folders');
  el.innerHTML = '';
  for (const [key, label, n, icon] of items) {
    const b = document.createElement('button');
    b.className = 'drawer-item' + (state.folder === key ? ' active' : '');
    b.innerHTML = `<svg><use href="#${icon}"/></svg>${escapeHTML(label)}<span class="n">${n}</span>`;
    b.onclick = () => { state.folder = key; toggleDrawer(false); setSelecting(false); renderHome(); };
    el.appendChild(b);
  }
  $('#folder-datalist').innerHTML = folders().map(f => `<option value="${escapeHTML(f)}">`).join('');
}

function renderFolderSelect() {
  const sel = $('#note-folder');
  const cur = state.current ? state.current.folder : '';
  const opts = ['', ...folders()];
  if (cur && !opts.includes(cur)) opts.push(cur);
  sel.innerHTML = opts.map(f => `<option value="${escapeHTML(f)}">${f ? escapeHTML(f) : 'Kein Ordner'}</option>`).join('')
    + '<option value="__new">+ Neuer Ordner …</option>';
  sel.value = cur;
}

function askFolderName() {
  return new Promise(resolve => {
    const dlg = $('#dlg-folder');
    $('#folder-name').value = '';
    dlg.returnValue = '';
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? $('#folder-name').value.trim() : null);
    dlg.showModal();
  });
}
async function addFolder(name) {
  if (!name) return;
  if (!state.extraFolders.includes(name)) state.extraFolders.push(name);
  await db.setMeta('folders', state.extraFolders);
}

/* ---------------- Werkzeuge & Farben ---------------- */
function setTool(tool) {
  editor.tool = tool;
  $('#pages').dataset.tool = tool;
  if (tool !== 'lasso') editor.clearSelection();
  renderToolbar();
  savePrefs();
  if (tool === 'keyboard' && state.current && !state.current.deleted) editor.focusKeyboard();
  else if (tool !== 'text' && editor.focusedBox) document.activeElement.blur();
}

function onToolClick(tool) {
  if (editor.tool === tool && ['pen', 'highlighter', 'eraser'].includes(tool)) {
    if ($('#popover').hidden || popoverFor !== tool) openToolPopover(tool);
    else closePopover();
    return;
  }
  closePopover();
  if (editor.tool === tool && tool === 'keyboard') { editor.focusKeyboard(); return; }
  setTool(tool);
}

function renderToolbar() {
  document.querySelectorAll('.tool').forEach(b => {
    const t = b.dataset.tool;
    b.classList.toggle('active', t === editor.tool);
    if (t === 'pen') {
      b.querySelector('use').setAttribute('href', '#i-' + editor.penKind);
      b.title = `${KINDS.find(k => k[0] === editor.penKind)[1]} (Alt+1) – nochmal tippen für Stiftart, Stärke & Farbe`;
    }
    if (t === 'pen' || t === 'highlighter') {
      let ink = b.querySelector('.ink');
      if (!ink) { ink = document.createElement('span'); ink.className = 'ink'; b.appendChild(ink); }
      ink.style.background = editor.styles[t === 'pen' ? editor.penKind : 'highlighter'].color;
    }
  });
  renderColors();
  renderWidths();
}

function presetKey() {
  return editor.tool === 'highlighter' ? 'highlighter' : editor.tool === 'eraser' ? 'eraser' : 'pen';
}

function renderWidths() {
  const el = $('#widths');
  const key = presetKey();
  const cur = key === 'eraser' ? editor.eraser.width : editor.styles[key === 'pen' ? editor.penKind : 'highlighter'].width;
  el.innerHTML = '';
  WIDTH_PRESETS[key].forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'wbtn' + (Math.abs(w - cur) < 0.01 ? ' active' : '');
    b.title = ['Dünn', 'Mittel', 'Dick'][i];
    b.innerHTML = `<i style="height:${[2, 4, 7][i]}px"></i>`;
    b.onclick = () => {
      if (key === 'eraser') editor.eraser.width = w;
      else {
        if (editor.tool !== 'pen' && editor.tool !== 'highlighter') { editor.tool = 'pen'; $('#pages').dataset.tool = 'pen'; }
        if (editor.selection) { editor.styleSelection({ width: w }); renderWidths(); return; }
        editor.styles[key === 'pen' ? editor.penKind : 'highlighter'].width = w;
      }
      renderToolbar(); savePrefs();
    };
    el.appendChild(b);
  });
}

/** Aktive Farbe = Farbe des aktuellen Stifts (Füller/Kuli/… oder Marker) */
function currentInkKey() {
  return editor.tool === 'highlighter' ? 'highlighter' : editor.penKind;
}

function renderColors() {
  const el = $('#colors');
  el.innerHTML = '';
  const cur = editor.styles[currentInkKey()].color.toLowerCase();
  const inkTool = editor.tool === 'pen' || editor.tool === 'highlighter';
  let marked = false;
  state.colorSlots.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.title = 'Farbe – nochmal tippen zum Ändern';
    if (inkTool && !marked && c.toLowerCase() === cur) { b.classList.add('active'); marked = true; }
    b.onclick = () => onSlotClick(i, b.classList.contains('active'));
    el.appendChild(b);
  });
}

function onSlotClick(i, isActive) {
  if (isActive) { openSlotEditor(i); return; }
  closePopover();
  applyColor(state.colorSlots[i]);
}

function applyColor(color) {
  if (editor.recolorSelection(color)) { toast('Auswahl umgefärbt'); return; }
  if (editor.tool !== 'pen' && editor.tool !== 'highlighter') editor.tool = 'pen';
  editor.styles[currentInkKey()].color = color;
  renderToolbar();
  savePrefs();
}

/* ---------------- Popover (Stift-Einstellungen) ---------------- */
let popoverFor = null;

function closePopover() {
  $('#popover').hidden = true;
  popoverFor = null;
}

function placePopover(anchor) {
  const pop = $('#popover');
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
  pop.style.left = left + 'px';
  pop.style.top = (r.bottom + 10) + 'px';
}

function openToolPopover(tool) {
  const pop = $('#popover');
  popoverFor = tool;
  pop.innerHTML = '';
  const anchor = document.querySelector(`.tool[data-tool="${tool}"]`);

  if (tool === 'eraser') {
    pop.innerHTML = `
      <div class="pop-title">Radierer</div>
      <div class="seg"><button data-m="stroke">Ganzer Strich</button><button data-m="area">Nur Stelle</button></div>
      <div class="size-row"><span>Größe</span><input type="range" min="6" max="80" step="1"><span class="val"></span></div>
      <button class="btn wide danger" data-act="clear">Seite leeren</button>
      <p class="pop-hint">Tipp: Mit gedrückter S-Pen-Taste radierst du jederzeit.</p>`;
    const seg = pop.querySelectorAll('.seg button');
    const sync = () => seg.forEach(b => b.classList.toggle('active', b.dataset.m === editor.eraser.mode));
    seg.forEach(b => { b.onclick = () => { editor.eraser.mode = b.dataset.m; sync(); savePrefs(); }; });
    sync();
    const range = pop.querySelector('input[type=range]'), val = pop.querySelector('.val');
    range.value = editor.eraser.width; val.textContent = editor.eraser.width;
    range.oninput = () => { editor.eraser.width = +range.value; val.textContent = range.value; savePrefs(); };
    pop.querySelector('[data-act=clear]').onclick = () => {
      if (editor.clearPage()) toast('Seite geleert – Rückgängig mit ↶'); else toast('Auf dieser Seite gibt es nichts zu löschen');
      closePopover();
    };
    placePopover(anchor);
    return;
  }

  const key = tool === 'highlighter' ? 'highlighter' : editor.penKind;
  const isPen = tool === 'pen';
  pop.innerHTML = `
    <div class="pop-title">${isPen ? 'Stift' : 'Textmarker'}</div>
    ${isPen ? `<div class="kinds">${KINDS.map(([k, label]) => `<button class="kind" data-k="${k}"><svg><use href="#i-${k}"/></svg>${label}</button>`).join('')}</div>` : ''}
    ${isPen ? '<div class="seg dash-seg"><button data-d="solid">Durchgezogen</button><button data-d="dash">Gestrichelt</button><button data-d="dot">Gepunktet</button></div>' : ''}
    <canvas class="preview"></canvas>
    <div class="size-row"><span>Stärke</span><input type="range"><span class="val"></span></div>
    <div class="palette"></div>`;
  const range = pop.querySelector('input[type=range]'), val = pop.querySelector('.val');
  const canvas = pop.querySelector('.preview');

  const refresh = () => {
    const k = tool === 'highlighter' ? 'highlighter' : editor.penKind;
    const st = editor.styles[k];
    pop.querySelectorAll('.kind').forEach(b => b.classList.toggle('active', b.dataset.k === editor.penKind));
    range.min = isPen ? 0.5 : 6; range.max = isPen ? 14 : 50; range.step = isPen ? 0.25 : 1;
    range.value = st.width; val.textContent = (+st.width).toFixed(isPen ? 1 : 0);
    pop.querySelectorAll('.dash-seg button').forEach(b => b.classList.toggle('active', (st.dash || 'solid') === b.dataset.d));
    drawPreview(canvas, { tool, kind: isPen ? editor.penKind : undefined, color: st.color, width: st.width, dash: isPen && st.dash !== 'solid' ? st.dash : undefined });
    pop.querySelectorAll('.palette .swatch').forEach(s => s.classList.toggle('active', s.dataset.c && s.dataset.c.toLowerCase() === st.color.toLowerCase()));
    renderToolbar();
  };
  pop.querySelectorAll('.kind').forEach(b => { b.onclick = () => { editor.penKind = b.dataset.k; refresh(); savePrefs(); }; });
  pop.querySelectorAll('.dash-seg button').forEach(b => { b.onclick = () => { editor.styles[editor.penKind].dash = b.dataset.d; refresh(); savePrefs(); }; });
  range.oninput = () => { editor.styles[tool === 'highlighter' ? 'highlighter' : editor.penKind].width = +range.value; refresh(); savePrefs(); };
  buildPalette(pop.querySelector('.palette'), c => {
    editor.styles[tool === 'highlighter' ? 'highlighter' : editor.penKind].color = c;
    refresh(); savePrefs();
  });
  placePopover(anchor);
  refresh();
  void key;
}

/** Farbfeld oben ändern: Palette öffnen, gewählte Farbe ersetzt das Feld dauerhaft. */
function openSlotEditor(i) {
  const pop = $('#popover');
  popoverFor = 'slot' + i;
  pop.innerHTML = `<div class="pop-title">Farbfeld ändern</div><div class="palette"></div>
    <p class="pop-hint">Die gewählte Farbe ersetzt dieses Farbfeld – auch nach einem Neustart.</p>`;
  buildPalette(pop.querySelector('.palette'), c => {
    state.colorSlots[i] = c;
    db.setMeta('colorSlots', state.colorSlots);
    applyColor(c);
    closePopover();
  }, state.colorSlots[i]);
  placePopover($('#colors').children[i]);
}

function buildPalette(el, onPick, current) {
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c; b.dataset.c = c; b.title = c;
    if (current && current.toLowerCase() === c) b.classList.add('active');
    b.onclick = () => onPick(c);
    el.appendChild(b);
  }
  const custom = document.createElement('button');
  custom.className = 'swatch native'; custom.title = 'Eigene Farbe';
  custom.onclick = () => {
    const input = $('#color-native');
    input.value = current || '#1d1d1f';
    input.onchange = () => onPick(input.value);
    input.click();
  };
  el.appendChild(custom);
}

function drawPreview(canvas, st) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 56;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const points = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    points.push([16 + t * (w - 32), h / 2 + Math.sin(t * Math.PI * 2) * (h / 4), 0.25 + 0.75 * Math.sin(t * Math.PI)]);
  }
  drawStroke(ctx, { ...st, points });
}

/* ---------------- Einstellungen merken ---------------- */
let prefsTimer;
function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => db.setMeta('prefs', {
    tool: editor.tool, penKind: editor.penKind, styles: editor.styles, eraser: editor.eraser,
    zoom: editor.zoom, fingerDraws: editor.fingerDraws,
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
  $('#imp-folder').value = state.folder !== ALL && state.folder !== TRASH ? state.folder : '';
  $('#dlg-import').showModal();
}

async function runImport(files, folder) {
  let last = null, ok = 0;
  if (folder) await addFolder(folder);
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
  renderHome();
  if (last) { openNote(last); toast(`${ok} von ${files.length} Datei(en) importiert`); maybeAutoSync(); }
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
  renderHome();
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
      const busy = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tb, #note-title');
      if (!busy && !editor.active) { const top = $('#pages').scrollTop; await openNote(note); $('#pages').scrollTop = top; }
      else state.current = note;
    }
    renderHome();
  },
});

let autoTimer = null;
/* Zeitplan: live (jede Minute) | every2h | daily (Uhrzeit) | manual */
function schedule() {
  const c = sync.config || {};
  if (c.schedule) return c.schedule;
  return c.auto === false ? 'manual' : 'every2h';
}
function dailyAt(now = new Date()) {
  const [h, m] = ((sync.config && sync.config.dailyAt) || '16:00').split(':').map(Number);
  const d = new Date(now); d.setHours(h || 0, m || 0, 0, 0);
  return d;
}
/** Ist ein automatischer Abgleich fällig? */
async function autoSyncDue() {
  if (!sync.configured) return false;
  const mode = schedule();
  if (mode === 'manual') return false;
  if (sync.config.wifiOnly && navigator.connection && navigator.connection.type === 'cellular') return false;
  if (mode === 'live') return true;
  const last = await db.getMeta('lastSyncAt', 0);
  const now = Date.now();
  if (mode === 'every2h') return now - last >= 2 * 3600_000;
  if (mode === 'daily') { const at = dailyAt().getTime(); return now >= at && last < at; }
  return false;
}
function nextSyncText() {
  const mode = schedule();
  if (!sync.configured) return '';
  if (mode === 'manual') return 'Nur manuell';
  if (mode === 'daily') return 'Nächster Abgleich ' + ((sync.config && sync.config.dailyAt) || '16:00');
  if (mode === 'every2h') return 'Abgleich alle 2 Std.';
  return '';
}
async function maybeAutoSync() {
  if (await autoSyncDue()) await syncNow();
}
function setupAutoSync() {
  clearInterval(autoTimer);
  if (!sync.configured || schedule() === 'manual') return;
  // „live“: jede Minute; sonst alle 5 Minuten prüfen, ob die geplante Zeit erreicht ist
  autoTimer = setInterval(() => maybeAutoSync(), schedule() === 'live' ? 60_000 : 300_000);
}
async function syncNow() {
  await flushSave();
  await sync.sync();
  if (/^(Synchronisiert|Nextcloud)/.test($('#sync-status').textContent)) await db.setMeta('lastSyncAt', Date.now());
  const hint = nextSyncText();
  const el = $('#sync-status');
  if (hint && !/Fehler|Offline/.test(el.textContent)) el.textContent += ' · ' + hint;
  renderHome();
}

/* ---------------- Nextcloud-Dialog ---------------- */
let loginRun = 0;
async function openSettings() {
  const cfg = sync.config || {};
  const connected = sync.configured && cfg.mode === 'nextcloud';
  $('#nc-connected').hidden = !connected;
  $('#nc-login').hidden = connected;
  if (connected) {
    $('#nc-who').textContent = `Verbunden als ${cfg.ncUser}`;
    $('#nc-where').textContent = `${cfg.ncUrl.replace(/^https?:\/\//, '')} · Ordner „${cfg.ncFolder || 'FederNotes'}“`;
  }
  $('#set-nc-url').value = cfg.ncUrl || (await db.getMeta('ncLastUrl', '')) || '';
  $('#set-nc-folder').value = cfg.ncFolder || 'FederNotes';
  $('#set-nc-user').value = cfg.ncUser || '';
  $('#set-nc-pass').value = '';
  $('#set-schedule').value = schedule();
  $('#set-daily').value = cfg.dailyAt || '16:00';
  $('#set-wifi').checked = !!cfg.wifiOnly;
  $('#row-daily').hidden = schedule() !== 'daily';
  $('#set-url').value = cfg.mode === 'server' ? cfg.url || '' : '';
  $('#set-token').value = '';
  $('#set-result').textContent = '';
  $('#login-status').textContent = platform === 'web' ? 'Hinweis: Im normalen Browser blockiert Nextcloud die Anmeldung – nutze die App.' : '';
  $('#advanced').open = false;
  fillGeneralSettings();
  $('#dlg-settings').showModal();
}

async function connect(cfg) {
  await sync.saveConfig({ mode: 'nextcloud', schedule: $('#set-schedule').value, dailyAt: $('#set-daily').value || '16:00', wifiOnly: $('#set-wifi').checked, ncFolder: $('#set-nc-folder').value.trim().replace(/^\/+|\/+$/g, '') || 'FederNotes', ...cfg });
  await db.setMeta('ncLastUrl', cfg.ncUrl);
  setupAutoSync();
  if ($('#dlg-settings').open) $('#dlg-settings').close();
  toast('Mit Nextcloud verbunden ✓');
  renderHome();
  syncNow();
}

async function startLogin() {
  const run = ++loginRun;
  const status = $('#login-status');
  const url = normalizeNcUrl($('#set-nc-url').value);
  const btn = $('#btn-nc-login');
  btn.disabled = true;
  status.textContent = 'Verbinde …';
  try {
    const creds = await ncLogin(url, {
      onWaiting: () => { status.textContent = 'Im Browser auf „Anmelden“ und „Zugriff gewähren“ tippen – danach hierher zurückkehren. Ich warte …'; },
      isCancelled: () => run !== loginRun || !$('#dlg-settings').open,
    });
    status.textContent = 'Angemeldet – richte Ordner ein …';
    const cfg = { ...creds, ncFolder: $('#set-nc-folder').value.trim() || 'FederNotes' };
    await sync.test({ mode: 'nextcloud', ...cfg });
    await connect(creds);
  } catch (err) {
    if (run === loginRun) status.textContent = '✗ ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- Bestätigen (eigener Dialog – Android-WebView zeigt confirm() oft nicht) ---------------- */
function askConfirm(title, text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    const dlg = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const ok = $('#confirm-ok');
    ok.textContent = okLabel;
    ok.classList.toggle('danger-fill', danger);
    dlg.returnValue = '';
    dlg.onclose = () => resolve(dlg.returnValue === 'ok');
    dlg.showModal();
  });
}

/* ---------------- Auswahl in der Übersicht (lange drücken, wie bei Samsung) ---------------- */
const picked = new Set();
function setSelecting(on) {
  if (!on) picked.clear();
  document.body.classList.toggle('selecting', on);
  $('#select-bar').hidden = !on;
  document.querySelector('.home-bar:not(.select-bar)').hidden = on;
  updateSelectBar();
}
function updateSelectBar() {
  $('#sel-count').textContent = `${picked.size} ausgewählt`;
  const inTrash = state.folder === TRASH;
  $('#sel-restore').hidden = !inTrash;
  $('#sel-fav').hidden = inTrash;
  $('#sel-move').hidden = inTrash;
  document.querySelectorAll('.card').forEach(c => c.classList.toggle('selected', picked.has(c.dataset.id)));
}
function togglePick(id) {
  if (picked.has(id)) picked.delete(id); else picked.add(id);
  if (!picked.size) setSelecting(false); else updateSelectBar();
}
const pickedNotes = () => state.notes.filter(n => picked.has(n.id));

async function purgeNotes(notes) {
  for (const n of notes) {
    // Grabstein behalten, damit die Löschung auch auf andere Geräte synchronisiert wird
    Object.assign(n, { purged: true, deleted: true, pages: [], title: '', thumb: null, updatedAt: Date.now(), dirty: true });
    await db.putNote(n);
  }
}

async function deletePicked() {
  const notes = pickedNotes();
  if (!notes.length) return;
  if (state.folder === TRASH) {
    if (!await askConfirm('Endgültig löschen?', `${notes.length} Notiz(en) werden dauerhaft gelöscht – auch in der Nextcloud. Das kann nicht rückgängig gemacht werden.`, 'Endgültig löschen', true)) return;
    await purgeNotes(notes);
    toast(`${notes.length} Notiz(en) gelöscht`);
  } else {
    for (const n of notes) { n.deleted = true; n.updatedAt = Date.now(); n.dirty = true; await db.putNote(n); }
    toast(`${notes.length} Notiz(en) in den Papierkorb verschoben`);
  }
  if (state.current && notes.includes(state.current)) await openNote(null);
  setSelecting(false);
  renderHome();
}

/* ---------------- Kleinkram ---------------- */
let toastTimer;
function toast(msg, ms = 2500) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function isEditable(el) {
  return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function printNote() {
  if (!state.current) return;
  const prevZoom = editor.zoom;
  const pagesEl = $('#pages');
  editor.zoom = 794 / Math.min(900, Math.max(200, pagesEl.clientWidth - 32));
  editor.relayout();
  const done = () => { editor.zoom = prevZoom; editor.relayout(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

/* ---------------- Tastatur ---------------- */
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const editing = isEditable(document.activeElement);
  if (document.querySelector('dialog[open]')) return;

  if ((mod && k === 'n') || (e.altKey && e.code === 'KeyN')) { e.preventDefault(); createNote(); return; }
  if (mod && k === 'f') { e.preventDefault(); if (!wide()) showHome(); $('#search-bar').hidden = false; $('#search').focus(); return; }
  if (mod && k === 's') { e.preventDefault(); syncNow(); return; }
  if (mod && k === 'p') { e.preventDefault(); printNote(); return; }
  if (e.key === 'Escape' && !editing) { if (!window.federBack()) editor.clearSelection(); return; }
  if (!state.current || !document.body.classList.contains('view-editor') && !wide()) return;
  if (mod && (k === '+' || k === '=')) { e.preventDefault(); editor.setZoom(editor.zoom * 1.15); return; }
  if (mod && k === '-') { e.preventDefault(); editor.setZoom(editor.zoom / 1.15); return; }
  if (mod && k === '0') { e.preventDefault(); editor.setZoom(1); return; }
  if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); editor.addPage(); return; }
  if (e.altKey && !mod && /^Digit[1-6]$/.test(e.code)) { e.preventDefault(); setTool(TOOLS[+e.code.slice(5) - 1]); return; }
  if (e.altKey && !mod && (e.code === 'KeyQ' || e.code === 'KeyW')) {
    e.preventDefault();
    const cur = state.colorSlots.findIndex(c => c.toLowerCase() === editor.styles[currentInkKey()].color.toLowerCase());
    const n = state.colorSlots.length;
    applyColor(state.colorSlots[((cur < 0 ? 0 : cur) + (e.code === 'KeyW' ? 1 : n - 1)) % n]);
    return;
  }
  if (editing) return;

  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); return; }
  if ((mod && k === 'y') || (mod && e.shiftKey && k === 'z')) { e.preventDefault(); editor.redo(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selection) { e.preventDefault(); editor.deleteSelection(); return; }
  if (mod && k === 'c' && editor.selection) { e.preventDefault(); editor.copySelection(); toast('Kopiert'); return; }
  if (mod && k === 'x' && editor.selection) { e.preventDefault(); editor.copySelection(); editor.deleteSelection(); return; }
  if (mod && k === 'd' && editor.selection) { e.preventDefault(); editor.copySelection(); editor.paste(20); return; }
  if (mod && k === 'v') { e.preventDefault(); editor.paste(20); return; }
  if (e.key === '?') { e.preventDefault(); $('#dlg-shortcuts').showModal(); return; }
  if (e.key === 'PageDown' || e.key === 'PageUp') return;
  if (state.typing && !mod && !e.altKey && (e.key.length === 1 || e.key === 'Enter') && !state.current.deleted) {
    e.preventDefault();
    editor.typeAnywhere(e.key === 'Enter' ? '' : e.key);
  }
});

/* ---------------- Verdrahtung ---------------- */
function wire() {
  $('#fab-new').onclick = () => createNote();
  $('#btn-import').onclick = () => chooseFiles(false);
  $('#file-input').onchange = e => startImport(e.target.files);
  $('#imp-ok').onclick = e => {
    e.preventDefault();
    const folder = $('#imp-folder').value.trim();
    $('#dlg-import').close();
    runImport(pendingFiles, folder);
  };
  $('#btn-drawer').onclick = () => toggleDrawer(true);
  $('#scrim').onclick = () => toggleDrawer(false);
  $('#btn-add-folder').onclick = async () => {
    toggleDrawer(false);
    const name = await askFolderName();
    if (!name) return;
    await addFolder(name);
    state.folder = name;
    renderHome(); renderFolderSelect();
  };
  $('#btn-search').onclick = () => { $('#search-bar').hidden = false; $('#search').focus(); };
  $('#btn-search-close').onclick = closeSearch;
  $('#search').oninput = e => { state.search = e.target.value; renderHome(); };
  $('#search').onkeydown = e => {
    if (e.key === 'Enter') { const n = visibleNotes()[0]; if (n) openNote(n); }
    if (e.key === 'Escape') closeSearch();
  };
  $('#connect-banner').onclick = openSettings;
  $('#btn-back').onclick = () => showHome();
  wireFormatBar();
  wireSettings();
  $('#note-title').oninput = e => { if (state.current) { state.current.title = e.target.value; scheduleSave(); } };
  $('#note-title').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); editor.typeAnywhere(''); } };
  $('#note-folder').onchange = async e => {
    let v = e.target.value;
    if (v === '__new') {
      $('#more-menu').hidden = true;
      v = await askFolderName();
      if (!v) { renderFolderSelect(); return; }
      await addFolder(v);
    }
    state.current.folder = v;
    scheduleSave(); renderFolderSelect(); renderHome();
  };
  document.querySelectorAll('.tool').forEach(b => { b.onclick = () => onToolClick(b.dataset.tool); });
  $('#btn-undo').onclick = () => editor.undo();
  $('#btn-redo').onclick = () => editor.redo();
  $('#zoom-chip').onclick = () => editor.setZoom(1);

  const menu = $('#more-menu');
  $('#btn-more').onclick = e => {
    e.stopPropagation(); closePopover();
    $('#menu-fav').textContent = state.current && state.current.fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten';
    menu.hidden = !menu.hidden;
  };
  wireInsert();
  document.addEventListener('pointerdown', e => {
    if (!menu.hidden && !e.target.closest('.menu-wrap')) menu.hidden = true;
    if (!$('#insert-menu').hidden && !e.target.closest('.menu-wrap')) $('#insert-menu').hidden = true;
    if (!$('#popover').hidden && !e.target.closest('#popover, .tool, .swatch, #formatbar')) closePopover();
  });
  $('#opt-finger').onchange = e => { setFingerDraws(e.target.checked); toast(e.target.checked ? 'Finger zeichnet – mit zwei Fingern scrollen' : 'Finger scrollt – Stift zeichnet'); };
  menu.addEventListener('click', e => {
    const act = e.target.dataset && e.target.dataset.act;
    if (!act) return;
    menu.hidden = true;
    if (act === 'note-settings') openNoteSettings();
    if (act === 'fav' && state.current) { state.current.fav = !state.current.fav; scheduleSave(); toast(state.current.fav ? 'Zu Favoriten hinzugefügt ★' : 'Aus Favoriten entfernt'); }
    if (act === 'paste') { if (!editor.paste(20)) toast('Zwischenablage ist leer – erst mit dem Lasso etwas kopieren'); }
    if (act === 'settings') openSettings();
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
    if (!await askConfirm('Endgültig löschen?', 'Die Notiz wird dauerhaft gelöscht – auch in der Nextcloud. Das kann nicht rückgängig gemacht werden.', 'Endgültig löschen', true)) return;
    await purgeNotes([state.current]);
    await openNote(null);
    showHome();
    toast('Notiz gelöscht');
  };
  // Auswahlmodus in der Übersicht
  $('#sel-cancel').onclick = () => setSelecting(false);
  $('#sel-all').onclick = () => { visibleNotes().forEach(n => picked.add(n.id)); updateSelectBar(); };
  $('#sel-delete').onclick = deletePicked;
  $('#sel-fav').onclick = async () => {
    const notes = pickedNotes(), on = !notes.every(n => n.fav);
    for (const n of notes) { n.fav = on; n.updatedAt = Date.now(); n.dirty = true; await db.putNote(n); }
    toast(on ? 'Zu Favoriten hinzugefügt ★' : 'Aus Favoriten entfernt');
    setSelecting(false); renderHome();
  };
  $('#sel-move').onclick = async () => {
    const name = await askFolderName();
    if (name == null) return;
    if (name) await addFolder(name);
    for (const n of pickedNotes()) { n.folder = name; n.updatedAt = Date.now(); n.dirty = true; await db.putNote(n); }
    toast(name ? `Nach „${name}“ verschoben` : 'Aus dem Ordner genommen');
    setSelecting(false); renderHome();
  };
  $('#sel-restore').onclick = async () => {
    for (const n of pickedNotes()) { n.deleted = false; n.updatedAt = Date.now(); n.dirty = true; await db.putNote(n); }
    toast('Wiederhergestellt');
    setSelecting(false); renderHome();
  };
  $('#btn-empty-trash').onclick = async () => {
    const notes = state.notes.filter(n => n.deleted && !n.purged);
    if (!notes.length) return;
    if (!await askConfirm('Papierkorb leeren?', `${notes.length} Notiz(en) werden dauerhaft gelöscht – auch in der Nextcloud.`, 'Leeren', true)) return;
    await purgeNotes(notes);
    renderHome();
    toast('Papierkorb geleert');
  };

  // Nextcloud
  $('#btn-settings').onclick = openSettings;
  $('#sync-status').onclick = () => (sync.configured ? syncNow() : openSettings());
  $('#btn-nc-login').onclick = startLogin;
  $('#set-nc-url').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); startLogin(); } };
  $('#btn-sync-now').onclick = () => { $('#dlg-settings').close(); syncNow(); };
  $('#btn-disconnect').onclick = async () => {
    if (!await askConfirm('Von Nextcloud abmelden?', 'Deine Notizen bleiben auf diesem Gerät und in der Nextcloud erhalten.', 'Abmelden')) return;
    const cfg = sync.config;
    await sync.saveConfig({ mode: 'nextcloud', schedule: cfg.schedule, dailyAt: cfg.dailyAt, wifiOnly: cfg.wifiOnly, ncUrl: cfg.ncUrl, ncFolder: cfg.ncFolder, ncUser: '', ncPass: '' });
    setupAutoSync();
    sync.onStatus('off', 'Sync: nicht eingerichtet');
    $('#dlg-settings').close();
    renderHome();
  };
  const manualCfg = () => ({ mode: 'nextcloud', ncUrl: normalizeNcUrl($('#set-nc-url').value), ncUser: $('#set-nc-user').value.trim(), ncPass: $('#set-nc-pass').value.trim(), ncFolder: $('#set-nc-folder').value.trim() || 'FederNotes' });
  $('#btn-test').onclick = async () => {
    const out = $('#set-result');
    out.textContent = 'Teste …';
    try { const r = await sync.test(manualCfg()); out.textContent = `✓ Verbunden – ${r.notes} Notiz(en) in deiner Nextcloud.`; }
    catch (err) { out.textContent = '✗ ' + err.message; }
  };
  $('#btn-save-manual').onclick = async () => {
    const cfg = manualCfg();
    try { await sync.test(cfg); await connect(cfg); }
    catch (err) { $('#set-result').textContent = '✗ ' + err.message; }
  };
  $('#btn-save-server').onclick = async () => {
    const cfg = { mode: 'server', url: $('#set-url').value.trim(), token: $('#set-token').value.trim(), schedule: $('#set-schedule').value, dailyAt: $('#set-daily').value, wifiOnly: $('#set-wifi').checked };
    try { await sync.test(cfg); }
    catch (err) { $('#set-result').textContent = '✗ ' + (err.message === 'Failed to fetch' ? 'Server nicht erreichbar' : err.message); return; }
    await sync.saveConfig(cfg);
    setupAutoSync();
    $('#dlg-settings').close();
    renderHome(); syncNow();
  };
  const saveSchedule = async () => {
    $('#row-daily').hidden = $('#set-schedule').value !== 'daily';
    await sync.saveConfig({ ...(sync.config || {}), schedule: $('#set-schedule').value, dailyAt: $('#set-daily').value || '16:00', wifiOnly: $('#set-wifi').checked });
    setupAutoSync();
    const hint = nextSyncText();
    if (hint) toast(hint);
  };
  $('#set-schedule').onchange = saveSchedule;
  $('#set-daily').onchange = saveSchedule;
  $('#set-wifi').onchange = saveSchedule;
  $('#btn-backup').onclick = async () => {
    const blob = await exportBackup(state.notes.filter(n => !n.purged));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `feder-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  // Drag & Drop
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

  window.addEventListener('resize', () => { if (!$('#popover').hidden) closePopover(); });
  window.addEventListener('online', () => maybeAutoSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushSave().then(() => schedule() === 'live' && maybeAutoSync()); }
    else maybeAutoSync();
  });
  window.addEventListener('beforeunload', () => { if (saveTimer && state.current) db.putNote(state.current); });
}

/* ---------------- Word-ähnliche Formatleiste ---------------- */
let formatBarBusy = false;
let savedRange = null;

function fillSelect(sel, entries, value) {
  sel.innerHTML = entries.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  sel.value = String(value);
}
const fontEntries = () => Object.keys(FONTS).map(k => [k, FONT_NAMES[k]]);
const sizeEntries = () => SIZES.map(n => [n, n + ' pt']);

function boxStyle(wrap) { return wrap._main ? editor.textStyleOf({}) : editor.textStyleOf(wrap._t); }

function showFormatBar(wrap) {
  if (!wrap) return;
  const st = boxStyle(wrap);
  fillSelect($('#fmt-font'), fontEntries(), st.font);
  fillSelect($('#fmt-size'), sizeEntries(), st.size);
  $('#formatbar').classList.toggle('box', !wrap._main);
  $('#formatbar').hidden = false;
  updateFormatState();
}

function updateFormatState() {
  if ($('#formatbar').hidden) return;
  const n = window.getSelection().anchorNode;
  const inTable = !!(n && (n.nodeType === 1 ? n : n.parentElement).closest('td, th'));
  $('#formatbar').classList.toggle('table', inTable);
  for (const b of document.querySelectorAll('#formatbar .fmt[data-cmd]')) {
    const cmd = b.dataset.cmd;
    let on = false;
    try {
      if (['bold', 'italic', 'underline', 'strikeThrough', 'justifyCenter', 'justifyRight', 'insertUnorderedList', 'insertOrderedList'].includes(cmd)) on = document.queryCommandState(cmd);
    } catch { /* nicht unterstützt */ }
    b.classList.toggle('on', on);
  }
}

/** Kastenweite Einstellung (Schrift, Größe, Abstand) für das aktive Textfeld setzen. */
function setBoxStyle(patch) {
  const wrap = editor.focusedBox || editor._lastBox;
  if (!wrap) return;
  editor.applyBoxStyle(wrap, patch);     // Haupttext: gilt für die ganze Notiz
  restoreFocus(wrap);
}

function restoreFocus(wrap) {
  const body = wrap._body;
  body.focus({ preventScroll: true });
  if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
}

function runFormat(cmd, value) {
  const wrap = editor.focusedBox || editor._lastBox;
  if (!wrap) return;
  if (document.activeElement !== wrap._body) restoreFocus(wrap);
  document.execCommand('styleWithCSS', false, true);
  if (cmd === 'mark') {
    const on = /255, 236, 128|ffec80/i.test(String(document.queryCommandValue('hiliteColor')));
    document.execCommand('hiliteColor', false, on ? 'transparent' : '#ffec80');
  } else if (cmd === 'checkbox') {
    document.execCommand('insertHTML', false, '<span class="cb" contenteditable="false"></span>\u200b');
  } else if (cmd === 'indent' || cmd === 'outdent') {
    const node = window.getSelection().anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (el && el.closest('li')) document.execCommand(cmd);
    else editor.indentBlock(wrap._body, cmd === 'indent' ? 1 : -1);
  } else if (['rowAdd', 'rowDel', 'colAdd', 'colDel'].includes(cmd)) {
    const node = window.getSelection().anchorNode;
    const cell = node && (node.nodeType === 1 ? node : node.parentElement).closest('td, th');
    if (cell) {
      const table = cell.closest('table'), idx = cell.cellIndex;
      if (cmd === 'rowAdd') tableRow(table, 1, cell.parentElement);
      if (cmd === 'rowDel') tableRow(table, -1, cell.parentElement);
      if (cmd === 'colAdd') tableCol(table, 1, idx);
      if (cmd === 'colDel') tableCol(table, -1, idx);
    }
  } else if (cmd === 'block') {
    document.execCommand('formatBlock', false, value);
  } else if (cmd === 'removeFormat') {
    document.execCommand('removeFormat');
    document.execCommand('hiliteColor', false, 'transparent');
  } else {
    document.execCommand(cmd, false, value);
  }
  wrap._t.html = wrap._body.innerHTML;
  scheduleSave();
  if (wrap._main) editor.flowOverflow(wrap._pv);
  updateFormatState();
}

function wireFormatBar() {
  const bar = $('#formatbar');
  // Knöpfe dürfen dem Textfeld den Fokus (und die Markierung) nicht wegnehmen
  bar.addEventListener('pointerdown', e => {
    formatBarBusy = true;
    setTimeout(() => { formatBarBusy = false; }, 400);
    const sel = window.getSelection();
    if (sel.rangeCount && editor.focusedBox) savedRange = sel.getRangeAt(0).cloneRange();
    if (e.target.closest('.fmt')) e.preventDefault();
  });
  bar.addEventListener('click', e => {
    const b = e.target.closest('.fmt');
    if (!b) return;
    if (b.dataset.cmd === 'foreColor') { openTextColorPicker(b); return; }
    if (b.dataset.cmd === 'para') { openParaPopover(b); return; }
    if (b.dataset.cmd === 'box') { openBoxPopover(b); return; }
    runFormat(b.dataset.cmd);
  });
  $('#fmt-font').onchange = e => setBoxStyle({ font: e.target.value });
  $('#fmt-size').onchange = e => setBoxStyle({ size: +e.target.value });
  $('#fmt-block').onchange = e => { runFormat('block', e.target.value); e.target.value = 'div'; };
  document.addEventListener('selectionchange', () => { if (editor.focusedBox) updateFormatState(); });
}

/** Absatz-Einstellungen wie in Word (bleiben immer auf den Papierlinien). */
function openParaPopover(anchor) {
  const wrap = editor.focusedBox || editor._lastBox;
  if (!wrap) return;
  const pop = $('#popover');
  popoverFor = 'para';
  const seg = (name, opts) => `<div class="opt-group"><div class="opt-label">${name}</div><div class="seg">${opts}</div></div>`;
  pop.innerHTML = `<div class="pop-title">Absatz${wrap._main ? ' <small class="muted">(ganze Notiz)</small>' : ' <small class="muted">(dieses Textfeld)</small>'}</div>
    ${seg('Zeilenabstand', [1, 2, 3].map(v => `<button data-k="spacing" data-v="${v}">${v} ${v === 1 ? 'Zeile' : 'Zeilen'}</button>`).join(''))}
    ${seg('Abstand nach Absatz', [[0, 'Keiner'], [1, '1 Zeile']].map(([v, l]) => `<button data-k="para" data-v="${v}">${l}</button>`).join(''))}
    ${seg('Einzug bei Aufzählungen', [[24, 'Klein'], [40, 'Mittel'], [64, 'Groß'], [96, 'Sehr groß']].map(([v, l]) => `<button data-k="indent" data-v="${v}">${l}</button>`).join(''))}
    <p class="pop-hint">Tab rückt eine Aufzählung eine Ebene tiefer, Umschalt+Tab wieder zurück – wie in Word.</p>`;
  const sync = () => {
    const st = boxStyle(wrap);
    pop.querySelectorAll('.seg button').forEach(b => b.classList.toggle('active', String(st[b.dataset.k] ?? '') === b.dataset.v));
  };
  pop.querySelectorAll('.seg button').forEach(b => {
    b.onpointerdown = e => e.preventDefault();
    b.onclick = () => { editor.applyBoxStyle(wrap, { [b.dataset.k]: +b.dataset.v }); sync(); };
  });
  sync();
  placePopover(anchor);
}

/** Freies Textfeld anpassen: Rahmen, Hintergrund, löschen. */
function openBoxPopover(anchor) {
  const wrap = editor.focusedBox || editor._lastBox;
  if (!wrap || wrap._main) return;
  const pop = $('#popover');
  popoverFor = 'box';
  const BG = [null, '#fff6bf', '#e7f0ff', '#e6f7ea', '#fde7ef', '#f1f1f3'];
  pop.innerHTML = `<div class="pop-title">Textfeld</div>
    <div class="opt-group"><div class="opt-label">Rahmen</div><div class="seg">
      <button data-b="0">Kein</button><button data-b="1">Dünn</button><button data-b="3">Dick</button></div></div>
    <div class="opt-group"><div class="opt-label">Hintergrund</div><div class="bg-row">${BG.map(c => `<button class="swatch${c ? '' : ' none'}" data-bg="${c || ''}" style="${c ? 'background:' + c : ''}"></button>`).join('')}</div></div>
    <p class="pop-hint">Breite: am rechten unteren Rand ziehen. Verschieben: am Griff ⠿ links ziehen.</p>
    <button class="btn wide danger" data-act="del">Textfeld löschen</button>`;
  const sync = () => {
    const b = wrap._t.box || {};
    pop.querySelectorAll('[data-b]').forEach(x => x.classList.toggle('active', +x.dataset.b === (b.border || 0)));
    pop.querySelectorAll('[data-bg]').forEach(x => x.classList.toggle('active', x.dataset.bg === (b.bg || '')));
  };
  pop.querySelectorAll('[data-b]').forEach(x => { x.onpointerdown = e => e.preventDefault(); x.onclick = () => { editor.setBoxLook(wrap, { border: +x.dataset.b }); sync(); }; });
  pop.querySelectorAll('[data-bg]').forEach(x => { x.onpointerdown = e => e.preventDefault(); x.onclick = () => { editor.setBoxLook(wrap, { bg: x.dataset.bg || null }); sync(); }; });
  pop.querySelector('[data-act=del]').onclick = () => { closePopover(); editor.deleteBox(wrap); $('#formatbar').hidden = true; };
  sync();
  placePopover(anchor);
}

function openTextColorPicker(anchor) {
  const pop = $('#popover');
  popoverFor = 'textcolor';
  pop.innerHTML = '<div class="pop-title">Textfarbe</div><div class="palette"></div><p class="pop-hint">Gilt für den markierten Text. Ohne Markierung für das, was du als Nächstes tippst.</p>';
  buildPalette(pop.querySelector('.palette'), c => {
    $('#fmt-color-bar').style.background = c;
    closePopover();
    runFormat('foreColor', c);
  });
  placePopover(anchor);
}

/* ---------------- Handschrift → Formel / Text ---------------- */
let recRun = 0;
function recDialog(kind, { edit = false } = {}) {
  $('#rec-title').textContent = edit ? 'Formel bearbeiten' : kind === 'formula' ? 'In Formel umwandeln' : 'In Text umwandeln';
  $('#rec-label').firstChild.textContent = kind === 'formula' ? 'LaTeX (zum Korrigieren)' : 'Text (zum Korrigieren)';
  $('#rec-preview').className = 'rec-preview' + (kind === 'text' ? ' text' : '');
  $('#rec-delete').hidden = !edit;
  $('#rec-add').hidden = edit;
  $('#rec-replace').textContent = edit ? 'Übernehmen' : 'Handschrift ersetzen';
  const input = $('#rec-input');
  input.oninput = () => {
    if (kind === 'formula') { const el = $('#rec-preview'); el._latex = input.value; renderLatex(el, input.value); }
    else $('#rec-preview').textContent = input.value;
  };
  return input;
}

async function startRecognize(kind) {
  const img = editor.selectionImage();
  if (!img) return;
  if (!await getApiKey()) {
    if (await askConfirm('Erkennung einrichten', 'Für „In Formel“ und „In Text“ brauchst du einen eigenen API-Schlüssel von Anthropic (console.anthropic.com). Eine Umwandlung kostet etwa 1 Cent. Jetzt in den Einstellungen eintragen?', 'Einstellungen öffnen')) {
      await openSettings();
      setTimeout(() => $('#set-apikey').scrollIntoView({ block: 'center' }), 100);
      $('#set-apikey').focus();
    }
    return;
  }
  const run = ++recRun;
  const input = recDialog(kind);
  input.value = '';
  $('#rec-preview').innerHTML = `<img alt="" src="${img.dataURL}">`;
  $('#rec-status').textContent = kind === 'formula' ? 'Erkenne Formel …' : 'Erkenne Handschrift …';
  $('#rec-replace').disabled = $('#rec-add').disabled = true;
  $('#dlg-recognize').showModal();
  let result;
  try {
    result = await recognize(kind, img.dataURL);
  } catch (err) {
    if (run === recRun) $('#rec-status').textContent = '✗ ' + err.message;
    return;
  }
  if (run !== recRun || !$('#dlg-recognize').open) return;
  $('#rec-status').textContent = kind === 'formula' ? (result.text ? 'Erkannt: ' + result.text : '') : '';
  input.value = kind === 'formula' ? result.latex : result.text;
  input.oninput();
  $('#rec-replace').disabled = $('#rec-add').disabled = false;
  const apply = replace => {
    const value = kind === 'formula' ? { latex: input.value.trim(), text: result.text } : { text: input.value };
    editor.insertRecognized(kind, value, replace);
    $('#dlg-recognize').close();
    toast(kind === 'formula' ? 'Formel eingefügt – antippen zum Bearbeiten' : 'Text eingefügt');
  };
  $('#rec-replace').onclick = () => apply(true);
  $('#rec-add').onclick = () => apply(false);
}

function openFormulaEdit(f, pv) {
  ++recRun;
  const input = recDialog('formula', { edit: true });
  input.value = f.latex;
  input.oninput();
  $('#rec-status').textContent = f.text ? 'Klartext: ' + f.text : '';
  $('#rec-replace').disabled = false;
  $('#rec-replace').onclick = () => { editor.updateFormula(f, pv, input.value.trim()); $('#dlg-recognize').close(); };
  $('#rec-delete').onclick = () => { editor.select(pv, [], [], [], [], [f]); editor.deleteSelection(); $('#dlg-recognize').close(); };
  $('#dlg-recognize').showModal();
}

/* ---------------- Lasso: Stil ändern ---------------- */
function openSelectionStyle(anchor) {
  const pop = $('#popover');
  popoverFor = 'selstyle';
  const first = editor.selection && [...editor.selection.strokes][0];
  pop.innerHTML = `<div class="pop-title">Stil ändern</div>
    <div class="size-row"><span>Stärke</span><input type="range" min="0.5" max="14" step="0.25" value="${first ? (first.tool === 'highlighter' ? first.width / 5 : first.width) : 2.5}"><span class="val"></span></div>
    <div class="palette"></div>`;
  const range = pop.querySelector('input'), val = pop.querySelector('.val');
  val.textContent = (+range.value).toFixed(1);
  range.onchange = () => { editor.styleSelection({ width: +range.value }); };
  range.oninput = () => { val.textContent = (+range.value).toFixed(1); };
  buildPalette(pop.querySelector('.palette'), c => editor.styleSelection({ color: c }), first && first.color);
  placePopover(anchor);
}

/* ---------------- Einfügen-Menü ---------------- */
function wireInsert() {
  const menu = $('#insert-menu');
  $('#btn-insert').onclick = e => { e.stopPropagation(); closePopover(); $('#more-menu').hidden = true; menu.hidden = !menu.hidden; };
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-ins]');
    if (!b || !state.current || state.current.deleted) return;
    menu.hidden = true;
    const k = b.dataset.ins;
    if (k === 'pdf') chooseFiles(true);
    if (k === 'page') editor.addPage();
    if (k === 'image') { $('#img-input').value = ''; $('#img-input').click(); }
    if (k === 'camera') { $('#cam-input').value = ''; $('#cam-input').click(); }
    if (k === 'sticky') { setTool('text'); editor.insertBox({ w: 320, box: { bg: '#fff3a3', sticky: true } }); }
    if (k === 'table') {
      setTool('text');
      const row = n => `<tr>${Array.from({ length: n }, () => '<td><br></td>').join('')}</tr>`;
      editor.insertBox({ w: 660, html: `<table><tbody>${row(3)}${row(3)}${row(3)}</tbody></table>` });
      toast('Tab = nächste Zelle, in der letzten Zelle neue Zeile');
    }
    if (k === 'audio') startRecording();
  });
  const onImage = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const sc = Math.min(1, 1800 / bmp.width);
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
      const id = await storeAsset(blob);
      editor.addImage(id, c.width, c.height);
      toast('Bild eingefügt – mit den Ecken skalieren, ziehen zum Verschieben');
    } catch (err) { toast('Bild konnte nicht geladen werden: ' + err.message, 5000); }
  };
  $('#img-input').onchange = onImage;
  $('#cam-input').onchange = onImage;
  $('#rec-stop').onclick = () => stopRecording(true);
  $('#rec-cancel').onclick = () => stopRecording(false);
}

/* ---------------- Sprachaufnahme ---------------- */
let rec = null;
async function startRecording() {
  if (rec) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    const chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec = { mr, stream, chunks, start: Date.now(), keep: true };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const r = rec; rec = null;
      $('#recbar').hidden = true;
      clearInterval(r.timer);
      if (!r.keep || !chunks.length) return;
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const id = await storeAsset(blob);
      editor.addAudio(id, (Date.now() - r.start) / 1000);
      toast('Sprachaufnahme eingefügt');
    };
    mr.start(1000);
    $('#recbar').hidden = false;
    $('#rec-time').textContent = '0:00';
    rec.timer = setInterval(() => {
      const sec = Math.round((Date.now() - rec.start) / 1000);
      $('#rec-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    }, 500);
  } catch (err) {
    toast('Mikrofon nicht verfügbar: ' + (err.message || err), 5000);
  }
}
function stopRecording(keep) {
  if (!rec) return;
  rec.keep = keep;
  rec.mr.stop();
}

let playing = null;
async function playAudio(au, el) {
  if (playing) { playing.audio.pause(); playing.el.classList.remove('playing'); const same = playing.au === au; playing = null; if (same) return; }
  const url = await getAssetURL(au.asset);
  if (!url) { toast('Aufnahme noch nicht geladen – bitte synchronisieren'); return; }
  const audio = new Audio(url);
  playing = { audio, el, au };
  el.classList.add('playing');
  audio.onended = () => { el.classList.remove('playing'); playing = null; };
  audio.play().catch(err => toast('Abspielen nicht möglich: ' + err.message));
}

/* ---------------- Notiz-Einstellungen ---------------- */
function buildPaperPick(el, value, onPick) {
  el.innerHTML = '';
  for (const [k, label] of PAPERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = value === k ? 'active' : '';
    b.innerHTML = `<div class="pv paper-${k}"></div>${label}`;
    b.onclick = () => { el.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); onPick(k); };
    el.appendChild(b);
  }
}

function buildMiniPalette(el, value, onPick) {
  el.innerHTML = '';
  for (const c of TEXT_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (value && value.toLowerCase() === c ? ' active' : '');
    b.style.background = c;
    b.onclick = () => { el.querySelectorAll('.swatch').forEach(x => x.classList.remove('active')); b.classList.add('active'); onPick(c); };
    el.appendChild(b);
  }
}

function updateSample(st) {
  const el = $('#note-sample span');
  el.style.fontFamily = FONTS[st.font];
  el.style.fontSize = st.size * 0.8 + 'px';
  el.style.color = st.color;
}

function openNoteSettings() {
  const n = state.current;
  if (!n) return;
  const st = () => ({ ...DEFAULT_TEXT, ...(n.textStyle || {}) });
  const apply = patch => {
    n.textStyle = { ...st(), ...patch };
    editor.restyleText();
    updateSample(st());
    scheduleSave();
  };
  buildPaperPick($('#note-paper'), n.paper || 'lined', p => { editor.setPaper(p); });
  const pcEl = $('#note-papercolor');
  pcEl.innerHTML = '';
  for (const [k, v] of Object.entries(PAPER_COLORS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = (n.paperColor || 'white') === k ? 'active' : '';
    b.innerHTML = `<i style="background:${v.bg}"></i>${v.label}`;
    b.onclick = () => { pcEl.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); editor.setPaperColor(k); };
    pcEl.appendChild(b);
  }
  fillSelect($('#note-font'), fontEntries(), st().font);
  fillSelect($('#note-size'), sizeEntries(), st().size);
  $('#note-spacing').value = String(st().spacing || 1);
  $('#note-para').value = String(st().para || 0);
  $('#note-indent').value = String(st().indent || 40);
  $('#note-para').onchange = e => apply({ para: +e.target.value });
  $('#note-indent').onchange = e => apply({ indent: +e.target.value });
  buildMiniPalette($('#note-color'), st().color, c => apply({ color: c }));
  $('#note-font').onchange = e => apply({ font: e.target.value });
  $('#note-size').onchange = e => apply({ size: +e.target.value });
  $('#note-spacing').onchange = e => apply({ spacing: +e.target.value });
  $('#note-reset-boxes').onclick = () => {
    for (const p of n.pages) for (const t of p.texts) delete t.style;
    editor.restyleText(); scheduleSave();
    toast('Alle Textfelder nutzen jetzt die Notiz-Einstellungen');
  };
  $('#note-as-default').onclick = async () => {
    state.defaults = { paper: n.paper || 'lined', paperColor: n.paperColor || 'white', text: st() };
    await saveGeneral();
    toast('Als Standard für neue Notizen gespeichert');
  };
  updateSample(st());
  $('#dlg-note').showModal();
}

/* ---------------- Allgemeine Einstellungen ---------------- */
async function saveGeneral() {
  await db.setMeta('general', { defaults: state.defaults, typing: state.typing, theme: state.theme, shapesOff: !!editor.shapesOff });
}

function applyTheme(theme) {
  state.theme = theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function setFingerDraws(on) {
  editor.fingerDraws = on;
  $('#opt-finger').checked = on;
  $('#def-finger').checked = on;
  savePrefs();
}

function fillGeneralSettings() {
  const d = state.defaults;
  buildPaperPick($('#def-paper'), d.paper, p => { d.paper = p; saveGeneral(); });
  fillSelect($('#def-font'), fontEntries(), d.text.font);
  fillSelect($('#def-size'), sizeEntries(), d.text.size);
  $('#def-spacing').value = String(d.text.spacing || 1);
  $('#def-para').value = String(d.text.para || 0);
  $('#def-indent').value = String(d.text.indent || 40);
  buildMiniPalette($('#def-color'), d.text.color, c => { d.text.color = c; saveGeneral(); });
  $('#def-finger').checked = editor.fingerDraws;
  $('#def-typing').checked = state.typing;
  $('#def-shapes').checked = !editor.shapesOff;
  getApiKey().then(k => { $('#set-apikey').value = k; });
  $('#def-theme').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === state.theme));
}

function wireSettings() {
  const d = () => state.defaults;
  $('#def-font').onchange = e => { d().text.font = e.target.value; saveGeneral(); };
  $('#def-size').onchange = e => { d().text.size = +e.target.value; saveGeneral(); };
  $('#def-spacing').onchange = e => { d().text.spacing = +e.target.value; saveGeneral(); };
  $('#def-para').onchange = e => { d().text.para = +e.target.value; saveGeneral(); };
  $('#def-indent').onchange = e => { d().text.indent = +e.target.value; saveGeneral(); };
  $('#def-finger').onchange = e => setFingerDraws(e.target.checked);
  $('#def-typing').onchange = e => { state.typing = e.target.checked; saveGeneral(); };
  $('#def-shapes').onchange = e => { editor.shapesOff = !e.target.checked; saveGeneral(); };
  $('#set-apikey').onchange = async e => { await setApiKey(e.target.value); toast(e.target.value.trim() ? 'API-Schlüssel gespeichert' : 'API-Schlüssel entfernt'); };
  $('#def-theme').querySelectorAll('button').forEach(b => {
    b.onclick = () => { applyTheme(b.dataset.v); saveGeneral(); fillGeneralSettings(); };
  });
}

/* ---------------- Start ---------------- */
async function init() {
  wire();
  const prefs = await db.getMeta('prefs', {});
  if (prefs.styles) for (const k of Object.keys(editor.styles)) Object.assign(editor.styles[k], prefs.styles[k] || {});
  if (prefs.eraser) Object.assign(editor.eraser, prefs.eraser);
  if (prefs.penKind) editor.penKind = prefs.penKind;
  if (prefs.zoom) editor.zoom = prefs.zoom;
  editor.fingerDraws = !!prefs.fingerDraws;
  $('#opt-finger').checked = editor.fingerDraws;
  const general = await db.getMeta('general', {});
  if (general.defaults) state.defaults = { paper: general.defaults.paper || 'lined', text: { ...DEFAULT_TEXT, ...(general.defaults.text || {}) } };
  if (general.typing === false) state.typing = false;
  if (general.defaults && general.defaults.paperColor) state.defaults.paperColor = general.defaults.paperColor;
  editor.shapesOff = !!general.shapesOff;
  applyTheme(general.theme || 'system');
  state.colorSlots = await db.getMeta('colorSlots', [...DEFAULT_SLOTS]);
  editor.tool = TOOLS.includes(prefs.tool) ? prefs.tool : 'pen';
  $('#pages').dataset.tool = editor.tool;
  renderToolbar();

  state.extraFolders = await db.getMeta('folders', []);
  state.notes = await db.allNotes();
  await repairBrokenImports();
  await sync.loadConfig();
  sync.onStatus(sync.configured ? 'ok' : 'off', sync.configured ? 'Sync bereit' : 'Sync: nicht eingerichtet');
  setupAutoSync();

  document.body.dataset.platform = platform;
  if (platform !== 'web') $('#file-input').removeAttribute('accept');   // Android kennt .sdocx nicht als Dateityp

  const lastId = await db.getMeta('lastNote');
  const crashedOn = await db.getMeta('openingNote');
  await db.setMeta('openingNote', null);
  if (crashedOn && crashedOn === lastId) {
    await db.setMeta('lastNote', null);
    document.body.classList.add('no-note');
    toast('Die zuletzt geöffnete Notiz hat die App blockiert und wurde nicht automatisch geöffnet.', 8000);
  } else {
    const last = state.notes.find(n => n.id === lastId && !n.deleted);
    if (last && wide()) await openNote(last);      // Tablet: letzte Notiz gleich daneben öffnen
    else document.body.classList.add('no-note');
  }
  showHome();
  maybeAutoSync();

  if (platform === 'web' && 'serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker:', err));
  }
}

/** Repariert Notizen, die eine ältere Version beim .sdocx-Import mit Datenmüll gefüllt hat. */
async function repairBrokenImports() {
  for (const n of state.notes) {
    const first = n.pages.findIndex(p => p.texts.some(t => (t.html || '').includes('Aus Samsung Notes übernommener Text:')));
    if (first < 0) continue;
    const size = n.pages.reduce((a, p) => a + p.texts.reduce((b, t) => b + (t.html || '').length, 0), 0);
    if (size < 150_000) continue;
    n.pages = n.pages.filter((p, i) => i < first || p.bg || p.strokes.length);
    const hint = newPage();
    hint.texts.push({ id: uid(), x: 100, y: 82, w: 820, html: '<div><b>Diese Notiz wurde repariert.</b></div><div>Beim Import ist versehentlich unlesbarer Datenmüll entstanden. Bitte die .sdocx-Datei erneut importieren – oder besser als PDF aus Samsung Notes exportieren.</div>' });
    n.pages.push(hint);
    n.updatedAt = Date.now(); n.dirty = true; n.thumb = null;
    await db.putNote(n);
    setTimeout(() => toast(`„${n.title}“ wurde repariert – bitte erneut importieren.`, 8000), 500);
  }
}

init();
