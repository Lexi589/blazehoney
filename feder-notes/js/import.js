// Import von PDF, Samsung Notes (.sdocx), Bildern, Text und Feder-Backups.
import { db, uid, pageAssets } from './db.js';
import { PAGE_W, A4_H, newPage } from './editor.js';
import { textToHTML } from './sanitize.js';
import { readSdocx } from './sdocx.js';

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
  const title = pages.title || file.name.replace(/\.[^.]+$/, '')
    .replace(/_\d{6}_\d{6}$/, '')          // Samsung-Zeitstempel (JJMMTT_HHMMSS) entfernen
    .replace(/[_]+/g, ' ').trim() || 'Import';
  return {
    id: uid(), title, folder: folder || '', paper: pages.paper || 'lined', pages: [...pages],
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

const CHARS_PER_LINE = 62;   // ca. Zeichen pro Zeile bei Textfeldbreite 840 und 24px Schrift
const LINES_PER_PAGE = 30;

function textToPages(text) {
  // Absätze auf A4-Seiten verteilen; lange Absätze zählen als mehrere Zeilen
  const paras = text.replace(/\r/g, '').split('\n');
  const pages = [];
  let cur = [], used = 0;
  const flush = () => {
    const p = newPage();
    p.texts.push({ id: uid(), x: 100, y: 82, w: 840, html: textToHTML(cur.join('\n')) });
    pages.push(p);
    cur = []; used = 0;
  };
  for (const para of paras) {
    const lines = Math.max(1, Math.ceil(para.length / CHARS_PER_LINE));
    if (used + lines > LINES_PER_PAGE && cur.length) flush();
    cur.push(para); used += lines;
  }
  if (cur.length || !pages.length) flush();
  return pages;
}


/* ---------------- Samsung Notes (.sdocx) ---------------- */
// .sdocx ist ein ZIP-Container. Handschrift, getippter Text (mit Absätzen, Listen, Farben), Tabellen und
// eingefügte Bilder werden übernommen (siehe sdocx.js).

async function sdocxToPages(file, progress) {
  await loadScript(JSZIP);
  progress(`${file.name}: wird entpackt …`);
  let zip;
  try { zip = await window.JSZip.loadAsync(file); }
  catch { throw new Error(`${file.name} ist keine gültige .sdocx-Datei (evtl. verschlüsselt/gesperrte Notiz).`); }
  const pages = await readSdocx(zip, { name: file.name, progress, storeImage: storeAsset });
  pages.paper = 'blank';
  if (!pages.some(p => p.strokes.length || p.texts.length || (p.images && p.images.length))) {
    const hint = newPage();
    hint.texts.push({
      id: uid(), x: 100, y: 82, w: 820,
      html: textToHTML(`In „${file.name}“ wurde nichts Lesbares gefunden (evtl. eine neuere Samsung-Version oder eine gesperrte Notiz).\n\nAlternative: In Samsung Notes die Notiz öffnen → ⋮ → Als Datei speichern → PDF und die PDF hier importieren.`),
    });
    pages.push(hint);
  }
  return pages;
}

/* ---------------- Backup ---------------- */

export async function exportBackup(notes) {
  const assetIds = new Set();
  notes.forEach(n => n.pages.forEach(p => pageAssets(p).forEach(id => assetIds.add(id))));
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
