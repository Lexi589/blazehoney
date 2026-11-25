// Synchronisation mit dem Feder-Sync-Server.
// Prinzip: Jede Notiz hat updatedAt + dirty. Der Server vergibt fortlaufende Revisionen;
// wir holen alles seit unserer letzten Revision und schicken lokale Änderungen hoch.
// Wurde dieselbe Notiz auf zwei Geräten geändert, gewinnt die neuere – die andere wird
// als "Konflikt"-Kopie behalten, damit nie etwas verloren geht.
import { db, uid } from './db.js';

export class Sync {
  constructor({ getNotes, onRemoteNote, onStatus }) {
    this.getNotes = getNotes;
    this.onRemoteNote = onRemoteNote;
    this.onStatus = onStatus;
    this.running = null;
    this.config = null;
  }

  async loadConfig() {
    this.config = await db.getMeta('sync', { url: '', token: '', auto: true });
    return this.config;
  }

  async saveConfig(cfg) {
    const changedServer = this.config && (cfg.url !== this.config.url);
    this.config = cfg;
    await db.setMeta('sync', cfg);
    if (changedServer) {
      // neuer Server: alles nochmal hochladen und komplett abholen
      await db.setMeta('syncRev', 0);
      for (const n of this.getNotes()) { n.dirty = true; await db.putNote(n); }
      for (const id of await db.allAssetKeys()) {
        const a = await db.getAsset(id); a.synced = false; await db.putAsset(a);
      }
    }
  }

  get configured() { return !!(this.config && this.config.url && this.config.token); }

  base() { return this.config.url.replace(/\/+$/, ''); }

  async api(path, opts = {}) {
    const res = await fetch(this.base() + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + this.config.token, ...(opts.headers || {}) },
    });
    if (res.status === 401) throw new Error('Token ungültig');
    if (!res.ok && res.status !== 404) throw new Error(`Server-Fehler ${res.status}`);
    return res;
  }

  async test(cfg) {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/api/ping', { headers: { Authorization: 'Bearer ' + cfg.token } });
    if (res.status === 401) throw new Error('Token ungültig');
    if (!res.ok) throw new Error(`Server antwortet mit ${res.status}`);
    return res.json();
  }

  sync() {
    if (!this.configured) { this.onStatus('off', 'Sync: nicht eingerichtet'); return Promise.resolve(); }
    if (!this.running) this.running = this._sync().finally(() => { this.running = null; });
    return this.running;
  }

  async _sync() {
    if (!navigator.onLine) { this.onStatus('err', 'Offline – Änderungen werden später übertragen'); return; }
    this.onStatus('busy', 'Synchronisiere …');
    try {
      let rev = await db.getMeta('syncRev', 0);

      // 1. Änderungen vom Server holen
      const res = await this.api('/api/changes?since=' + rev);
      const { notes: remote, rev: serverRev } = await res.json();
      for (const r of remote) await this.mergeRemote(r);
      rev = serverRev;

      // 2. fehlende Bilder/PDF-Seiten laden
      const have = new Set(await db.allAssetKeys());
      for (const n of this.getNotes()) for (const p of n.pages) {
        const id = p.bg && p.bg.asset;
        if (id && !have.has(id)) {
          const ar = await this.api('/api/assets/' + id);
          if (ar.ok) {
            const blob = await ar.blob();
            await db.putAsset({ id, type: blob.type, blob, synced: true });
            have.add(id);
          }
        }
      }

      // 3. lokale Änderungen hochladen
      const dirty = this.getNotes().filter(n => n.dirty);
      if (dirty.length) {
        for (const n of dirty) for (const p of n.pages) {
          const id = p.bg && p.bg.asset;
          if (!id) continue;
          const a = await db.getAsset(id);
          if (a && !a.synced) {
            await this.api('/api/assets/' + id, { method: 'PUT', headers: { 'Content-Type': a.type }, body: a.blob });
            a.synced = true; await db.putAsset(a);
          }
        }
        // in Paketen senden, damit große Notizbücher nicht an Größenlimits scheitern
        for (let i = 0; i < dirty.length; i += 20) {
          const batch = dirty.slice(i, i + 20);
          const payload = batch.map(({ dirty: _d, ...n }) => n);
          const pr = await this.api('/api/notes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: payload }),
          });
          const out = await pr.json();
          const accepted = new Set(out.accepted);
          for (const n of batch) {
            const sent = payload.find(p => p.id === n.id);
            // nur als sauber markieren, wenn seitdem nicht weiter bearbeitet wurde
            if (accepted.has(n.id) && n.updatedAt === sent.updatedAt) { n.dirty = false; await db.putNote(n); }
          }
          // Nur weiterspringen, wenn zwischendurch kein anderes Gerät etwas hochgeladen hat –
          // sonst würden wir dessen Änderungen überspringen. (Eigene Notizen kommen sonst einmal zurück, das ist harmlos.)
          if (out.startRev === rev) rev = out.rev;
        }
      }
      await db.setMeta('syncRev', rev);
      this.onStatus('ok', 'Synchronisiert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error(err);
      this.onStatus('err', 'Sync-Fehler: ' + (err.message === 'Failed to fetch' ? 'Server nicht erreichbar' : err.message));
    }
  }

  async mergeRemote(remote) {
    const local = this.getNotes().find(n => n.id === remote.id);
    delete remote.rev;
    if (!local) { await this.onRemoteNote({ ...remote, dirty: false }); return; }
    if (local.updatedAt === remote.updatedAt) { if (local.dirty) { local.dirty = false; await db.putNote(local); } return; }
    if (!local.dirty) { await this.onRemoteNote({ ...remote, dirty: false }); return; }

    // Konflikt: auf beiden Geräten geändert
    const [winner, loser] = remote.updatedAt > local.updatedAt ? [remote, local] : [local, remote];
    if (winner === remote) await this.onRemoteNote({ ...remote, dirty: false });
    // local gewinnt: bleibt dirty und wird gleich hochgeladen
    if (!loser.deleted && !winner.deleted) {
      const copy = JSON.parse(JSON.stringify(loser));
      copy.id = uid();
      copy.title = (copy.title || 'Unbenannt') + ' (Konflikt)';
      copy.dirty = true;
      copy.updatedAt = Date.now();
      await this.onRemoteNote(copy);
    } else if (winner.deleted && !loser.deleted && winner === remote) {
      // auf anderem Gerät gelöscht, hier aber weiterbearbeitet → hier bearbeitete Version behalten
      await this.onRemoteNote({ ...local, dirty: true, updatedAt: Date.now() });
    }
  }
}
