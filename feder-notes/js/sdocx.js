// Samsung Notes (.sdocx) lesen: Handschrift, getippter Text mit Absätzen/Listen/Farben, Tabellen und Bilder.
// Das Dateiformat ist nicht öffentlich dokumentiert. Die Struktur wurde ausschließlich an eigenen Notizen
// ermittelt (Interoperabilität) – es wird kein Samsung-Code verwendet.
import { uid } from './db.js';
import { PAGE_W, FONTS, newPage } from './editor.js';
import { escapeHTML } from './sanitize.js';

const SW = 1080;              // Breite einer Samsung-Seite – in diesem Maß liegt der Fließtext
const LH_PER_SIZE = 4.03;     // Zeilenhöhe je Schriftgrad (Samsung-Seitenmaß)
const FONT_PER_SIZE = 2.6;    // Schriftgröße in px je Schriftgrad (Samsung-Seitenmaß)
const MARGIN = { left: 48, top: 30, right: 48, bottom: 30 };
const OBJ_GAP = 12;           // Abstand über Tabellen im Text
const INDENT = 30;            // Einzug je Stufe
const TEXT_COLOR = '#252525';
const OBJ = 0xfffc;           // Platzhalter für Tabellen/Zeichenflächen im Text

/* ---------------- Bytes lesen ---------------- */

class Bin {
  constructor(u8) { this.b = u8; this.v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.n = u8.length; }
  u16(o) { return this.v.getUint16(o, true); }
  u32(o) { return this.v.getUint32(o, true); }
  f32(o) { return this.v.getFloat32(o, true); }
  f64(o) { return this.v.getFloat64(o, true); }
  ok(o, len) { return o >= 0 && o + len <= this.n; }
  find(pat, from = 0, to = this.n) {
    const b = this.b, p0 = pat[0], m = pat.length, end = Math.min(to, this.n) - m;
    outer: for (let i = Math.max(0, from); i <= end; i++) {
      if (b[i] !== p0) continue;
      for (let j = 1; j < m; j++) if (b[i + j] !== pat[j]) continue outer;
      return i;
    }
    return -1;
  }
}

const sm = v => (v & 0x8000) ? -(v & 0x7fff) : v;          // Vorzeichen-Betrag-Kodierung der Deltas
const hex2 = n => n.toString(16).padStart(2, '0');
const bgra = (b, o) => '#' + hex2(b[o + 2]) + hex2(b[o + 1]) + hex2(b[o]);   // Android-Farbe (ARGB, little endian)
const r1 = v => Math.round(v * 10) / 10;
const pause = () => new Promise(r => setTimeout(r, 0));

/* ---------------- Einstieg ---------------- */

export async function readSdocx(zip, { name, progress, storeImage }) {
  const entries = Object.values(zip.files).filter(f => !f.dir);
  const byName = new Map(entries.map(f => [f.name.replace(/^.*\//, ''), f]));
  const order = await pageOrder(zip, entries);
  if (!order.length) throw new Error(`${name}: keine Seiten gefunden`);

  // Medien: "media/<id>@<datei>"
  const media = new Map();
  for (const f of entries) {
    const m = /(?:^|\/)media\/(\d+)@(.+)$/.exec(f.name);
    if (m) media.set(+m[1], f);
  }

  // Fließtext, Formatierung, Tabellen
  let doc = null;
  const noteFile = byName.get('note.note');
  if (noteFile) {
    try { doc = parseNote(new Bin(await noteFile.async('uint8array')), order.length); }
    catch (err) { console.warn('note.note nicht lesbar', err); }
  }

  const pages = [];
  const layout = doc ? new TextLayout(doc) : null;
  for (let i = 0; i < order.length; i++) {
    progress(`${name}: Seite ${i + 1} / ${order.length}`);
    const f = byName.get(order[i] + '.page');
    const bin = new Bin(await f.async('uint8array'));
    const pg = parsePage(bin);
    const k = PAGE_W / pg.W;
    const page = { ...newPage(), h: Math.round(pg.H * k), images: [], audios: [], formulas: [] };

    for (const s of pg.strokes) page.strokes.push(toStroke(s, k));

    const blocks = [];
    for (const im of pg.images) {
      const file = media.get(im.media);
      if (!file || !/\.(jpe?g|png|webp)$/i.test(file.name)) continue;
      try {
        const asset = await storeImage(await cropImage(await file.async('blob'), im));
        page.images.push({ id: uid(), asset, x: r1(im.x0 * k), y: r1(im.y0 * k), w: r1((im.x1 - im.x0) * k), h: r1((im.y1 - im.y0) * k) });
        blocks.push([im.y0 * SW / pg.W, im.y1 * SW / pg.W]);     // Bilder schieben den Text darunter (wie in Samsung Notes)
      } catch (err) { console.warn('Bild übersprungen', err); }
    }

    if (layout) layout.page(i, pg.H * SW / pg.W, blocks, page);
    pages.push(page);
    await pause();
  }
  if (layout) layout.done();
  pages.title = doc && doc.title;
  return pages;
}

/** Reihenfolge der Seiten aus pageIdInfo.dat (sonst Dateireihenfolge). */
async function pageOrder(zip, entries) {
  const pageFiles = new Set(entries.filter(f => /\.page$/i.test(f.name)).map(f => f.name.replace(/^.*\//, '').replace(/\.page$/i, '')));
  const out = [];
  const info = entries.find(f => /pageIdInfo\.dat$/i.test(f.name));
  if (info) {
    const b = await info.async('uint8array');
    let latin = '', utf16 = '';
    for (let i = 0; i < b.length; i++) latin += String.fromCharCode(b[i]);
    for (let i = 0; i + 1 < b.length; i += 2) utf16 += String.fromCharCode(b[i] | (b[i + 1] << 8));
    for (let i = 1; i + 1 < b.length; i += 2) utf16 += String.fromCharCode(b[i] | (b[i + 1] << 8));
    for (const s of [latin, utf16]) {
      for (const m of s.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)) {
        if (pageFiles.has(m[0]) && !out.includes(m[0])) out.push(m[0]);
      }
    }
  }
  for (const id of [...pageFiles].sort()) if (!out.includes(id)) out.push(id);
  return out;
}

/* ---------------- Seiten: Striche und Bilder ---------------- */

function parsePage(bin) {
  const b = bin.b;
  const W = bin.u32(22) || SW, H = bin.u32(26) || 1527;
  const ps8 = new Uint8Array(8);
  new DataView(ps8.buffer).setUint32(0, W, true);
  new DataView(ps8.buffer).setUint32(4, H, true);
  const strokes = [], images = [];
  for (let ps = bin.find(ps8, 30); ps >= 0; ps = bin.find(ps8, ps + 1)) {
    if (b[ps + 8] === 0x02 && b[ps + 9] === 0x82) {
      const im = readImage(bin, ps);
      if (im) images.push(im);
      continue;
    }
    if (!(b[ps + 12] === 1 && b[ps + 13] === 0 && b[ps + 18] === 2 && b[ps + 19] === 0x25 && b[ps + 20] === 4 && b[ps + 21] === 4)) continue;
    const st = readStroke(bin, ps);
    if (st) strokes.push(st);
  }
  return { W, H, strokes, images };
}

function readStroke(bin, ps) {
  const L = bin.u32(ps + 8), n = bin.u16(ps + 26);
  if (n < 1 || n > 100000 || !bin.ok(ps, 8 + L)) return null;
  const d = ps + 44;
  const pCol = d + (n - 1) * 4;                       // Druck: Startwert + Deltas
  const tail = d + (n - 1) * 4 + 4 * (4 + (n - 1) * 2);
  if (!bin.ok(tail, 14) || tail > ps + 8 + L) return null;
  let x = bin.f64(ps + 28), y = bin.f64(ps + 36), p = bin.f32(pCol);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pts = [[x, y, p]];
  for (let i = 0; i < n - 1; i++) {
    x += sm(bin.u16(d + i * 4)) / 32;
    y += sm(bin.u16(d + i * 4 + 2)) / 32;
    p += sm(bin.u16(pCol + 4 + i * 2)) / 4096;
    pts.push([x, y, p]);
  }
  return { pts, color: bgra(bin.b, tail + 6), alpha: bin.b[tail + 9], size: bin.f32(tail + 10) };
}

function readImage(bin, ps) {
  if (!bin.ok(ps + 160, 32)) return null;
  const V = [bin.f64(ps + 160), bin.f64(ps + 168), bin.f64(ps + 176), bin.f64(ps + 184)];
  if (!V.every(Number.isFinite) || V[2] <= V[0] || V[3] <= V[1]) return null;
  const j = bin.find([0x3e, 0, 0, 0, 2, 0], ps, ps + 700);
  if (j < 0) return null;
  const im = { media: bin.u32(j + 6), x0: V[0], y0: V[1], x1: V[2], y1: V[3], full: null };
  // Zugeschnittene Bilder: Lage des ganzen Bildes steht weiter hinten (vier Doubles, die das sichtbare Rechteck umschließen)
  for (let o = j + 40; o < j + 220 && bin.ok(o, 32); o++) {
    const F = [bin.f64(o), bin.f64(o + 8), bin.f64(o + 16), bin.f64(o + 24)];
    if (!F.every(v => Number.isFinite(v) && Math.abs(v) < 20000)) continue;
    if (F[2] - F[0] < 10 || F[3] - F[1] < 10) continue;
    if (F[0] > V[0] + 2 || F[1] > V[1] + 2 || F[2] < V[2] - 2 || F[3] < V[3] - 2) continue;
    if (F.every((v, i) => Math.abs(v - V[i]) < 0.5)) break;
    if ((F[2] - F[0]) > 3 * (V[2] - V[0]) + 50 || (F[3] - F[1]) > 3 * (V[3] - V[1]) + 50) continue;
    im.full = F;
    break;
  }
  return im;
}

/** Schneidet ein Bild auf den sichtbaren Ausschnitt zu und verkleinert große Fotos. */
async function cropImage(blob, im) {
  const bmp = await createImageBitmap(blob);
  const F = im.full || [im.x0, im.y0, im.x1, im.y1];
  const fx = bmp.width / (F[2] - F[0]), fy = bmp.height / (F[3] - F[1]);
  const sx = Math.max(0, (im.x0 - F[0]) * fx), sy = Math.max(0, (im.y0 - F[1]) * fy);
  const sw = Math.min(bmp.width - sx, (im.x1 - im.x0) * fx), sh = Math.min(bmp.height - sy, (im.y1 - im.y0) * fy);
  const whole = !im.full && bmp.width <= 2000;
  if (whole && /^image\/(jpeg|png|webp)$/.test(blob.type)) { bmp.close && bmp.close(); return blob; }
  const sc = Math.min(1, 2000 / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * sc)); c.height = Math.max(1, Math.round(sh * sc));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
}

function toStroke(s, k) {
  const pts = [];
  let last = null;
  for (let i = 0; i < s.pts.length; i++) {
    const [x, y, p] = s.pts[i];
    const q = [r1(x * k), r1(y * k), Math.round(Math.min(1, Math.max(0.05, p)) * 100) / 100];
    // sehr dicht liegende Punkte weglassen (Speicher), Anfang und Ende immer behalten
    if (last && i < s.pts.length - 1 && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.7) continue;
    pts.push(q); last = q;
  }
  const hl = s.alpha < 200 || s.size > 20;
  return hl
    ? { tool: 'highlighter', color: s.color, width: Math.max(8, r1(s.size * k)), points: pts }
    : { tool: 'pen', kind: 'fountain', color: s.color, width: Math.max(0.8, r1(s.size * 1.35 * k)), points: pts };
}

/* ---------------- note.note: Fließtext, Formatierung, Tabellen ---------------- */

function parseNote(bin, pageCount) {
  const b = bin.b;
  // Objekte: "69 00 00 00 02 <typ> 01 04 00"
  const objs = [];
  for (let o = bin.find([0x02], 4); o >= 0 && o < bin.n - 70; o = bin.find([0x02], o + 1)) {
    if (!((b[o + 1] === 0xbf || b[o + 1] === 0x3e) && b[o + 2] === 1 && b[o + 3] === 4 && b[o + 4] === 0)) continue;
    if (bin.u32(o - 4) !== 0x69) continue;
    objs.push({ o, group: b[o + 1] === 0x3e, inline: b[o + 5] === 0xe0, rect: [bin.f64(o + 58), bin.f64(o + 66), bin.f64(o + 74), bin.f64(o + 82)] });
  }
  objs.forEach((ob, i) => { ob.end = i + 1 < objs.length ? objs[i + 1].o : bin.n; });
  for (const ob of objs) if (!ob.group) ob.box = readTextBox(bin, ob.o + 60, ob.end, pageCount);

  const boxes = objs.filter(ob => ob.box);
  const body = boxes.find(ob => ob.box.ranges) || boxes.reduce((a, ob) => (!a || ob.box.text.length > a.box.text.length ? ob : a), null);
  if (!body) return null;
  const titleBox = boxes.find(ob => ob !== body && ob.o < body.o && ob.box.text.trim() && ob.box.text.length < 120 && !ob.box.text.includes('\n'));

  // Inline-Objekte nach dem Fließtext: Tabellen (Gruppe + Zellen) und Zeichenflächen
  const inline = [];
  let cur = null;
  for (const ob of objs) {
    if (ob.o <= body.o) continue;
    if (ob.group) { cur = { kind: 'table', rect: ob.rect, cells: [] }; inline.push(cur); continue; }
    if (ob.inline) { cur = null; inline.push({ kind: 'space', rect: ob.rect }); continue; }
    if (cur && inside(ob.rect, cur.rect)) cur.cells.push({ rect: ob.rect, box: ob.box || null });
  }
  return { title: titleBox ? titleBox.box.text.trim() : '', body: body.box, inline };
}

const inside = (r, R) => r[0] >= R[0] - 3 && r[1] >= R[1] - 3 && r[2] <= R[2] + 3 && r[3] <= R[3] + 3;

const textChar = c => c === 10 || c === 9 || c === OBJ || (c >= 0x20 && (c < 0xd800 || c >= 0xe000) && c !== 0xfffe && c !== 0xffff);

/** Sucht in einem Textobjekt: Länge, UTF-16-Text, Zeichenformate, Absatzformate (und beim Fließtext die Seitenaufteilung). */
function readTextBox(bin, from, to, pageCount) {
  for (let p = from; p < Math.min(to - 8, from + 900); p++) {
    const N = bin.u32(p);
    if (N < 1 || N > 500000) continue;
    const e = p + 4 + N * 2;
    if (e + 4 > to) continue;
    let ok = true, s = '';
    for (let i = 0; i < N; i++) {
      const c = bin.u16(p + 4 + i * 2);
      if (!textChar(c)) { ok = false; break; }
      s += String.fromCharCode(c);
    }
    if (!ok) continue;
    const cnt = bin.u32(e);
    if (cnt > 100000 || (cnt && (!bin.ok(e + 4, 2) || bin.u16(e + 4) !== 24))) continue;
    // Zeichenformate
    let o = e + 4;
    const spans = [];
    for (let i = 0; i < cnt; i++) {
      const sz = bin.u16(o);
      if (!bin.ok(o, 2 + sz) || sz < 20) { ok = false; break; }
      spans.push({ type: bin.u32(o + 2), start: bin.u32(o + 6), end: bin.u32(o + 10), raw: o + 18, f: bin.f32(o + 18) });
      o += 2 + sz;
    }
    if (!ok) continue;
    // Absatzformate
    const paras = [];
    if (bin.ok(o, 4)) {
      const pc = bin.u32(o);
      if (pc < 100000) {
        let q = o + 4;
        for (let i = 0; i < pc; i++) {
          const sz = bin.u16(q);
          if (!bin.ok(q, 2 + sz) || sz < 12) break;
          paras.push({ type: bin.u32(q + 2), start: bin.u32(q + 6), end: bin.u32(q + 10), a: sz >= 16 ? bin.u32(q + 14) : 0, b: sz >= 20 ? bin.u32(q + 18) : 0 });
          q += 2 + sz;
        }
        o = q;
      }
    }
    // Plausibilität: Formate liegen im Text, je Absatz ein Absatzeintrag (Typ 6)
    if (spans.some(sp => sp.start > sp.end || sp.end > N)) continue;
    const t6 = paras.filter(q => q.type === 6).length;
    if (t6 ? t6 !== s.split('\n').length : N < 3) continue;
    const box = { text: s, spans, paras, bin };
    box.ranges = findRanges(bin, o, Math.min(to, o + 400), pageCount, N);
    return box;
  }
  return null;
}

/** Seitenaufteilung des Fließtexts: Anzahl Seiten, dann (Start, Länge) je Seite. */
function findRanges(bin, from, to, pageCount, N) {
  for (let p = from; p + 6 + pageCount * 8 <= to; p++) {
    // Anzahl als u16 (gesehen) oder u32, danach Paare (Start, Länge) – das erste beginnt bei 0
    const at = bin.u16(p) !== pageCount ? -1 : bin.u32(p + 2) === 0 ? p + 2 : bin.u16(p + 2) === 0 && bin.u32(p + 4) === 0 ? p + 4 : -1;
    if (at < 0) continue;
    const r = [];
    let ok = true;
    for (let i = 0; i < pageCount; i++) {
      const s = bin.u32(at + i * 8), l = bin.u32(at + 4 + i * 8);
      if (s > N || s + l > N || (r.length && s + 2 < r[r.length - 1][0] + r[r.length - 1][1])) { ok = false; break; }
      r.push([s, l]);
    }
    if (ok && r.length && r[r.length - 1][0] + r[r.length - 1][1] === N) return r;
  }
  return null;
}

/* ---------------- Text in HTML umwandeln ---------------- */

/** Formatierung je Zeichen und je Absatz auflösen. */
function styleBox(box) {
  const t = box.text, n = t.length, b = box.bin.b;
  const color = new Array(n).fill(null), size = new Float32Array(n), bold = new Uint8Array(n), under = new Uint8Array(n);
  for (const sp of box.spans) {
    const s = Math.max(0, sp.start), e = Math.min(n, sp.end);
    for (let i = s; i < e; i++) {
      if (sp.type === 1) color[i] = bgra(b, sp.raw);
      else if (sp.type === 3 && sp.f > 2 && sp.f < 200) size[i] = sp.f;
      else if (sp.type === 5) bold[i] = box.bin.u32(sp.raw) ? 1 : 0;
      else if (sp.type === 7) under[i] = box.bin.u32(sp.raw) ? 1 : 0;
    }
  }
  // häufigster Schriftgrad als Grundgröße
  const hist = new Map();
  for (let i = 0; i < n; i++) if (size[i]) hist.set(size[i], (hist.get(size[i]) || 0) + 1);
  let base = 12, best = 0;
  for (const [s, c] of hist) if (c > best) { best = c; base = s; }
  for (let i = 0; i < n; i++) if (!size[i]) size[i] = base;
  // Absätze
  const starts = [0];
  for (let i = 0; i < n; i++) if (t.charCodeAt(i) === 10) starts.push(i + 1);
  const pf = starts.map(() => ({ align: 0, list: 0, num: 0, indent: 0 }));
  for (const p of box.paras) {
    for (let i = Math.max(0, p.start); i < Math.min(pf.length, Math.max(p.end, p.start + 1)); i++) {
      if (p.type === 3) pf[i].align = p.a;
      else if (p.type === 5) { pf[i].list = p.a; pf[i].num = p.b; }
      else if (p.type === 2) pf[i].indent = p.a;
    }
  }
  return { t, color, size, bold, under, base, starts, pf };
}

const paraIndex = (S, i) => {
  let lo = 0, hi = S.starts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.starts[m] <= i) lo = m; else hi = m - 1; }
  return lo;
};

const fpx = (size, k) => r1(size * FONT_PER_SIZE * k);
const lpx = (size, k) => r1(size * LH_PER_SIZE * k);

/** HTML für den Text t[s..e) (ohne Zeilenumbruch), Zeichenformat je Zeichen. */
function runsHTML(S, s, e, pSize, k) {
  let out = '', cur = null, buf = '';
  const flush = () => {
    if (!buf) return;
    const css = [];
    if (cur.color && cur.color !== TEXT_COLOR) css.push(`color: ${cur.color}`);
    if (cur.bold) css.push('font-weight: 700');
    if (cur.under) css.push('text-decoration: underline');
    if (cur.size !== pSize) css.push(`font-size: ${fpx(cur.size, k)}px`);
    out += css.length ? `<span style="${css.join('; ')}">${escapeHTML(buf)}</span>` : escapeHTML(buf);
    buf = '';
  };
  for (let i = s; i < e; i++) {
    const c = S.t[i];
    if (c === '￼') continue;
    const st = { color: S.color[i], bold: S.bold[i], under: S.under[i], size: S.size[i] };
    if (!cur || st.color !== cur.color || st.bold !== cur.bold || st.under !== cur.under || st.size !== cur.size) { flush(); cur = st; }
    buf += c;
  }
  flush();
  return out;
}

/** Ein Absatzstück als Element; Listen werden später zusammengefasst. */
function paraItem(S, s, e, nl, k, cont, boxBase = S.base) {
  const pi = paraIndex(S, s);
  const f = S.pf[pi] || {};
  let pSize = 0;
  for (let i = s; i < e; i++) if (S.t[i] !== '￼') pSize = Math.max(pSize, S.size[i]);
  if (!pSize) pSize = S.size[Math.min(S.t.length - 1, nl >= 0 ? nl : Math.max(0, e - 1))] || S.base;
  const css = [];
  if (pSize !== boxBase) css.push(`font-size: ${fpx(pSize, k)}px`, `line-height: ${lpx(pSize, k)}px`);
  if (f.align === 2) css.push('text-align: center');
  else if (f.align === 1) css.push('text-align: right');
  if (f.indent) css.push(`margin-left: ${r1(Math.min(f.indent, 8) * INDENT * k)}px`);
  const inner = runsHTML(S, s, e, pSize, k) || '<br>';
  const list = cont ? '' : f.list === 4 ? 'ol' : f.list ? 'ul' : '';
  const tag = list ? 'li' : 'div';
  return { list, html: `<${tag}${css.length ? ` style="${css.join('; ')}"` : ''}>${inner}</${tag}>`, size: pSize, empty: inner === '<br>' && !list };
}

function itemsHTML(items) {
  let out = '', open = '';
  for (const it of items) {
    if (it.list !== open) { if (open) out += `</${open}>`; if (it.list) out += `<${it.list}>`; open = it.list; }
    out += it.html;
  }
  if (open) out += `</${open}>`;
  return out;
}

/* ---------------- Text auf die Seiten verteilen ---------------- */

class TextLayout {
  constructor(doc) {
    this.doc = doc;
    this.k = PAGE_W / SW;
    this.S = styleBox(doc.body);
    this.objAt = new Map();
    let n = 0;
    for (let i = 0; i < this.S.t.length; i++) if (this.S.t.charCodeAt(i) === OBJ) this.objAt.set(i, doc.inline[n++] || null);
    this.consumed = 0;
    this.carry = null;            // Tabellenzeilen, die auf der nächsten Seite weitergehen
    this.style = { font: 'sans', size: fpx(this.S.base, this.k), color: TEXT_COLOR, spacing: r1(lpx(this.S.base, this.k) / 40 * 1000) / 1000, para: 0, indent: r1(36 * this.k) };
    this.meas = document.createElement('div');
    this.meas.className = 'tb-body';
    this.meas.style.cssText = `position:absolute;left:-99999px;top:0;visibility:hidden;min-height:0;max-width:none;resize:none;` +
      `font-family:${FONTS.sans};font-size:${this.style.size}px;line-height:${this.style.spacing * 40}px;width:${r1((SW - MARGIN.left - MARGIN.right) * this.k)}px;--li:${this.style.indent}px;--ps:0px`;
    document.body.appendChild(this.meas);
    this.cellMeas = this.meas.cloneNode();
    document.body.appendChild(this.cellMeas);
  }

  done() { this.meas.remove(); this.cellMeas.remove(); }

  height(item) {
    this.meas.innerHTML = item.list ? `<${item.list}>${item.html}</${item.list}>` : item.html;
    return this.meas.offsetHeight / this.k;            // zurück ins Samsung-Maß
  }

  /** Text und Tabellen einer Seite setzen. H = Seitenhöhe (Samsung-Maß), blocks = von Bildern belegte Höhen. */
  page(idx, H, blocks, page) {
    const ranges = this.doc.body.ranges;
    const S = this.S, t = S.t, k = this.k;
    let s, e;
    if (ranges) {
      if (!ranges[idx]) return;
      [s, e] = ranges[idx]; e += s;
    } else {
      if (idx > 0) return;                       // ohne Seitenaufteilung: alles ab der ersten Seite
      s = 0; e = t.length;
    }
    s = Math.max(s, this.consumed);
    const bottom = H - MARGIN.bottom;
    const isTable = j => t.charCodeAt(j) === OBJ && (this.objAt.get(j) || {}).kind === 'table';
    let y = MARGIN.top;
    let seg = null;
    const endSeg = () => {
      if (seg && seg.items.some(it => !it.empty)) {
        page.texts.push({ id: uid(), x: r1(MARGIN.left * k - 6), y: r1(seg.y * k), w: r1((SW - MARGIN.left - MARGIN.right) * k + 12), html: itemsHTML(seg.items), style: { ...this.style }, free: true });
      }
      seg = null;
    };
    const clearOf = (top, h) => {
      for (const [b0, b1] of blocks) if (top < b1 && top + h > b0) return clearOf(b1, h);
      return top;
    };
    const line = (i, j, nl, cont) => {
      const it = paraItem(S, i, j, nl, k, cont);
      const h = this.height(it);
      const top = clearOf(y, h);
      if (!seg || top !== y) { endSeg(); y = top; seg = { y, items: [] }; }
      seg.items.push(it);
      y += h;
    };

    // Fortsetzung einer Tabelle von der Vorseite
    if (this.carry) {
      const c = this.carry; this.carry = null;
      this.placeTable(page, c.table, c.rows, MARGIN.top);
      y = MARGIN.top + c.height;
    }

    let i = s;
    while (i < e) {
      let j = i;
      while (j < e && t.charCodeAt(j) !== 10 && !isTable(j)) j++;
      const afterTable = i > 0 && isTable(i - 1);
      const cont = afterTable || (i === s && i > 0 && t.charCodeAt(i - 1) !== 10);   // kein neuer Absatz → kein Aufzählungszeichen
      if (j < e && t.charCodeAt(j) === 10) {
        // Zeilenumbruch direkt nach einer Tabelle beendet nur deren Absatz
        if (!(afterTable && j === i)) line(i, j, j, cont);
        i = j + 1;
        continue;
      }
      if (j < e) {                               // Tabelle
        if (j > i) line(i, j, -1, cont);
        endSeg();
        y = this.placeObject(page, this.objAt.get(j), y, H, bottom);
        i = j + 1;
        continue;
      }
      if (j > i) line(i, j, -1, cont);           // Absatz geht auf der nächsten Seite weiter
      break;
    }
    endSeg();
    this.consumed = e;
  }

  placeObject(page, ob, y, H, bottom) {
    const R = ob.rect, h = R[3] - R[1];
    if (!(h > 0)) return y;
    let top = y + OBJ_GAP;
    if (Math.abs(R[1] - top) < 60) top = R[1];         // gespeicherte Lage nutzen, wenn sie passt
    const rows = [...new Set(ob.cells.map(c => Math.round(c.rect[1])))].sort((a, b) => a - b);
    if (!rows.length) return top + h;
    const off = top - R[1];
    const here = [], next = [];
    for (const r of rows) {
      const cells = ob.cells.filter(c => Math.round(c.rect[1]) === r);
      const rh = Math.max(...cells.map(c => c.rect[3] - c.rect[1]));
      const row = { y: r, h: rh, cells };
      if (!next.length && (r + off + rh <= bottom + 4 || !here.length)) here.push(row); else next.push(row);
    }
    const used = this.placeTable(page, ob, here, top);
    if (next.length) {
      this.carry = { table: ob, rows: next, height: next.reduce((a, r) => a + r.h, 0) };
      return H;                                          // Rest der Tabelle auf der nächsten Seite
    }
    return top + used;
  }

  /** Tabelle als Textfeld mit HTML-Tabelle; gibt die Höhe (Samsung-Maß) zurück. */
  placeTable(page, ob, rows, top) {
    const k = this.k;
    const cols = [...new Set(ob.cells.map(c => Math.round(c.rect[0])))].sort((a, b) => a - b);
    let html = '<table><tbody>';
    let total = 0;
    for (const r of rows) {
      html += '<tr>';
      for (const cx of cols) {
        const c = r.cells.find(x => Math.round(x.rect[0]) === cx);
        if (!c) continue;
        const w = r1((c.rect[2] - c.rect[0]) * k), h = r1((c.rect[3] - c.rect[1]) * k);
        html += `<td style="width: ${w}px; height: ${h}px; vertical-align: top; padding: ${r1(12 * k)}px ${r1(10 * k)}px">${cellHTML(c.box, k, this.S.base)}</td>`;
      }
      html += '</tr>';
      total += r.h;
    }
    html += '</tbody></table>';
    const x0 = ob.rect[0];
    page.texts.push({ id: uid(), x: r1(x0 * k - 6), y: r1(top * k), w: r1((ob.rect[2] - ob.rect[0]) * k + 14), html, style: { ...this.style }, free: true });
    return total;
  }
}

/** Inhalt einer Tabellenzelle (eigenes Textobjekt mit Formatierung). */
function cellHTML(box, k, boxBase) {
  if (!box || !box.text) return '<br>';
  const S = styleBox(box);
  const items = [];
  let i = 0;
  const t = S.t;
  while (i <= t.length) {
    let j = i;
    while (j < t.length && t.charCodeAt(j) !== 10) j++;
    if (j > i || j < t.length) items.push(paraItem(S, i, j, j < t.length ? j : -1, k, false, boxBase));
    i = j + 1;
  }
  // überflüssige Leerzeilen am Ende weglassen
  while (items.length > 1 && items[items.length - 1].html.includes('><br></')) items.pop();
  return itemsHTML(items);
}
