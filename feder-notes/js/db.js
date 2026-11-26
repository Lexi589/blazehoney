// Lokale Speicherung in IndexedDB: Notizen, Assets (Bilder/PDF-Seiten als Blob) und Metadaten.
const DB_NAME = 'feder-notes';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req instanceof IDBRequest ? req.result : req);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  allNotes: () => run('notes', 'readonly', s => s.getAll()),
  getNote: id => run('notes', 'readonly', s => s.get(id)),
  putNote: note => run('notes', 'readwrite', s => s.put(note)),
  removeNote: id => run('notes', 'readwrite', s => s.delete(id)),

  getAsset: id => run('assets', 'readonly', s => s.get(id)),
  putAsset: asset => run('assets', 'readwrite', s => s.put(asset)),
  allAssetKeys: () => run('assets', 'readonly', s => s.getAllKeys()),

  async getMeta(key, fallback = null) {
    const row = await run('meta', 'readonly', s => s.get(key));
    return row ? row.value : fallback;
  },
  setMeta: (key, value) => run('meta', 'readwrite', s => s.put({ key, value })),
};

// IDs ohne crypto.randomUUID (das fehlt in unsicheren Kontexten, z. B. http://192.168.x.x)
export function uid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

/** Alle Dateien (PDF-Seiten, Bilder, Sprachaufnahmen), die eine Seite benutzt. */
export function pageAssets(p) {
  return [p.bg && p.bg.asset, ...(p.images || []).map(i => i.asset), ...(p.audios || []).map(a => a.asset)].filter(Boolean);
}
