#!/usr/bin/env node
// Feder Notes – Sync-Server (ohne Abhängigkeiten, Node.js ≥ 18)
//
//   node server/server.js
//
// Umgebungsvariablen:
//   PORT         (Standard 8787)
//   NOTES_TOKEN  festes Zugangs-Token (sonst wird eins erzeugt und in data/token.txt gespeichert)
//   NOTES_DATA   Datenordner (Standard: server/data)
//
// Der Server liefert auch die App selbst aus: http://<ip>:8787
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = +process.env.PORT || 8787;
const APP_ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(process.env.NOTES_DATA || path.join(__dirname, 'data'));
const NOTES_DIR = path.join(DATA, 'notes');
const ASSETS_DIR = path.join(DATA, 'assets');
const META_FILE = path.join(DATA, 'meta.json');
const MAX_JSON = 80 * 1024 * 1024;
const MAX_ASSET = 40 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

fs.mkdirSync(NOTES_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

// ---------- Token ----------
let TOKEN = process.env.NOTES_TOKEN;
const tokenFile = path.join(DATA, 'token.txt');
if (!TOKEN) {
  if (fs.existsSync(tokenFile)) TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
  else {
    TOKEN = crypto.randomBytes(18).toString('base64url');
    fs.writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
  }
}
const TOKEN_BUF = Buffer.from(TOKEN);

// ---------- Index (im Speicher) ----------
let meta = { rev: 0 };
try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { /* neu */ }
const index = new Map(); // id → { updatedAt, rev }
for (const f of fs.readdirSync(NOTES_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const n = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, f), 'utf8'));
    index.set(n.id, { updatedAt: n.updatedAt, rev: n.rev || 0 });
    meta.rev = Math.max(meta.rev, n.rev || 0);
  } catch (e) { console.warn('Defekte Notizdatei übersprungen:', f, e.message); }
}

async function writeAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

// Schreibzugriffe nacheinander abarbeiten, damit Revisionen eindeutig bleiben
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));

// ---------- HTTP-Helfer ----------
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    ...cors(), ...headers,
  });
  res.end(data);
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, HEAD, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Zu groß'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function authorized(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const b = Buffer.from(m[1]);
  return b.length === TOKEN_BUF.length && crypto.timingSafeEqual(b, TOKEN_BUF);
}

// ---------- API ----------
async function api(req, res, url) {
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
  const p = url.pathname;

  if (p === '/api/ping' && req.method === 'GET') {
    return send(res, 200, { ok: true, rev: meta.rev, notes: index.size, now: Date.now() });
  }

  if (p === '/api/changes' && req.method === 'GET') {
    const since = +url.searchParams.get('since') || 0;
    const rev = meta.rev;
    const ids = [...index].filter(([, v]) => v.rev > since && v.rev <= rev).map(([id]) => id);
    const notes = [];
    for (const id of ids) {
      try { notes.push(JSON.parse(await fsp.readFile(path.join(NOTES_DIR, id + '.json'), 'utf8'))); } catch { /* gerade geschrieben */ }
    }
    return send(res, 200, { rev, notes });
  }

  if (p === '/api/notes' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'));
    const incoming = Array.isArray(body.notes) ? body.notes : [];
    const result = await serial(async () => {
      const startRev = meta.rev;
      const accepted = [], rejected = [];
      for (const n of incoming) {
        if (!n || !ID_RE.test(n.id) || typeof n.updatedAt !== 'number' || !Array.isArray(n.pages)) { rejected.push(n && n.id); continue; }
        const cur = index.get(n.id);
        if (cur && cur.updatedAt > n.updatedAt) { rejected.push(n.id); continue; }
        if (cur && cur.updatedAt === n.updatedAt) { accepted.push(n.id); continue; }
        meta.rev++;
        n.rev = meta.rev;
        await writeAtomic(path.join(NOTES_DIR, n.id + '.json'), JSON.stringify(n));
        index.set(n.id, { updatedAt: n.updatedAt, rev: n.rev });
        accepted.push(n.id);
      }
      await writeAtomic(META_FILE, JSON.stringify(meta));
      return { startRev, rev: meta.rev, accepted, rejected };
    });
    return send(res, 200, result);
  }

  const am = /^\/api\/assets\/([A-Za-z0-9-]{8,64})$/.exec(p);
  if (am) {
    const file = path.join(ASSETS_DIR, am[1]);
    if (req.method === 'PUT') {
      const data = await readBody(req, MAX_ASSET);
      const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
      await writeAtomic(file, data);
      await writeAtomic(file + '.type', type);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      try {
        const [data, type] = await Promise.all([fsp.readFile(file), fsp.readFile(file + '.type', 'utf8').catch(() => 'application/octet-stream')]);
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'private, max-age=31536000, immutable', ...cors() });
        return res.end(req.method === 'HEAD' ? undefined : data);
      } catch { return send(res, 404, { error: 'not found' }); }
    }
  }
  return send(res, 404, { error: 'not found' });
}

// ---------- App ausliefern ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8',
};
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(APP_ROOT, '.' + rel);
  // Nur App-Dateien – niemals den Server-Ordner (Token, Daten) ausliefern
  if (!file.startsWith(APP_ROOT + path.sep) || file.startsWith(path.join(APP_ROOT, 'server') + path.sep) || file.startsWith(DATA)) {
    return send(res, 404, 'Not found');
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch { send(res, 404, 'Not found'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, url);
    send(res, 405, 'Method not allowed');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || (err instanceof SyntaxError ? 400 : 500), { error: err.message });
  }
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  Feder Notes Sync-Server läuft\n');
  console.log(`  Lokal:     http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Netzwerk:  http://${ip}:${PORT}`));
  console.log(`\n  Token:     ${TOKEN}`);
  console.log(`  Daten:     ${DATA}\n`);
});
