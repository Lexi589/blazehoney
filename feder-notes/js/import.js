// Import von PDF, Samsung Notes (.sdocx), Bildern, Text und Feder-Backups.
import { db, uid } from './db.js';
import { PAGE_W, A4_H, newPage } from './editor.js';
import { textToHTML } from './sanitize.js';

// Mitgelieferte Bibliotheken (pdf.js 3.11.174, JSZip 3.10.1) – funktionieren auch offline
const PDFJS = 'vendor/pdf.min.js';
const PDFJS_WORKER = new URL('vendor/pdf.worker.min.js', document.baseURI).href;
const JSZIP = 'vendor/jszip.min.js';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error('Bibliothek konnte nicht geladen werden: ' + src)); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

export async function storeAsset(blob) {
  const id = uid();
  await db.putAsset({ id, type: blob.type || 'application/octet-stream', blob, synced: false });
  return id;
}

/** Erzeugt aus einer Datei Seiten-Objekte (ohne sie einer Notiz zuzuordnen). */
export async function fileToPages(file, progress = () => {}) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfToPages(file, progress);
  if (name.endsWith('.sdocx')) return sdocxToPages(file, progress);
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(name)) return [await imageToPage(file)];
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
    return textToPages(await file.text());
  }
  throw new Error(`Dateityp wird nicht unterstützt: ${file.name}`);
}

/** Importiert eine Datei als neue Notiz. Gibt die Notiz zurück. */
export async function importFileAsNote(file, folder, progress) {
  const pages = await fileToPages(file, progress);
  const now = Date.now();
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return {
    id: uid(), title, folder: folder || '', paper: 'lined', pages,
    createdAt: file.lastModified || now, updatedAt: now, deleted: false, dirty: true,
  };
}

/* ---------------- PDF ---------------- */

async function pdfToPages(file, progress) {
  await loadScript(PDFJS);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    progress(`${file.name}: Seite ${i} / ${doc.numPages}`);
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = 1700 / vp1.width;                 // scharf genug zum Zoomen
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.86));
    const asset = await storeAsset(blob);
    let text = '';
    try {
      const tc = await page.getTextContent();
      text = tc.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
    } catch { /* gescannte PDFs haben keinen Text */ }
    pages.push({ ...newPage(), h: Math.round(PAGE_W * vp1.height / vp1.width), bg: { asset }, searchText: text });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

/* ---------------- Bilder ---------------- */

async function imageToPage(blob) {
  const bmp = await createImageBitmap(blob);
  // große Fotos verkleinern, damit der Speicher nicht explodiert
  const maxW = 2000;
  let out = blob;
  if (bmp.width > maxW || !/^image\/(png|jpeg|webp)$/.test(blob.type)) {
    const sc = Math.min(1, maxW / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  }
  const asset = await storeAsset(out);
  const h = Math.round(PAGE_W * bmp.height / bmp.width);
  bmp.close && bmp.close();
  return { ...newPage(), h: Math.max(200, h), bg: { asset } };
}

/* ---------------- Text ---------------- */

function textToPages(text) {
  // ca. 30 Zeilen pro A4-Seite
  const lines = text.replace(/\r/g, '').split('\n');
  const perPage = 30;
  const pages = [];
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) {
    const p = newPage();
    p.texts.push({ id: uid(), x: 100, y: 82, w: 840, html: textToHTML(lines.slice(i, i + perPage).join('\n')) });
    pages.push(p);
  }
  return pages;
}

/* ---------------- Samsung Notes (.sdocx) ---------------- */
// .sdocx ist ein ZIP-Container mit proprietären Binärdateien. Handschrift-Striche sind nicht
// offen dokumentiert; wir übernehmen daher eingebettete Bilder, Seitenvorschauen und Text.

async function sdocxToPages(file, progress) {
  await loadScript(JSZIP);
  progress(`${file.name}: wird entpackt …`);
  let zip;
  try { zip = await window.JSZip.loadAsync(file); }
  catch { throw new Error(`${file.name} ist keine gültige .sdocx-Datei (evtl. verschlüsselt/gesperrte Notiz).`); }

  const entries = Object.values(zip.files).filter(f => !f.dir);
  const images = entries.filter(f => /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name) && !/thumbnail|thumb_/i.test(f.name));
  const thumbs = entries.filter(f => /\.(png|jpe?g|webp)$/i.test(f.name) && /thumbnail|thumb_/i.test(f.name));
  const pages = [];

  // 1. Eingebettete Bilder/Seitenvorschauen (größte zuerst ausgewählt, ursprüngliche Reihenfolge bleibt)
  const pick = images.length ? images : thumbs;
  for (const f of pick) {
    const data = await f.async('uint8array');
    if (data.length < 4000) continue;     // Icons & Mini-Vorschauen überspringen
    const type = /\.png$/i.test(f.name) ? 'image/png' : /\.webp$/i.test(f.name) ? 'image/webp' : 'image/jpeg';
    try { pages.push(await imageToPage(new Blob([data], { type }))); } catch { /* kaputtes Bild */ }
  }

  // 2. Text heuristisch aus den Binärdaten (UTF-16LE) ziehen
  const textChunks = [];
  for (const f of entries) {
    if (/\.(png|jpe?g|webp|bmp|gif|xml|json|txt|spi|mp3|m4a|amr|3ga|mp4)$/i.test(f.name)) continue;
    textChunks.push(...extractUtf16(await f.async('uint8array')));
  }
  const seen = new Set();
  const NOISE = /^(arial|roboto|samsung\w*|sans-serif|serif|monospace|default|normal|sec\w*|true|false|null)$/i;
  const text = textChunks.filter(t => !NOISE.test(t) && !seen.has(t) && seen.add(t)).join('\n');

  if (text.trim()) {
    const tp = textToPages(text);
    tp[0].texts[0].html = '<div><b>Aus Samsung Notes übernommener Text:</b></div>' + tp[0].texts[0].html;
    pages.push(...tp);
  }
  if (!pages.length) {
    const p = newPage();
    p.texts.push({
      id: uid(), x: 100, y: 82, w: 820,
      html: textToHTML(`„${file.name}“ enthält nur Handschrift, die nicht direkt lesbar ist.\n\nBitte in Samsung Notes als PDF exportieren:\nNotiz öffnen → ⋮ → Als Datei speichern → PDF\nund die PDF hier importieren – dann bleibt alles exakt erhalten.`),
    });
    pages.push(p);
  }
  return pages;
}

function extractUtf16(bytes) {
  const out = [];
  let cur = '';
  const flush = () => {
    const s = cur.trim();
    // nur "echte" Texte: genug Buchstaben, nicht nur IDs/Pfade
    if (s.length >= 3 && /\p{L}{2}/u.test(s) && !/^[\w.-]+\.(png|jpe?g|page|note|dat|spi|xml)$/i.test(s)
        && !/^[0-9a-f-]{16,}$/i.test(s) && (s.match(/\p{L}/gu) || []).length / s.length > 0.5) out.push(s);
    cur = '';
  };
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = bytes[i] | (bytes[i + 1] << 8);
    const ok = (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c < 0x2000) || c === 0x20ac || c === 0x201e || c === 0x201c || c === 0x2013;
    if (ok) cur += String.fromCharCode(c);
    else if (c === 0x0a || c === 0x0d) { cur += '\n'; }
    else flush();
  }
  flush();
  return out;
}

/* ---------------- Backup ---------------- */

export async function exportBackup(notes) {
  const assetIds = new Set();
  notes.forEach(n => n.pages.forEach(p => p.bg && p.bg.asset && assetIds.add(p.bg.asset)));
  const assets = [];
  for (const id of assetIds) {
    const a = await db.getAsset(id);
    if (a) assets.push({ id, type: a.type, data: await blobToBase64(a.blob) });
  }
  const clean = notes.map(({ dirty, ...n }) => n);
  return new Blob([JSON.stringify({ format: 'feder-notes-backup', version: 1, exportedAt: Date.now(), notes: clean, assets })], { type: 'application/json' });
}

export async function readBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== 'feder-notes-backup') throw new Error('Keine Feder-Notes-Backup-Datei.');
  for (const a of data.assets || []) {
    if (!(await db.getAsset(a.id))) {
      await db.putAsset({ id: a.id, type: a.type, blob: base64ToBlob(a.data, a.type), synced: false });
    }
  }
  return data.notes || [];
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

export { A4_H };
