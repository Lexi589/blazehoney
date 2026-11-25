// Speicherung auf der eigenen Nextcloud (WebDAV).
//
// Aufbau des Ordners (Standard: /FederNotes in deinen Nextcloud-Dateien):
//   index.json          Inhaltsverzeichnis { notes: { <id>: { u: updatedAt, d: gelöscht } } }
//   note-<id>.json      eine Notiz (Striche, Textfelder, Seiten)
//   asset-<id>.b64      Bild / PDF-Seite (Typ in Zeile 1, Base64 ab Zeile 2)
//
// Es werden bewusst nur GET/PUT/DELETE benutzt (funktioniert auch mit dem Android-HTTP-Client).
// Gleichzeitige Änderungen am Inhaltsverzeichnis werden per ETag (If-Match) erkannt.
import { db } from './db.js';
import { http, platform, openExternal } from './transport.js';

export function normalizeNcUrl(url) {
  let u = String(url || '').trim();
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/(index\.php|apps|remote\.php|login|ocs)(\/.*)?$/i, '').replace(/\/+$/, '');
}

class NC {
  constructor(cfg) {
    this.cfg = cfg;
    this.root = normalizeNcUrl(cfg.ncUrl);
    this.auth = 'Basic ' + btoa(unescape(encodeURIComponent(`${cfg.ncUser}:${cfg.ncPass}`)));
    this.folder = (cfg.ncFolder || 'FederNotes').split('/').filter(Boolean);
  }

  async req(method, url, headers = {}, body) {
    let res;
    try {
      res = await http(method, url, { headers: { Authorization: this.auth, ...headers }, body });
    } catch (err) {
      if (platform === 'web') {
        throw new Error('Im Browser blockiert Nextcloud den Zugriff. Bitte die Windows- oder Android-App benutzen.');
      }
      throw new Error('Nextcloud nicht erreichbar: ' + (err.message || err));
    }
    if (res.status === 401) throw new Error('Benutzername oder App-Passwort falsch');
    if (res.status === 503) throw new Error('Nextcloud ist im Wartungsmodus');
    return res;
  }

  /** Echte Benutzer-ID (kann vom Login-Namen abweichen, z. B. beim Login per E-Mail). */
  async userId() {
    const key = 'ncUserId:' + this.root + '|' + this.cfg.ncUser;
    const cached = await db.getMeta(key);
    if (cached) return cached;
    const res = await this.req('GET', this.root + '/ocs/v2.php/cloud/user?format=json', { 'OCS-APIRequest': 'true', Accept: 'application/json' });
    if (res.status === 404) throw new Error('Unter dieser Adresse wurde keine Nextcloud gefunden');
    if (res.status !== 200) throw new Error(`Nextcloud antwortet mit ${res.status}`);
    let id;
    try { id = JSON.parse(res.text).ocs.data.id; } catch { throw new Error('Unter dieser Adresse wurde keine Nextcloud gefunden'); }
    await db.setMeta(key, id);
    return id;
  }

  async base() {
    if (!this._base) {
      const id = await this.userId();
      this._base = `${this.root}/remote.php/dav/files/${encodeURIComponent(id)}/` + this.folder.map(encodeURIComponent).join('/') + '/';
    }
    return this._base;
  }

  async ensureFolder() {
    const id = await this.userId();
    let url = `${this.root}/remote.php/dav/files/${encodeURIComponent(id)}/`;
    for (const part of this.folder) {
      url += encodeURIComponent(part) + '/';
      const res = await this.req('MKCOL', url);
      if (![201, 405].includes(res.status)) throw new Error(`Ordner konnte nicht angelegt werden (${res.status})`);
    }
  }

  async get(name) {
    const res = await this.req('GET', (await this.base()) + name, { 'Cache-Control': 'no-cache' });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`Lesen von ${name} fehlgeschlagen (${res.status})`);
    return res;
  }

  /** @returns {Promise<'ok'|'conflict'>} */
  async put(name, text, headers = {}) {
    const url = (await this.base()) + name;
    let res = await this.req('PUT', url, { 'Content-Type': 'application/octet-stream', ...headers }, text);
    if (res.status === 409) {               // Ordner fehlt noch
      await this.ensureFolder();
      res = await this.req('PUT', url, { 'Content-Type': 'application/octet-stream', ...headers }, text);
    }
    if (res.status === 412) return 'conflict';
    if (res.status === 507) throw new Error('Nextcloud-Speicher ist voll');
    if (res.status < 200 || res.status >= 300) throw new Error(`Speichern von ${name} fehlgeschlagen (${res.status})`);
    return 'ok';
  }

  async getIndex() {
    const res = await this.get('index.json');
    if (!res) return { index: { format: 'feder-notes', notes: {} }, etag: null };
    let index;
    try { index = JSON.parse(res.text); } catch { index = null; }
    if (!index || typeof index.notes !== 'object') index = { format: 'feder-notes', notes: {} };
    return { index, etag: res.headers.etag || null };
  }
}

export async function ncTest(cfg) {
  const nc = new NC(cfg);
  await nc.userId();
  // Schreibtest (legt den Ordner bei Bedarf an)
  if (await nc.put('.feder-check', 'ok') !== 'ok') throw new Error('Schreiben nicht möglich');
  await nc.req('DELETE', (await nc.base()) + '.feder-check');
  const { index } = await nc.getIndex();
  return { notes: Object.values(index.notes).filter(n => !n.d).length };
}

const json = obj => JSON.stringify(obj);

/** Ein Synchronisationsdurchlauf. `s` ist die Sync-Instanz (mergeRemote, getNotes …). */
export async function ncSync(s) {
  const nc = new NC(s.config);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { index, etag } = await nc.getIndex();
    const seenKey = 'ncSeen:' + nc.root + '|' + s.config.ncUser + '|' + nc.folder.join('/');
    const seen = await db.getMeta(seenKey, {});

    // 1. Änderungen anderer Geräte holen
    for (const [id, r] of Object.entries(index.notes)) {
      const local = s.getNotes().find(n => n.id === id);
      if (local && local.updatedAt === r.u) {
        if (local.dirty) { local.dirty = false; await db.putNote(local); }
        seen[id] = r.u;
        continue;
      }
      if (local && local.dirty && seen[id] === r.u) continue;   // nur hier geändert → wird hochgeladen
      if (!local && r.d && r.p) { seen[id] = r.u; continue; }   // endgültig gelöscht, hier nie gesehen
      const res = await nc.get(`note-${id}.json`);
      if (!res) continue;
      const remote = JSON.parse(res.text);
      await s.mergeRemote(remote);
      seen[id] = remote.updatedAt;
    }

    // 2. fehlende Bilder / PDF-Seiten laden
    const have = new Set(await db.allAssetKeys());
    for (const n of s.getNotes()) for (const p of n.pages) {
      const id = p.bg && p.bg.asset;
      if (!id || have.has(id)) continue;
      const res = await nc.get(`asset-${id}.b64`);
      if (!res) continue;
      const nl = res.text.indexOf('\n');
      const type = res.text.slice(0, nl) || 'image/jpeg';
      await db.putAsset({ id, type, blob: base64ToBlob(res.text.slice(nl + 1).trim(), type), synced: true });
      have.add(id);
    }

    // 3. eigene Änderungen hochladen
    const dirty = s.getNotes().filter(n => n.dirty);
    const sent = new Map();
    for (const n of dirty) {
      for (const p of n.pages) {
        const id = p.bg && p.bg.asset;
        if (!id) continue;
        const a = await db.getAsset(id);
        if (a && !a.synced) {
          await nc.put(`asset-${id}.b64`, a.type + '\n' + await blobToBase64(a.blob));
          a.synced = true; await db.putAsset(a);
        }
      }
      const { dirty: _d, ...payload } = n;
      await nc.put(`note-${n.id}.json`, json(payload));
      index.notes[n.id] = { u: n.updatedAt, d: !!n.deleted, ...(n.purged ? { p: 1 } : {}) };
      sent.set(n, n.updatedAt);
    }

    // 4. Inhaltsverzeichnis schreiben (nur wenn sich niemand dazwischen gedrängelt hat)
    if (sent.size) {
      index.format = 'feder-notes';
      index.updated = Date.now();
      const cond = etag ? { 'If-Match': etag } : { 'If-None-Match': '*' };
      if (await nc.put('index.json', json(index), cond) === 'conflict') continue;   // neu einlesen & nochmal
    }
    for (const [n, at] of sent) {
      seen[n.id] = at;
      if (n.updatedAt === at) { n.dirty = false; await db.putNote(n); }
    }
    await db.setMeta(seenKey, seen);
    return;
  }
  throw new Error('Nextcloud ist gerade ausgelastet – bitte gleich nochmal versuchen');
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

/**
 * Anmeldung per Nextcloud Login Flow v2: Browser öffnet sich, man bestätigt den Zugriff,
 * die App bekommt automatisch ein eigenes App-Passwort. Kein Abtippen von Passwörtern.
 * @returns {Promise<{ncUrl, ncUser, ncPass}>}
 */
export async function ncLogin(serverUrl, { onWaiting, isCancelled } = {}) {
  const root = normalizeNcUrl(serverUrl);
  if (!root) throw new Error('Bitte die Adresse deiner Nextcloud eingeben');
  const ua = { 'User-Agent': `Feder Notes (${platform === 'android' ? 'Android' : platform === 'windows' ? 'Windows' : 'Browser'})` };
  let res;
  try { res = await http('POST', root + '/index.php/login/v2', { headers: ua }); }
  catch (err) {
    if (platform === 'web') throw new Error('Im Browser blockiert Nextcloud die Anmeldung. Bitte die App benutzen.');
    throw new Error('Nextcloud nicht erreichbar – stimmt die Adresse? (' + (err.message || err) + ')');
  }
  if (res.status !== 200) throw new Error(`Unter dieser Adresse wurde keine Nextcloud gefunden (${res.status})`);
  let flow;
  try { flow = JSON.parse(res.text); } catch { throw new Error('Unter dieser Adresse wurde keine Nextcloud gefunden'); }
  await openExternal(flow.login);
  onWaiting && onWaiting();
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    if (isCancelled && isCancelled()) throw new Error('Anmeldung abgebrochen');
    let poll;
    try {
      poll = await http('POST', flow.poll.endpoint, {
        headers: { ...ua, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'token=' + encodeURIComponent(flow.poll.token),
      });
    } catch { continue; }   // kurz offline? weiter warten
    if (poll.status === 200) {
      const d = JSON.parse(poll.text);
      return { ncUrl: normalizeNcUrl(d.server) || root, ncUser: d.loginName, ncPass: d.appPassword };
    }
  }
  throw new Error('Zeit abgelaufen – bitte nochmal „Anmelden“ tippen');
}
