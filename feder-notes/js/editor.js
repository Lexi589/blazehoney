// Seiten-Editor: Handschrift (Druckstufen, Marker, Radierer, Lasso) + frei platzierbare Textfelder.
import { uid } from './db.js';
import { sanitizeHTML } from './sanitize.js';

export const PAGE_W = 1000;            // logische Seitenbreite
export const A4_H = Math.round(PAGE_W * 297 / 210);
const LINE = 40;                        // Linienabstand = Textzeilenhöhe
const MAX_CANVAS_PX = 12e6;             // Speicherschutz für sehr große Zoomstufen

// Schriften für Textfelder (alle auf Android/Windows vorhanden, funktionieren offline)
export const FONTS = {
  sans: '"Roboto", "SamsungOne", system-ui, "Segoe UI", sans-serif',
  serif: '"Noto Serif", "Droid Serif", Georgia, "Times New Roman", serif',
  mono: '"Roboto Mono", "Droid Sans Mono", Consolas, "Courier New", monospace',
  hand: '"Dancing Script", "Segoe Script", "Comic Sans MS", cursive',
};
export const DEFAULT_TEXT = { font: 'sans', size: 24, color: '#1d1d1f', spacing: 1, para: 0, indent: 40 };
// Haupttext (Tastatur-Modus): beginnt wie in Word am linken Rand und auf der ersten Schreiblinie
const MAIN_X = 96, MAIN_TOP = 80, MAIN_BOTTOM = 40, MAIN_RIGHT = 40;
const TAB = 60;   // Tabstopp-Abstand (≈ 1,25 cm wie in Word)

export function newPage() {
  return { id: uid(), h: A4_H, bg: null, strokes: [], texts: [] };
}

export class Editor {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts;                 // { onChange, getAssetURL, onToolChange }
    this.note = null;
    this.pages = [];                  // [{ data, el, ink, live, bgSheet, textSheet, k }]
    this.tool = 'pen';
    this.penKind = 'fountain';       // fountain | ball | pencil | calli
    // Jeder Stift merkt sich eigene Farbe und Stärke (wie bei Samsung Notes)
    this.styles = {
      fountain: { color: '#1d1d1f', width: 2.5 },
      ball: { color: '#1c56c9', width: 2.2 },
      pencil: { color: '#444444', width: 2.6 },
      calli: { color: '#1d1d1f', width: 5 },
      highlighter: { color: '#ffd43b', width: 22 },
    };
    this.eraser = { width: 18, mode: 'stroke' };   // stroke = ganzer Strich, area = nur berührte Stelle
    this.zoom = 1;
    this.fingerDraws = false;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;            // { pv, strokes:Set, box }
    this.lastPointer = null;          // { pv, x, y } für "einfach lostippen"
    this.penActiveUntil = 0;          // Handballen-Erkennung
    this.touches = new Map();
    this.gesture = null;
    this.readOnly = false;

    container.addEventListener('pointerdown', e => this.onDown(e));
    container.addEventListener('pointermove', e => this.onMove(e));
    container.addEventListener('pointerup', e => this.onUp(e));
    container.addEventListener('pointercancel', e => this.onUp(e, true));
    container.addEventListener('contextmenu', e => { if (e.target.closest('.page')) e.preventDefault(); });
    container.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = container.getBoundingClientRect();
      const z = (this.preview ? this.preview.z : this.zoom) * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
      this.previewZoom(z, { x: e.clientX - r.left, y: e.clientY - r.top });
      clearTimeout(this._wheelT);
      this._wheelT = setTimeout(() => this.commitPreview(), 220);
    }, { passive: false });
    // Finger scrollen nativ (flüssig, mit Schwung). Stift, Handballen und Finger-Zeichnen blockieren das.
    container.addEventListener('touchstart', e => this.onTouchStart(e), { passive: false });
    container.addEventListener('touchmove', e => this.onTouchMove(e), { passive: false });
    container.addEventListener('touchend', e => this.onTouchEnd(e));
    container.addEventListener('touchcancel', e => this.onTouchEnd(e));
    new ResizeObserver(() => this.relayout()).observe(container);
  }

  get styleKey() { return this.tool === 'highlighter' ? 'highlighter' : this.penKind; }
  get style() { return this.styles[this.styleKey]; }

  /* ---------------- Laden & Layout ---------------- */

  load(note, { readOnly = false } = {}) {
    this.note = note;
    this.readOnly = readOnly;
    this.undoStack = []; this.redoStack = [];
    this.selection = null; this.lastPointer = null;
    this.container.innerHTML = '';
    this.inner = document.createElement('div');
    this.inner.className = 'pages-inner';
    this.container.appendChild(this.inner);
    this.pages = [];
    this.addBtn = null;
    this.preview = null;
    if (this.io) this.io.disconnect();
    // Nur Seiten in der Nähe des Bildschirms bekommen Zeichenflächen (spart viel Speicher → flüssiger)
    this.io = new IntersectionObserver(en => this.onVisibility(en), { root: this.container, rootMargin: '1200px 0px' });
    if (!note) return;
    if (!note.pages.length) note.pages.push(newPage());
    note.pages.forEach(p => this.buildPage(p));
    this.addPageButton();
    this.relayout();
    this.container.scrollTop = 0;
    this.emitHistory();
  }

  addPageButton() {
    const b = document.createElement('button');
    b.className = 'add-page'; b.textContent = '+ Neue Seite';
    b.addEventListener('click', () => this.addPage());
    this.inner.appendChild(b);
    this.addBtn = b;
  }

  buildPage(data, index = this.pages.length) {
    const el = document.createElement('div');
    el.className = 'page';
    const bgSheet = document.createElement('div');
    bgSheet.className = 'sheet bg';
    const ink = document.createElement('canvas');
    const live = document.createElement('canvas');
    const textSheet = document.createElement('div');
    textSheet.className = 'sheet text';
    const num = document.createElement('div');
    num.className = 'page-num';
    el.append(bgSheet, ink, live, textSheet, num);

    const pv = { data, el, bgSheet, ink, live, textSheet, num, k: 1, s: 1, visible: false, drawnK: 0, liveOn: false };
    el._pv = pv;
    this.applyBackground(pv);
    this.buildMain(pv);
    data.texts.forEach(t => this.buildTextBox(pv, t));

    const before = this.pages[index] ? this.pages[index].el : this.addBtn || null;
    this.inner.insertBefore(el, before);
    this.io.observe(el);
    this.pages.splice(index, 0, pv);
    this.pages.forEach((p, i) => { p.num.textContent = `${i + 1} / ${this.pages.length}`; });
    return pv;
  }

  applyBackground(pv) {
    const sheet = pv.bgSheet;
    sheet.innerHTML = '';
    sheet.className = 'sheet bg';
    if (pv.data.bg && pv.data.bg.asset) {
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      this.opts.getAssetURL(pv.data.bg.asset).then(url => { if (url) img.src = url; });
      sheet.appendChild(img);
    } else {
      sheet.classList.add('paper-' + (this.note.paper || 'lined'));
    }
  }

  relayout() {
    if (!this.note) return;
    const avail = Math.max(200, this.container.clientWidth - 24);
    const baseW = Math.min(avail, 900);
    const dispW = Math.round(baseW * this.zoom);
    const s = dispW / PAGE_W;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const pv of this.pages) {
      const h = pv.data.h;
      let k = s * dpr;
      if (PAGE_W * k * h * k > MAX_CANVAS_PX) k = Math.sqrt(MAX_CANVAS_PX / (PAGE_W * h));
      pv.s = s; pv.k = k;
      const cw = dispW + 'px', ch = Math.round(h * s) + 'px';
      pv.el.style.width = cw;
      pv.el.style.height = ch;
      for (const sh of [pv.bgSheet, pv.textSheet]) {
        sh.style.height = h + 'px';
        sh.style.transform = `scale(${s})`;
      }
      for (const c of [pv.ink, pv.live]) { c.style.width = cw; c.style.height = ch; }
      pv.drawnK = 0;
      if (pv.visible) this.redraw(pv); else this.release(pv);
    }
  }

  sizeCanvas(c, pv) {
    const w = Math.round(PAGE_W * pv.k), h = Math.round(pv.data.h * pv.k);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  release(pv) {
    for (const c of [pv.ink, pv.live]) if (c.width) { c.width = 0; c.height = 0; }
    pv.drawnK = 0; pv.liveOn = false;
  }

  onVisibility(entries) {
    for (const en of entries) {
      const pv = en.target._pv;
      if (!pv || !this.pages.includes(pv)) continue;
      pv.visible = en.isIntersecting;
      if (pv.visible) { if (pv.drawnK !== pv.k) this.redraw(pv); }
      else if (!(this.active && this.active.pv === pv) && !(this.selection && this.selection.pv === pv)) this.release(pv);
    }
  }

  /** Endgültiger Zoom (zeichnet neu). anchor = Punkt im sichtbaren Bereich, der stehen bleibt. */
  setZoom(z, anchor) {
    z = Math.min(4, Math.max(0.4, z));
    if (this.preview) { this.preview = null; this.inner.style.transform = ''; this.inner.style.willChange = ''; }
    if (Math.abs(z - this.zoom) < 0.001) return;
    const c = this.container;
    const ax = anchor ? anchor.x : c.clientWidth / 2;
    const ay = anchor ? anchor.y : c.clientHeight / 2;
    const f = z / this.zoom;
    const px = c.scrollLeft + ax, py = c.scrollTop + ay;
    this.zoom = z;
    this.relayout();
    c.scrollLeft = px * f - ax;
    c.scrollTop = py * f - ay;
    this.opts.onZoom && this.opts.onZoom(z);
  }

  /** Zoom-Vorschau während der Geste: nur skalieren (GPU), nichts neu zeichnen → flüssig. */
  previewZoom(z, anchor) {
    if (!this.inner) return;
    z = Math.min(4, Math.max(0.4, z));
    if (!this.preview) {
      const c = this.container;
      const a = anchor || { x: c.clientWidth / 2, y: c.clientHeight / 2 };
      const ir = this.inner.getBoundingClientRect(), cr = c.getBoundingClientRect();
      this.preview = { anchor: a, z };
      this.inner.style.transformOrigin = `${cr.left + a.x - ir.left}px ${cr.top + a.y - ir.top}px`;
      this.inner.style.willChange = 'transform';
    }
    this.preview.z = z;
    this.inner.style.transform = `scale(${z / this.zoom})`;
    this.opts.onZoomPreview && this.opts.onZoomPreview(z);
  }

  commitPreview() {
    const p = this.preview;
    if (!p) return;
    this.setZoom(p.z, p.anchor);
    if (this.preview) { this.preview = null; this.inner.style.transform = ''; this.inner.style.willChange = ''; }
  }

  /* ---------------- Touch: natives Scrollen, eigenes Pinch-Zoom ---------------- */

  onTouchStart(e) {
    const penBusy = Date.now() < this.penActiveUntil || (this.active && this.active.type === 'pen');
    const inText = e.target.closest && e.target.closest('.tb-body');
    if (penBusy || (this.fingerDraws && !inText)) { if (e.cancelable) e.preventDefault(); return; }
    if (this.fingerDraws) return;
    if (e.touches.length >= 2) {
      if (e.cancelable) e.preventDefault();
      const [a, b] = e.touches;
      const r = this.container.getBoundingClientRect();
      const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
      this.pinch = { dist: Math.max(10, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), zoom: this.zoom, cx, cy };
      this.previewZoom(this.zoom, { x: cx - r.left, y: cy - r.top });
    }
  }

  onTouchMove(e) {
    if (Date.now() < this.penActiveUntil) { if (e.cancelable) e.preventDefault(); return; }
    const p = this.pinch;
    if (!p || e.touches.length < 2) return;
    if (e.cancelable) e.preventDefault();
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
    this.previewZoom(p.zoom * d / p.dist);
    this.container.scrollLeft -= cx - p.cx;
    this.container.scrollTop -= cy - p.cy;
    p.cx = cx; p.cy = cy;
  }

  onTouchEnd(e) {
    if (this.pinch && e.touches.length < 2) { this.pinch = null; this.commitPreview(); }
  }

  /* ---------------- Zeichnen ---------------- */

  ctx(pv, which = 'ink') {
    const c = pv[which];
    // Live-Ebene mit "desynchronized": geringere Verzögerung zwischen Stiftspitze und Strich
    const ctx = c._ctx || (c._ctx = c.getContext('2d', which === 'live' ? { desynchronized: true } : undefined));
    ctx.setTransform(pv.k, 0, 0, pv.k, 0, 0);
    return ctx;
  }

  liveCtx(pv) {
    this.sizeCanvas(pv.live, pv);
    pv.liveOn = true;
    return this.ctx(pv, 'live');
  }

  redraw(pv) {
    if (!pv.visible) { pv.drawnK = 0; return; }
    this.sizeCanvas(pv.ink, pv);
    const ctx = this.ctx(pv);
    ctx.clearRect(0, 0, PAGE_W, pv.data.h);
    for (const st of pv.data.strokes) drawStroke(ctx, st);
    pv.drawnK = pv.k;
    this.drawOverlay(pv);
  }

  drawOverlay(pv, extra) {
    const sel = this.selection && this.selection.pv === pv;
    if (!extra && !sel) {
      if (pv.liveOn) this.ctx(pv, 'live').clearRect(0, 0, PAGE_W, pv.data.h);
      return;
    }
    const ctx = this.liveCtx(pv);
    ctx.clearRect(0, 0, PAGE_W, pv.data.h);
    if (sel) {
      const b = this.selection.box;
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#f26a1b';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
      ctx.restore();
    }
    if (extra) extra(ctx);
  }

  /* ---------------- Eingabe ---------------- */

  pos(pv, e) {
    const r = pv.el.getBoundingClientRect();
    return [(e.clientX - r.left) / pv.s, (e.clientY - r.top) / pv.s];
  }

  pointFromEvent(pv, e, prevP) {
    const [x, y] = this.pos(pv, e);
    let p = e.pressure;
    if (e.pointerType === 'mouse' || !p) p = 0.5;
    if (prevP != null) p = prevP * 0.55 + p * 0.45;     // Druck glätten
    return [round1(x), round1(y), Math.round(p * 100) / 100];
  }

  effectiveTool(e) {
    if (e.pointerType === 'pen' && ((e.buttons & 32) || (e.buttons & 2) || e.button === 5 || e.button === 2)) return 'eraser';
    if (e.pointerType === 'pen' && (this.tool === 'text' || this.tool === 'keyboard')) return 'pen';  // Stift schreibt immer
    return this.tool;
  }

  onDown(e) {
    if (!this.note) return;
    const pageEl = e.target.closest('.page');
    if (e.pointerType === 'pen') this.penActiveUntil = Date.now() + 10_000;

    // Finger: scrollen / zoomen (außer "Mit dem Finger zeichnen" ist an)
    if (e.pointerType === 'touch' && Date.now() < this.penActiveUntil) return;   // Handballen ignorieren
    if (e.pointerType === 'touch' && this.fingerDraws && this.active && this.active.type === 'touch' && this.active.id !== e.pointerId) {
      // zweiter Finger: angefangenen Strich verwerfen und stattdessen scrollen/zoomen
      const a = this.active;
      this.active = null;
      if (a.kind === 'draw') this.drawOverlay(a.pv);
      else if (a.kind === 'erase' && a.removed.length) this.pushHistory({ t: 'replace', pv: a.pv, removed: a.removed, added: a.added });
      this.touches.set(a.id, { x: a.cx, y: a.cy, sx: a.cx, sy: a.cy, target: a.target, t: 0 });
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, target: e.target, t: 0 });
      capture(this.container, a.id); capture(this.container, e.pointerId);
      this.startGesture();
      return;
    }
    if (e.pointerType === 'touch' && (!this.fingerDraws || this.touches.size)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, target: e.target, t: Date.now() });
      if (this.fingerDraws) { capture(this.container, e.pointerId); this.startGesture(); }
      return;
    }
    if (!pageEl) return;
    const pv = pageEl._pv;
    if (!pv.visible) { pv.visible = true; this.redraw(pv); }
    const [x, y] = this.pos(pv, e);
    const inText = e.target.closest('.tb');

    // Tastatur-Modus: Tippen unter die letzte Zeile → an den Anfang dieser Linie (nicht ans Textende)
    if (inText && inText.classList.contains('main') && e.pointerType === 'mouse' && this.tool === 'keyboard' && !this.readOnly
        && y - MAIN_TOP > this.mainUsed(pv)) {
      e.preventDefault();
      this.placeKeyboardCaret(pv, y, e);
      return;
    }
    // Maus/Finger in einem Textfeld → normales Textverhalten
    if (inText && e.pointerType !== 'pen' && !e.target.closest('.tb-grip')) return;
    if (e.target.closest('.tb-grip')) { this.startTextDrag(e, inText); return; }
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    this.lastPointer = { pv, x, y };
    if (this.readOnly) return;
    const tool = this.effectiveTool(e);
    e.preventDefault();
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.tb')) {
      document.activeElement.blur();
    }

    if (tool === 'keyboard') {
      this.placeKeyboardCaret(pv, y, e);
      return;
    }
    if (tool === 'text') {
      this.createTextBox(pv, x, y, true);
      return;
    }

    capture(pageEl, e.pointerId);
    if (tool === 'lasso' && this.selection && this.selection.pv === pv && inBox(this.selection.box, x, y, 12)) {
      this.active = { kind: 'move', pv, id: e.pointerId, start: [x, y], last: [x, y] };
      return;
    }
    if (tool !== 'lasso') this.clearSelection();

    const meta = { type: e.pointerType, cx: e.clientX, cy: e.clientY, target: e.target };
    if (tool === 'pen' || tool === 'highlighter') {
      const sk = tool === 'highlighter' ? 'highlighter' : this.penKind;
      const stl = this.styles[sk];
      const st = { tool, color: stl.color, width: stl.width, points: [this.pointFromEvent(pv, e)] };
      if (tool === 'pen') st.kind = this.penKind;
      this.active = { kind: 'draw', pv, id: e.pointerId, stroke: st, ...meta };
      if (tool === 'pen') this.drawLiveSegment(pv, st);
      else this.drawOverlay(pv, ctx => drawStroke(ctx, st));
    } else if (tool === 'eraser') {
      this.active = { kind: 'erase', pv, id: e.pointerId, removed: [], added: [], last: [x, y], ...meta };
      this.eraseAt(pv, x, y);
    } else if (tool === 'lasso') {
      this.clearSelection();
      this.active = { kind: 'lasso', pv, id: e.pointerId, poly: [[x, y]], ...meta };
    }
  }

  onMove(e) {
    if (e.pointerType === 'pen') this.penActiveUntil = Math.max(this.penActiveUntil, Date.now() + 700);
    if (this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId);
      t.x = e.clientX; t.y = e.clientY;
      if (this.gesture) this.updateGesture();
      return;
    }
    if (this.textDrag && this.textDrag.id === e.pointerId) { this.moveTextDrag(e); return; }
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    a.cx = e.clientX; a.cy = e.clientY;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const list = events.length ? events : [e];

    if (a.kind === 'draw') {
      const pts = a.stroke.points;
      for (const ev of list) {
        const prev = pts[pts.length - 1];
        const pt = this.pointFromEvent(a.pv, ev, prev[2]);
        if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) < 0.6) continue;
        pts.push(pt);
        if (a.stroke.tool === 'pen') this.drawLiveSegment(a.pv, a.stroke);
      }
      if (a.stroke.tool === 'highlighter') this.drawOverlay(a.pv, ctx => drawStroke(ctx, a.stroke));
    } else if (a.kind === 'erase') {
      for (const ev of list) { const [x, y] = this.pos(a.pv, ev); this.eraseTo(a.pv, x, y); }
    } else if (a.kind === 'lasso') {
      for (const ev of list) a.poly.push(this.pos(a.pv, ev));
      this.drawOverlay(a.pv, ctx => {
        ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 2;
        ctx.beginPath(); a.poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.restore();
      });
    } else if (a.kind === 'move') {
      const [x, y] = this.pos(a.pv, e);
      const dx = x - a.last[0], dy = y - a.last[1];
      a.last = [x, y];
      translate(this.selection.strokes, dx, dy);
      this.selection.box.x += dx; this.selection.box.y += dy;
      this.scheduleRedraw(a.pv);
    }
  }

  onUp(e, cancelled = false) {
    if (e.pointerType === 'pen') this.penActiveUntil = Date.now() + 700;
    if (this.touches.has(e.pointerId)) { this.endTouch(e, cancelled); return; }
    if (this.textDrag && this.textDrag.id === e.pointerId) { this.endTextDrag(); return; }
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    const pv = a.pv;

    if (a.kind === 'draw') {
      const st = a.stroke;
      // einzelne Mausklicks erzeugen keine Punkte (Stift-Tippen schon, z. B. i-Punkte)
      if (st.points.length === 1 && a.type === 'mouse') { this.drawOverlay(pv); return; }
      pv.data.strokes.push(st);
      drawStroke(this.ctx(pv), st);
      this.drawOverlay(pv);
      this.pushHistory({ t: 'add', pv, strokes: [st] });
    } else if (a.kind === 'erase') {
      this.drawOverlay(pv);
      if (a.removed.length) this.pushHistory({ t: 'replace', pv, removed: a.removed, added: a.added });
    } else if (a.kind === 'lasso') {
      this.finishLasso(pv, a.poly);
    } else if (a.kind === 'move') {
      const dx = a.last[0] - a.start[0], dy = a.last[1] - a.start[1];
      if (dx || dy) this.pushHistory({ t: 'move', pv, strokes: [...this.selection.strokes], dx, dy });
      this.redraw(pv);
    }
  }

  drawLiveSegment(pv, st) {
    const ctx = this.liveCtx(pv);
    const pts = st.points;
    const n = pts.length;
    applyInk(ctx, st);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (n === 1) { dot(ctx, pts[0], widthAt(st, pts[0][2], pts[0], pts[0])); return; }
    const a = n >= 3 ? mid(pts[n - 3], pts[n - 2]) : pts[0];
    const c = pts[n - 2];
    const b = mid(pts[n - 2], pts[n - 1]);
    ctx.lineWidth = widthAt(st, c[2], a, b);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]); ctx.stroke();
  }

  scheduleRedraw(pv) {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.redraw(pv); });
  }

  /** Radiert entlang der Bewegung (auch bei schnellen Wischern keine Lücken). */
  eraseTo(pv, x, y) {
    const a = this.active;
    const [lx, ly] = a.last || [x, y];
    const step = Math.max(2, this.eraser.width / 2);
    const n = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / step));
    for (let i = 1; i <= n; i++) this.eraseAt(pv, lx + (x - lx) * i / n, ly + (y - ly) * i / n, i < n);
    a.last = [x, y];
  }

  eraseAt(pv, x, y, skipOverlay = false) {
    const r = this.eraser.width;
    const a = this.active;
    const hit = pv.data.strokes.filter(st => strokeHit(st, x, y, r));
    if (hit.length) {
      for (const st of hit) {
        const pieces = this.eraser.mode === 'area' ? splitStroke(st, x, y, r) : [];
        const i = pv.data.strokes.indexOf(st);
        pv.data.strokes.splice(i, 1, ...pieces);
        const ai = a.added.indexOf(st);
        if (ai >= 0) a.added.splice(ai, 1); else a.removed.push(st);
        a.added.push(...pieces);
      }
      this.redraw(pv);
    }
    if (skipOverlay) return;
    this.drawOverlay(pv, ctx => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,120,120,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  finishLasso(pv, poly) {
    if (poly.length < 3) { this.drawOverlay(pv); return; }
    const sel = pv.data.strokes.filter(st => {
      let inside = 0;
      for (const p of st.points) if (pointInPoly(p, poly)) inside++;
      return inside / st.points.length >= 0.5;
    });
    if (!sel.length) { this.drawOverlay(pv); return; }
    this.selection = { pv, strokes: new Set(sel), box: bbox(sel) };
    this.drawOverlay(pv);
    this.opts.onSelection && this.opts.onSelection(true);
  }

  clearSelection() {
    if (!this.selection) return;
    const pv = this.selection.pv;
    this.selection = null;
    this.drawOverlay(pv);
    this.opts.onSelection && this.opts.onSelection(false);
  }

  deleteSelection() {
    if (!this.selection) return false;
    const { pv, strokes } = this.selection;
    pv.data.strokes = pv.data.strokes.filter(s => !strokes.has(s));
    this.pushHistory({ t: 'replace', pv, removed: [...strokes], added: [] });
    this.selection = null;
    this.redraw(pv);
    return true;
  }

  recolorSelection(color) {
    if (!this.selection) return false;
    const strokes = [...this.selection.strokes];
    const from = strokes.map(s => s.color);
    strokes.forEach(s => { s.color = color; });
    this.pushHistory({ t: 'recolor', pv: this.selection.pv, strokes, from, to: color });
    this.redraw(this.selection.pv);
    return true;
  }

  /* ---------------- Finger-Gesten ---------------- */

  startGesture() {
    const pts = [...this.touches.values()];
    const c = this.container;
    if (pts.length === 1) {
      this.gesture = { kind: 'pan', x: pts[0].x, y: pts[0].y, sl: c.scrollLeft, st: c.scrollTop };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const r = c.getBoundingClientRect();
      this.gesture = {
        kind: 'pinch', dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom: this.preview ? this.preview.z : this.zoom,
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      };
      this.previewZoom(this.gesture.zoom, { x: this.gesture.cx - r.left, y: this.gesture.cy - r.top });
    }
  }

  updateGesture() {
    const g = this.gesture;
    if (!g) return;
    const pts = [...this.touches.values()];
    const c = this.container;
    if (g.kind === 'pan' && pts.length === 1) {
      c.scrollLeft = g.sl - (pts[0].x - g.x);
      c.scrollTop = g.st - (pts[0].y - g.y);
    } else if (g.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.previewZoom(g.zoom * d / g.dist);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      c.scrollLeft -= cx - g.cx; c.scrollTop -= cy - g.cy;
      g.cx = cx; g.cy = cy;
    }
  }

  endTouch(e, cancelled) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    const wasTap = !this.gesture || this.gesture.kind === 'pan';
    if (this.gesture && this.gesture.kind === 'pinch' && this.touches.size < 2) this.commitPreview();
    // Kurzes Antippen = "Klick": Textfeld fokussieren / Stelle für Tastatureingabe merken
    if (t && !cancelled && wasTap && this.touches.size === 0 && Date.now() - t.t < 350 && Math.hypot(t.x - t.sx, t.y - t.sy) < 10) {
      this.handleTap(t.target, e);
    }
    this.gesture = null;
    if (this.touches.size) this.startGesture();
  }

  handleTap(target, e) {
    const body = target.closest && target.closest('.tb-body');
    const mainWrap = body && body.closest('.tb.main');
    if (mainWrap && this.tool === 'keyboard' && !this.readOnly) {
      const pv = mainWrap._pv;
      const y = this.pos(pv, e)[1];
      if (y - MAIN_TOP > this.mainUsed(pv)) { this.placeKeyboardCaret(pv, y, e); return; }
    }
    if (body) {
      if (target.classList.contains('cb')) { this.toggleCheckbox(target); return; }
      body.focus();
      placeCaretAtPoint(e.clientX, e.clientY);
      return;
    }
    const pageEl = target.closest && target.closest('.page');
    if (!pageEl) return;
    const pv = pageEl._pv;
    const [x, y] = this.pos(pv, e);
    this.lastPointer = { pv, x, y };
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.tb')) document.activeElement.blur();
    if (this.readOnly) return;
    if (this.tool === 'text') this.createTextBox(pv, x, y, true);
    else if (this.tool === 'keyboard') this.placeKeyboardCaret(pv, y, e);
  }

  /* ---------------- Textfelder ---------------- */

  textStyleOf(t) {
    return { ...DEFAULT_TEXT, ...((this.note && this.note.textStyle) || {}), ...(t.style || {}) };
  }

  /** Schrift, Größe, Farbe, Zeilenabstand anwenden und Grundlinie exakt auf die Papierlinie legen. */
  styleBox(wrap) {
    const t = wrap._t, body = wrap._body;
    const st = wrap._main ? this.textStyleOf({}) : this.textStyleOf(t);
    const lh = LINE * (st.spacing || 1);
    body.style.fontFamily = FONTS[st.font] || FONTS.sans;
    body.style.fontSize = st.size + 'px';
    body.style.lineHeight = lh + 'px';
    body.style.minHeight = lh + 'px';
    body.style.color = st.color;
    body.style.top = baselineShift(st.font, st.size, lh) + 'px';
    body.style.setProperty('--ps', (st.para || 0) * LINE + 'px');     // Abstand nach Absatz (ganze Linien)
    body.style.setProperty('--li', (st.indent || 40) + 'px');          // Einzug bei Aufzählungen
    body.style.tabSize = TAB + 'px';
    if (wrap._main) {
      wrap.style.left = MAIN_X + 'px';
      wrap.style.top = MAIN_TOP + 'px';
      body.style.width = (PAGE_W - MAIN_X - MAIN_RIGHT) + 'px';
      return;
    }
    wrap.style.left = t.x + 'px';
    wrap.style.top = t.y + 'px';
    const w = t.w || Math.max(120, PAGE_W - t.x - 40);   // Standard: bis zum rechten Seitenrand
    body._autoW = t.w ? null : w;
    body.style.width = w + 'px';
    const box = t.box || {};
    body.style.boxShadow = box.border ? `0 0 0 ${box.border}px ${box.borderColor || '#868e96'}` : '';
    body.style.backgroundColor = box.bg || '';
  }

  /** Einstellung für ein Textfeld ändern – beim Haupttext gilt sie für die ganze Notiz. */
  applyBoxStyle(wrap, patch) {
    if (wrap._main) {
      this.note.textStyle = { ...DEFAULT_TEXT, ...(this.note.textStyle || {}), ...patch };
      this.restyleText();
    } else {
      wrap._t.style = { ...(wrap._t.style || {}), ...patch };
      this.styleBox(wrap);
    }
    this.changed();
  }

  setBoxLook(wrap, patch) {
    if (!wrap || wrap._main) return;
    wrap._t.box = { ...(wrap._t.box || {}), ...patch };
    this.styleBox(wrap);
    this.changed();
  }

  deleteBox(wrap) {
    if (!wrap || wrap._main) return;
    this.removeTextBox(wrap._pv, wrap._t, wrap);
  }

  /* ---------------- Haupttext (Tastatur-Modus, wie ein Word-Dokument) ---------------- */

  buildMain(pv) {
    if (!pv.data.main) pv.data.main = { html: '' };
    const t = pv.data.main;
    const wrap = document.createElement('div');
    wrap.className = 'tb main';
    const body = document.createElement('div');
    body.className = 'tb-body';
    body.contentEditable = this.readOnly ? 'false' : 'true';
    body.spellcheck = true;
    body.innerHTML = sanitizeHTML(t.html);
    body.querySelectorAll('.cb').forEach(cb => cb.setAttribute('contenteditable', 'false'));
    wrap.append(body);
    wrap._t = t; wrap._pv = pv; wrap._body = body; wrap._main = true;
    pv.mainWrap = wrap;
    this.styleBox(wrap);
    body.addEventListener('focus', () => { this._lastBox = wrap; this.opts.onTextFocus && this.opts.onTextFocus(wrap); });
    body.addEventListener('blur', () => { this.opts.onTextBlur && this.opts.onTextBlur(wrap); });
    body.addEventListener('input', () => { this.onTextInput(body, t); this.flowOverflow(pv); });
    body.addEventListener('keydown', e => this.onTextKey(e, body, pv, t, wrap));
    body.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    body.addEventListener('click', e => { if (e.target.classList.contains('cb')) this.toggleCheckbox(e.target); });
    pv.textSheet.prepend(wrap);
  }

  /** Unterkante von Haupttext, Handschrift und Textfeldern (logische Einheiten). */
  contentBottom(pv) {
    let maxY = 0;
    const body = pv.mainWrap._body;
    const s = pv.s || 1;
    const top = pv.el.getBoundingClientRect().top;
    // letzte nicht-leere Zeile des Haupttexts
    const blocks = [...body.childNodes];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const n = blocks[i];
      if (!(n.textContent || '').trim() && !(n.querySelector && n.querySelector('.cb'))) continue;
      const r = n.nodeType === 1 ? n.getBoundingClientRect() : (() => { const rg = document.createRange(); rg.selectNode(n); return rg.getBoundingClientRect(); })();
      maxY = Math.max(maxY, (r.bottom - top) / s);
      break;
    }
    for (const st of pv.data.strokes) for (const p of st.points) maxY = Math.max(maxY, p[1] + st.width);
    for (const wrap of pv.textSheet.querySelectorAll('.tb:not(.main)')) maxY = Math.max(maxY, wrap._t.y + wrap.offsetHeight);
    return maxY;
  }

  /**
   * Cursor an den Anfang einer Zeile im Haupttext setzen (wie Klicken-und-Eingeben in Word).
   * Liegt die Zeile unter dem bisherigen Text, werden leere Zeilen bis dorthin eingefügt.
   */
  placeKeyboardCaret(pv, y, ev) {
    if (this.readOnly) return;
    const wrap = pv.mainWrap, body = wrap._body;
    const st = this.textStyleOf({});
    const step = LINE * (st.spacing || 1) + (st.para || 0) * LINE;
    const empty = !body.textContent.trim() && !body.querySelector('.cb') && !body.querySelector('li');
    const used = empty ? 0 : this.mainUsed(pv);
    const ps = (st.para || 0) * LINE;
    const want = Math.max(0, y - MAIN_TOP);
    body.focus({ preventScroll: true });
    if (!empty && want < used) {
      if (ev && ev.clientX != null) {
        // innerhalb des vorhandenen Texts: dorthin, wo getippt wurde
        placeCaretAtPoint(ev.clientX, ev.clientY);
        this.opts.onTextFocus && this.opts.onTextFocus(wrap);
        return;
      }
      // Tastatur eingeschaltet: vorhandene leere Zeile am Ende nutzen, sonst neue Zeile anhängen
      let reuse = null;
      for (let n = body.lastElementChild; n && !(n.textContent || '').trim() && !n.querySelector('.cb, li'); n = n.previousElementSibling) {
        if (n.offsetTop + 2 >= want) reuse = n;
      }
      const target = reuse || body.appendChild(Object.assign(document.createElement('div'), { innerHTML: '<br>' }));
      const r = document.createRange();
      r.setStart(target, 0); r.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      this.syncMain(pv);
      this.flowOverflow(pv);
      target.scrollIntoView({ block: 'nearest' });
      this.opts.onTextFocus && this.opts.onTextFocus(wrap);
      return;
    }
    // Leere Zeilen bis zur angetippten Linie auffüllen (wie „Klicken und Eingeben“ in Word)
    const blanks = Math.max(0, Math.floor((want - used - (empty ? 0 : ps)) / step));
    if (empty) { body.innerHTML = ''; }
    let target = null;
    for (let i = 0; i <= blanks; i++) {
      const d = document.createElement('div');
      d.appendChild(document.createElement('br'));
      body.appendChild(d);
      target = d;
    }
    // Seitenende erreicht? → nächste Seite
    if (MAIN_TOP + body.offsetHeight > pv.data.h - MAIN_BOTTOM) {
      while (body.lastChild && body.lastChild !== target && !(body.lastChild.textContent || '').trim()) body.lastChild.remove();
      if (target && target.parentNode) target.remove();
      this.syncMain(pv);
      const next = this.pages[this.pages.indexOf(pv) + 1] || this.addPage(false);
      this.focusKeyboard(next);
      return;
    }
    const r = document.createRange();
    r.setStart(target, 0); r.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    this.syncMain(pv);
    target.scrollIntoView({ block: 'nearest' });
    this.opts.onTextFocus && this.opts.onTextFocus(wrap);
  }

  /** Unterkante der letzten (auch leeren) Zeile des Haupttexts, relativ zum Textanfang. */
  mainUsed(pv) {
    const body = pv.mainWrap._body;
    const last = body.lastChild;
    if (!last) return 0;
    let r;
    if (last.nodeType === 1) r = last.getBoundingClientRect();
    else { const rg = document.createRange(); rg.selectNode(last); r = rg.getBoundingClientRect(); }
    return (r.bottom - body.getBoundingClientRect().top) / (pv.s || 1);
  }

  /** In den Tastatur-Modus: Cursor auf den Anfang der nächsten freien Zeile der aktuellen Seite. */
  focusKeyboard(pv = this.visiblePage()) {
    if (!pv || this.readOnly) return;
    const bottom = this.contentBottom(pv);
    let y = bottom ? Math.ceil(bottom / LINE) * LINE + 1 : MAIN_TOP + 1;
    y = Math.max(y, MAIN_TOP + 1);
    if (y > pv.data.h - MAIN_BOTTOM - LINE) {
      pv = this.pages[this.pages.indexOf(pv) + 1] || this.addPage(false);
      y = MAIN_TOP + 1;
    }
    this.placeKeyboardCaret(pv, y);
  }

  syncMain(pv) {
    pv.data.main.html = pv.mainWrap._body.innerHTML;
    this.changed();
  }

  /** Läuft der Haupttext über das Seitenende, wandern die letzten Absätze auf die nächste Seite. */
  flowOverflow(pv) {
    const body = pv.mainWrap._body;
    const maxH = pv.data.h - MAIN_TOP - MAIN_BOTTOM;
    if (body.offsetHeight <= maxH || body.childNodes.length < 2) return;
    const sel = window.getSelection();
    const caretNode = sel.rangeCount ? sel.anchorNode : null;
    const caretOff = sel.rangeCount ? sel.anchorOffset : 0;
    const moved = [];
    while (body.offsetHeight > maxH && body.childNodes.length > 1) {
      const last = body.lastChild;
      last.remove();
      if (last.nodeType === 3) { const d = document.createElement('div'); d.appendChild(last); moved.unshift(d); }
      else moved.unshift(last);
    }
    if (!moved.length) return;
    const next = this.pages[this.pages.indexOf(pv) + 1] || this.addPage(false);
    const nb = next.mainWrap._body;
    const nEmpty = !nb.textContent.trim() && !nb.querySelector('.cb');
    if (nEmpty) nb.innerHTML = '';
    nb.prepend(...moved);
    this.syncMain(pv);
    this.syncMain(next);
    if (caretNode && nb.contains(caretNode)) {
      nb.focus({ preventScroll: true });
      const r = document.createRange();
      try { r.setStart(caretNode, Math.min(caretOff, caretNode.length ?? caretNode.childNodes.length)); } catch { r.selectNodeContents(nb); r.collapse(false); }
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      (caretNode.nodeType === 1 ? caretNode : caretNode.parentElement).scrollIntoView({ block: 'nearest' });
    }
    this.flowOverflow(next);
  }

  /** Einzug eines normalen Absatzes (außerhalb von Listen) ändern – wie „Einzug vergrößern“ in Word. */
  indentBlock(body, dir) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let n = sel.anchorNode;
    if (n === body) n = body.childNodes[sel.anchorOffset] || body.lastChild;
    while (n && n.parentNode !== body) n = n.parentNode;
    if (!n) return;
    if (n.nodeType === 3) { const d = document.createElement('div'); n.replaceWith(d); d.appendChild(n); n = d; }
    const cur = parseFloat(n.style.marginLeft) || 0;
    const v = Math.max(0, Math.min(TAB * 8, cur + dir * TAB));
    n.style.marginLeft = v ? v + 'px' : '';
  }

  restyleText() {
    for (const pv of this.pages) for (const wrap of pv.textSheet.querySelectorAll('.tb')) this.styleBox(wrap);
  }

  /** Textfeld, das gerade bearbeitet wird (oder zuletzt bearbeitet wurde). */
  get focusedBox() {
    const el = document.activeElement;
    const wrap = el && el.closest && el.closest('#pages .tb');
    if (wrap) this._lastBox = wrap;
    return wrap || null;
  }

  buildTextBox(pv, t) {
    t.y = Math.max(0, Math.round(t.y / LINE) * LINE);   // ältere Notizen an die Linien anpassen
    const wrap = document.createElement('div');
    wrap.className = 'tb';
    wrap.style.left = t.x + 'px';
    wrap.style.top = t.y + 'px';
    const grip = document.createElement('div');
    grip.className = 'tb-grip';
    grip.textContent = '⠿';
    grip.title = 'Verschieben';
    const body = document.createElement('div');
    body.className = 'tb-body';
    body.contentEditable = this.readOnly ? 'false' : 'true';
    body.spellcheck = true;
    body.innerHTML = sanitizeHTML(t.html);
    body.querySelectorAll('.cb').forEach(cb => cb.setAttribute('contenteditable', 'false'));
    wrap.append(grip, body);
    wrap._t = t; wrap._pv = pv; wrap._body = body;
    this.styleBox(wrap);
    body.addEventListener('focus', () => { this._lastBox = wrap; this.opts.onTextFocus && this.opts.onTextFocus(wrap); });
    body.addEventListener('blur', () => { this.opts.onTextBlur && this.opts.onTextBlur(wrap); });

    body.addEventListener('input', () => this.onTextInput(body, t));
    body.addEventListener('keydown', e => this.onTextKey(e, body, pv, t));
    body.addEventListener('paste', e => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    body.addEventListener('click', e => { if (e.target.classList.contains('cb')) this.toggleCheckbox(e.target); });
    body.addEventListener('blur', () => {
      if (!body.textContent.trim() && !body.querySelector('.cb')) this.removeTextBox(pv, t, wrap);
    });
    new MutationObserver(() => {
      const w = parseFloat(body.style.width) || null;
      if (w === body._autoW) return;          // automatische Breite, nicht vom Nutzer gezogen
      if (w !== t.w) { t.w = w; body._autoW = null; this.changed(); }
    }).observe(body, { attributes: true, attributeFilter: ['style'] });
    pv.textSheet.appendChild(wrap);
    return body;
  }

  createTextBox(pv, x, y, focus) {
    // Bestehendes Textfeld an dieser Stelle? Dann dort weiterschreiben.
    for (const wrap of pv.textSheet.querySelectorAll('.tb')) {
      const t = wrap._t, h = wrap.offsetHeight, w = wrap.offsetWidth;
      if (x >= t.x - 6 && x <= t.x + w + 6 && y >= t.y - 6 && y <= t.y + h + 6) {
        const body = wrap.querySelector('.tb-body');
        if (focus) { body.focus(); caretToEnd(body); }
        return body;
      }
    }
    const t = {
      id: uid(),
      x: Math.max(0, Math.min(PAGE_W - 160, Math.round(x))),
      y: Math.max(0, Math.min(pv.data.h - LINE, Math.floor(y / LINE) * LINE)),
      w: null, html: '',
    };
    pv.data.texts.push(t);
    const body = this.buildTextBox(pv, t);
    if (focus) body.focus();
    this.lastPointer = null;
    return body;
  }

  removeTextBox(pv, t, wrap) {
    const i = pv.data.texts.indexOf(t);
    if (i >= 0) pv.data.texts.splice(i, 1);
    wrap.remove();
    this.changed();
  }

  onTextInput(body, t) {
    // Markdown-artige Kurzbefehle am Zeilenanfang
    const sel = window.getSelection();
    if (sel.rangeCount && sel.isCollapsed) {
      const node = sel.anchorNode;
      if (node && node.nodeType === Node.TEXT_NODE) {
        const before = node.textContent.slice(0, sel.anchorOffset);
        const atLineStart = !node.previousSibling;
        const rule = atLineStart && ({ '- ': 'ul', '- ': 'ul', '* ': 'ul', '* ': 'ul', '1. ': 'ol', '1. ': 'ol', '# ': 'h2', '# ': 'h2', '[] ': 'cb', '[] ': 'cb' })[before];
        if (rule) {
          const r = document.createRange();
          r.setStart(node, 0); r.setEnd(node, sel.anchorOffset);
          sel.removeAllRanges(); sel.addRange(r);
          document.execCommand('delete');
          if (rule === 'ul') document.execCommand('insertUnorderedList');
          else if (rule === 'ol') document.execCommand('insertOrderedList');
          else if (rule === 'h2') document.execCommand('formatBlock', false, 'h2');
          else if (rule === 'cb') document.execCommand('insertHTML', false, '<span class="cb" contenteditable="false"></span>​');
        }
      }
    }
    t.html = body.innerHTML;
    this.changed();
  }

  onTextKey(e, body, pv, t, wrap) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const done = () => { e.preventDefault(); t.html = body.innerHTML; this.changed(); if (wrap && wrap._main) this.flowOverflow(pv); this.opts.onFormatChange && this.opts.onFormatChange(); };
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); body.blur(); return; }
    // Tab wie in Word: in Listen eine Ebene tiefer/höher, sonst Tabstopp bzw. Einzug
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const sel = window.getSelection();
      const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      const li = node && node.closest('li');
      if (li && body.contains(li)) document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      else if (e.shiftKey) this.indentBlock(body, -1);
      else document.execCommand('insertText', false, '\t');
      done(); e.stopPropagation(); return;
    }
    if (mod && !e.altKey) {
      const cmds = { l: 'justifyLeft', e: 'justifyCenter', r: 'justifyRight', j: 'justifyFull' };
      if (!e.shiftKey && cmds[key]) { document.execCommand('styleWithCSS', false, true); document.execCommand(cmds[key]); done(); e.stopPropagation(); return; }
      if (!e.shiftKey && ['1', '2', '3'].includes(e.key)) {   // Zeilenabstand wie Strg+1/2 in Word
        e.preventDefault(); e.stopPropagation();
        this.applyBoxStyle(wrap || body.closest('.tb'), { spacing: +e.key });
        this.opts.onFormatChange && this.opts.onFormatChange();
        return;
      }
      if (e.shiftKey && key === 'l') { document.execCommand('insertUnorderedList'); done(); e.stopPropagation(); return; }
      if (e.shiftKey && key === 'n') { document.execCommand('formatBlock', false, 'div'); done(); e.stopPropagation(); return; }
      if (e.shiftKey && (e.key === '>' || e.key === '<')) {
        e.preventDefault(); e.stopPropagation();
        const w = wrap || body.closest('.tb');
        const cur = (w._main ? this.textStyleOf({}) : this.textStyleOf(w._t)).size;
        this.applyBoxStyle(w, { size: Math.max(16, Math.min(34, cur + (e.key === '>' ? 2 : -2))) });
        this.opts.onFormatChange && this.opts.onFormatChange();
        return;
      }
    }
    if (mod && e.altKey && ['1', '2', '3'].includes(e.key)) {    // Überschriften wie Strg+Alt+1/2 in Word
      document.execCommand('formatBlock', false, ['h2', 'h3', 'div'][+e.key - 1]); done(); e.stopPropagation(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      wrapSelection('mark');
      t.html = body.innerHTML; this.changed();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const y = Math.ceil((t.y + body.offsetHeight) / LINE) * LINE + LINE;
      if (y < pv.data.h - LINE) this.createTextBox(pv, t.x, y + 1, true);
      return;
    }
    e.stopPropagation();   // globale Kurzbefehle nicht auslösen
  }

  toggleCheckbox(cb) {
    cb.classList.toggle('on');
    const body = cb.closest('.tb-body');
    const wrap = cb.closest('.tb');
    wrap._t.html = body.innerHTML;
    this.changed();
  }

  startTextDrag(e, wrap) {
    e.preventDefault();
    const pv = wrap._pv;
    const [x, y] = this.pos(pv, e);
    this.textDrag = { id: e.pointerId, wrap, pv, ox: x - wrap._t.x, oy: y - wrap._t.y };
    capture(e.target, e.pointerId);
  }

  moveTextDrag(e) {
    const d = this.textDrag;
    const [x, y] = this.pos(d.pv, e);
    const t = d.wrap._t;
    t.x = Math.round(Math.max(0, Math.min(PAGE_W - 60, x - d.ox)));
    t.y = Math.round(Math.max(0, Math.min(d.pv.data.h - LINE, y - d.oy)));
    d.wrap.style.left = t.x + 'px';
    d.wrap.style.top = t.y + 'px';
  }

  endTextDrag() {
    const t = this.textDrag.wrap._t;
    t.y = Math.round(t.y / LINE) * LINE;   // an Linien einrasten
    this.styleBox(this.textDrag.wrap);
    this.textDrag = null;
    this.changed();
  }

  /** Einfach lostippen: in den Haupttext an den Anfang der nächsten freien (oder angetippten) Zeile. */
  typeAnywhere(char) {
    if (!this.note || this.readOnly) return false;
    this.opts.onKeyboardMode && this.opts.onKeyboardMode();
    if (this.lastPointer && this.pages.includes(this.lastPointer.pv)) this.placeKeyboardCaret(this.lastPointer.pv, this.lastPointer.y);
    else this.focusKeyboard();
    this.lastPointer = null;
    if (char) document.execCommand('insertText', false, char);
    return true;
  }

  /* ---------------- Seiten ---------------- */

  visiblePage() {
    const c = this.container.getBoundingClientRect();
    const mid = c.top + c.height / 2;
    let best = this.pages[0], bestD = Infinity;
    for (const pv of this.pages) {
      const r = pv.el.getBoundingClientRect();
      const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
      if (d < bestD) { bestD = d; best = pv; }
    }
    return best;
  }

  addPage(scroll = true, data = newPage(), index = this.pages.length) {
    this.note.pages.splice(index, 0, data);
    const pv = this.buildPage(data, index);
    this.relayout();
    this.pushHistory({ t: 'addpage', pv, index });
    if (scroll) pv.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return pv;
  }

  clearPage() {
    const pv = this.visiblePage();
    if (!pv || !pv.data.strokes.length) return false;
    const removed = pv.data.strokes;
    pv.data.strokes = [];
    this.clearSelection();
    this.redraw(pv);
    this.pushHistory({ t: 'replace', pv, removed, added: [] });
    return true;
  }

  setPaper(paper) {
    this.note.paper = paper;
    this.pages.forEach(pv => this.applyBackground(pv));
    this.changed();
  }

  /* ---------------- Verlauf ---------------- */

  pushHistory(action) {
    this.undoStack.push(action);
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
  }

  undo() { this.step(this.undoStack, this.redoStack, true); }
  redo() { this.step(this.redoStack, this.undoStack, false); }

  step(from, to, isUndo) {
    const a = from.pop();
    if (!a) return;
    this.clearSelection();
    const pv = a.pv;
    const strokes = pv.data.strokes;
    const remove = list => { pv.data.strokes = strokes.filter(s => !list.includes(s)); };
    const add = list => { pv.data.strokes.push(...list); };
    switch (a.t) {
      case 'add': isUndo ? remove(a.strokes) : add(a.strokes); break;
      case 'erase': isUndo ? add(a.strokes) : remove(a.strokes); break;
      case 'replace':
        if (isUndo) { remove(a.added); add(a.removed); }
        else { pv.data.strokes = pv.data.strokes.filter(s => !a.removed.includes(s)); add(a.added); }
        break;
      case 'move': translate(a.strokes, isUndo ? -a.dx : a.dx, isUndo ? -a.dy : a.dy); break;
      case 'recolor': a.strokes.forEach((s, i) => { s.color = isUndo ? a.from[i] : a.to; }); break;
      case 'addpage':
        if (isUndo) {
          const i = this.pages.indexOf(pv);
          this.pages.splice(i, 1); this.note.pages.splice(i, 1); pv.el.remove();
        } else {
          this.note.pages.splice(a.index, 0, pv.data);
          this.inner.insertBefore(pv.el, this.pages[a.index] ? this.pages[a.index].el : this.addBtn);
          this.pages.splice(a.index, 0, pv);
        }
        this.pages.forEach((p, i) => { p.num.textContent = `${i + 1} / ${this.pages.length}`; });
        this.relayout();
        break;
    }
    to.push(a);
    if (a.t !== 'addpage') this.redraw(pv);
    this.changed();
  }

  emitHistory() {
    this.opts.onHistory && this.opts.onHistory(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  changed() {
    this.emitHistory();
    this.opts.onChange && this.opts.onChange();
  }
}

/* ---------------- Hilfsfunktionen ---------------- */

const shiftCache = new Map();
/** Verschiebung, damit die Schrift-Grundlinie 5 px über der Papierlinie liegt (gemessen, nicht geschätzt). */
function baselineShift(font, size, lh) {
  const key = font + '|' + size + '|' + lh;
  if (shiftCache.has(key)) return shiftCache.get(key);
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;font-family:${FONTS[font] || FONTS.sans};font-size:${size}px;line-height:${lh}px`;
  d.innerHTML = 'Hg<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
  document.body.appendChild(d);
  const base = d.lastChild.offsetTop;
  d.remove();
  const shift = Math.round(lh - 5 - base);
  shiftCache.set(key, shift);
  return shift;
}

function capture(el, id) { try { el.setPointerCapture(id); } catch { /* Zeiger schon weg */ } }

const round1 = v => Math.round(v * 10) / 10;
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const penWidth = (w, p) => w * (0.35 + 1.15 * p);

function dot(ctx, p, w) {
  ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.3, w / 2), 0, Math.PI * 2); ctx.fill();
}

/** Strichbreite je nach Stiftart, Druck und (Kalligrafie) Schreibrichtung. */
function widthAt(st, p, a, b) {
  const w = st.width;
  switch (st.kind) {
    case 'ball': return w * (0.85 + 0.3 * p);                       // Kugelschreiber: fast gleichmäßig
    case 'pencil': return w * (0.55 + 0.7 * p);                     // Bleistift: etwas Druck
    case 'calli': {                                                 // Kalligrafie: schräge Feder (45°)
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const dir = (a[0] === b[0] && a[1] === b[1]) ? 0.6 : Math.abs(Math.sin(ang - Math.PI / 4));
      return w * (0.18 + 1.25 * dir) * (0.6 + 0.6 * p);
    }
    default: return penWidth(w, p);                                 // Füller: stark druckabhängig
  }
}

const pencilCache = new Map();
/** Farbe setzen; der Bleistift bekommt eine körnige Textur. */
function applyInk(ctx, st) {
  if (st.kind !== 'pencil') { ctx.strokeStyle = ctx.fillStyle = st.color; return; }
  let pat = pencilCache.get(st.color);
  if (!pat) {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d');
    const img = g.createImageData(48, 48);
    const [r, gg, b] = hexToRgb(st.color);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b;
      img.data[i + 3] = Math.round(255 * (0.35 + 0.6 * rnd() * rnd() + 0.2 * rnd()));
    }
    g.putImageData(img, 0, 0);
    pat = ctx.createPattern(c, 'repeat');
    pencilCache.set(st.color, pat);
  }
  ctx.strokeStyle = ctx.fillStyle = pat;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x1d1d1f;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Teilt einen Strich: alles innerhalb des Radierkreises verschwindet, der Rest bleibt als neue Striche. */
function splitStroke(st, x, y, r) {
  const rr = r + st.width / 2;
  const pieces = [];
  let cur = [];
  for (const p of st.points) {
    if (Math.hypot(p[0] - x, p[1] - y) <= rr) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces.map(points => ({ ...st, points }));
}

export function drawStroke(ctx, st) {
  const pts = st.points;
  if (!pts || !pts.length) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = st.color;
  if (st.tool === 'highlighter') {
    ctx.globalAlpha = 0.38;
    ctx.globalCompositeOperation = 'multiply';
    ctx.lineWidth = st.width;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();
  } else if (pts.length === 1) {
    applyInk(ctx, st);
    dot(ctx, pts[0], widthAt(st, pts[0][2], pts[0], pts[0]));
  } else {
    applyInk(ctx, st);
    let prev = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const c = pts[i - 1];
      const end = i === pts.length - 1 ? pts[i] : mid(pts[i], pts[i - 1]);
      const start = i === 1 ? pts[0] : prev;
      ctx.lineWidth = widthAt(st, pts[i][2], start, end);
      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      if (i === 1) ctx.lineTo(end[0], end[1]);
      else ctx.quadraticCurveTo(c[0], c[1], end[0], end[1]);
      ctx.stroke();
      prev = end;
    }
  }
  ctx.restore();
}

function strokeHit(st, x, y, r) {
  const rr = r + (st.tool === 'highlighter' ? st.width / 2 : st.width);
  const pts = st.points;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1] || a;
    if (distToSeg(x, y, a[0], a[1], b[0], b[1]) <= rr) return true;
  }
  return false;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bbox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.points) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const inBox = (b, x, y, pad) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

function translate(strokes, dx, dy) {
  for (const s of strokes) for (const p of s.points) { p[0] = round1(p[0] + dx); p[1] = round1(p[1] + dy); }
}

function caretToEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

function placeCaretAtPoint(x, y) {
  let r = null;
  if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
  else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); }
  }
  if (r) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
}

function wrapSelection(tag) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const anc = range.commonAncestorContainer;
  const existing = (anc.nodeType === 1 ? anc : anc.parentElement).closest(tag);
  if (existing) { existing.replaceWith(...existing.childNodes); return; }
  const el = document.createElement(tag);
  el.appendChild(range.extractContents());
  range.insertNode(el);
  sel.removeAllRanges();
  const r = document.createRange(); r.selectNodeContents(el); sel.addRange(r);
}
