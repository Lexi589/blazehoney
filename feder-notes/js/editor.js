// Seiten-Editor: Handschrift (Druckstufen, Marker, Radierer, Lasso) + frei platzierbare Textfelder.
import { uid } from './db.js';
import { sanitizeHTML } from './sanitize.js';

export const PAGE_W = 1000;            // logische Seitenbreite
export const A4_H = Math.round(PAGE_W * 297 / 210);
const LINE = 40;                        // Linienabstand = Textzeilenhöhe
const MAX_CANVAS_PX = 16e6;             // Speicherschutz für sehr große Zoomstufen

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
      if (e.ctrlKey) { e.preventDefault(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); }
    }, { passive: false });
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
    this.pages = [];
    this.addBtn = null;
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
    this.container.appendChild(b);
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

    const pv = { data, el, bgSheet, ink, live, textSheet, num, k: 1, s: 1 };
    el._pv = pv;
    this.applyBackground(pv);
    data.texts.forEach(t => this.buildTextBox(pv, t));

    const before = this.pages[index] ? this.pages[index].el : this.addBtn || null;
    this.container.insertBefore(el, before);
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
      this.opts.getAssetURL(pv.data.bg.asset).then(url => { if (url) img.src = url; });
      sheet.appendChild(img);
    } else {
      sheet.classList.add('paper-' + (this.note.paper || 'lined'));
    }
  }

  relayout() {
    if (!this.note) return;
    const avail = Math.max(200, this.container.clientWidth - 32);
    const baseW = Math.min(avail, 900);
    const dispW = Math.round(baseW * this.zoom);
    const s = dispW / PAGE_W;
    const dpr = window.devicePixelRatio || 1;
    for (const pv of this.pages) {
      const h = pv.data.h;
      let k = s * dpr;
      if (PAGE_W * k * h * k > MAX_CANVAS_PX) k = Math.sqrt(MAX_CANVAS_PX / (PAGE_W * h));
      pv.s = s; pv.k = k;
      pv.el.style.width = dispW + 'px';
      pv.el.style.height = Math.round(h * s) + 'px';
      for (const sh of [pv.bgSheet, pv.textSheet]) {
        sh.style.height = h + 'px';
        sh.style.transform = `scale(${s})`;
      }
      for (const c of [pv.ink, pv.live]) {
        c.width = Math.round(PAGE_W * k);
        c.height = Math.round(h * k);
        c.style.width = dispW + 'px';
        c.style.height = Math.round(h * s) + 'px';
      }
      this.redraw(pv);
    }
  }

  setZoom(z, anchor) {
    z = Math.min(4, Math.max(0.4, z));
    if (Math.abs(z - this.zoom) < 0.001) return;
    const c = this.container;
    const ax = anchor ? anchor.x : c.clientWidth / 2;
    const ay = anchor ? anchor.y : c.clientHeight / 2;
    const rx = (c.scrollLeft + ax) / Math.max(1, c.scrollWidth);
    const ry = (c.scrollTop + ay) / Math.max(1, c.scrollHeight);
    this.zoom = z;
    this.relayout();
    c.scrollLeft = rx * c.scrollWidth - ax;
    c.scrollTop = ry * c.scrollHeight - ay;
    this.opts.onZoom && this.opts.onZoom(z);
  }

  /* ---------------- Zeichnen ---------------- */

  ctx(pv, which = 'ink') {
    const ctx = pv[which].getContext('2d');
    ctx.setTransform(pv.k, 0, 0, pv.k, 0, 0);
    return ctx;
  }

  redraw(pv) {
    const ctx = this.ctx(pv);
    ctx.clearRect(0, 0, PAGE_W, pv.data.h);
    for (const st of pv.data.strokes) drawStroke(ctx, st);
    this.drawOverlay(pv);
  }

  drawOverlay(pv, extra) {
    const ctx = this.ctx(pv, 'live');
    ctx.clearRect(0, 0, PAGE_W, pv.data.h);
    if (this.selection && this.selection.pv === pv) {
      const b = this.selection.box;
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#e8590c';
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
    if (e.pointerType === 'pen' && this.tool === 'text') return 'pen';  // Stift schreibt immer
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
      capture(this.container, e.pointerId);
      this.startGesture();
      return;
    }
    if (!pageEl) return;
    const pv = pageEl._pv;
    const [x, y] = this.pos(pv, e);
    const inText = e.target.closest('.tb');

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
      this.updateGesture();
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
    const ctx = this.ctx(pv, 'live');
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
        kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom,
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, anchor: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top },
      };
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
      const target = g.zoom * d / g.dist;
      if (!this._pinchRaf) {
        this._pinchRaf = requestAnimationFrame(() => {
          this._pinchRaf = null;
          this.setZoom(target, g.anchor);
          const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
          c.scrollLeft -= cx - g.cx; c.scrollTop -= cy - g.cy;
          g.cx = cx; g.cy = cy;
        });
      }
    }
  }

  endTouch(e, cancelled) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    const wasPan = this.gesture && this.gesture.kind === 'pan';
    // Kurzes Antippen = "Klick": Textfeld fokussieren / Stelle für Tastatureingabe merken
    if (!cancelled && wasPan && this.touches.size === 0 && Date.now() - t.t < 350 && Math.hypot(t.x - t.sx, t.y - t.sy) < 10) {
      this.handleTap(t.target, e);
    }
    this.gesture = null;
    if (this.touches.size) this.startGesture();
  }

  handleTap(target, e) {
    const body = target.closest && target.closest('.tb-body');
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
    if (this.tool === 'text' && !this.readOnly) this.createTextBox(pv, x, y, true);
  }

  /* ---------------- Textfelder ---------------- */

  buildTextBox(pv, t) {
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
    if (t.w) body.style.width = t.w + 'px';
    body.innerHTML = sanitizeHTML(t.html);
    body.querySelectorAll('.cb').forEach(cb => cb.setAttribute('contenteditable', 'false'));
    wrap.append(grip, body);
    wrap._t = t; wrap._pv = pv;

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
      if (w !== t.w) { t.w = w; this.changed(); }
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
      x: Math.max(0, Math.min(PAGE_W - 120, Math.round(x))),
      y: Math.max(0, Math.min(pv.data.h - LINE, Math.floor(y / LINE) * LINE + 2)),
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

  onTextKey(e, body, pv, t) {
    if (e.key === 'Escape') { e.preventDefault(); body.blur(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      wrapSelection('mark');
      t.html = body.innerHTML; this.changed();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const y = t.y + body.offsetHeight + LINE;
      if (y < pv.data.h - LINE) this.createTextBox(pv, t.x, y, true);
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
    t.y = Math.round(t.y / LINE) * LINE + 2;   // an Linien einrasten
    this.textDrag.wrap.style.top = t.y + 'px';
    this.textDrag = null;
    this.changed();
  }

  /** Tastatur: Wo soll ein neues Textfeld entstehen, wenn man einfach lostippt? */
  typeAnywhere(char) {
    if (!this.note || this.readOnly) return false;
    let pv, x, y;
    if (this.lastPointer && this.pages.includes(this.lastPointer.pv)) {
      ({ pv, x, y } = this.lastPointer);
    } else {
      pv = this.visiblePage();
      let maxY = 0;
      for (const st of pv.data.strokes) for (const p of st.points) maxY = Math.max(maxY, p[1]);
      for (const wrap of pv.textSheet.querySelectorAll('.tb')) maxY = Math.max(maxY, wrap._t.y + wrap.offsetHeight);
      x = 100; y = maxY ? maxY + LINE * 0.6 : LINE * 3;
      if (y > pv.data.h - LINE * 2) {
        const idx = this.pages.indexOf(pv);
        pv = this.pages[idx + 1] || this.addPage(false);
        y = LINE * 3;
      }
    }
    const body = this.createTextBox(pv, x, y, true);
    caretToEnd(body);
    if (char) document.execCommand('insertText', false, char);
    body.scrollIntoView({ block: 'nearest' });
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
          this.container.insertBefore(pv.el, this.pages[a.index] ? this.pages[a.index].el : this.addBtn);
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
