// Minimal IndexedDB key/value wrapper. Custom clients (with pictures and voice clips
// stored as data URLs) and imported mods are too large for localStorage.
const DB_NAME = 'scam-call-center';
const STORES = ['clients', 'mods', 'files'];
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const db = {
  async all(store) {
    try {
      return await tx(store, 'readonly', (s) => wrap(s.getAll()));
    } catch (err) {
      console.warn('IndexedDB unavailable', err);
      return [];
    }
  },
  get: (store, id) => tx(store, 'readonly', (s) => wrap(s.get(id))),
  put: (store, value) => tx(store, 'readwrite', (s) => wrap(s.put(value))),
  delete: (store, id) => tx(store, 'readwrite', (s) => wrap(s.delete(id))),
};
