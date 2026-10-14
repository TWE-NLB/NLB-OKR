// Arbeitsspeicher der App: IndexedDB im Browser. Dauerhaft gesichert wird über Dateien (Export/Import).

const DB_NAME = 'nlb-okr';
const DB_VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('persons')) db.createObjectStore('persons', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('measurements')) db.createObjectStore('measurements', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  }));
}

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const put = (store, obj) => tx(store, 'readwrite', (s) => { s.put(obj); return obj; });
export const remove = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Bietet Dateien über das Teilen-Menü an (Sichern in „Dateien“, AirDrop, SeaFile …).
// Muss direkt aus einem Klick heraus aufgerufen werden. Fallback: normaler Download.
export async function offerFiles(files) {
  const objs = files.map((f) => new File([f.text], f.name, { type: f.type }));
  if (navigator.canShare?.({ files: objs })) {
    try {
      await navigator.share({ files: objs });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'aborted';
      console.warn('Teilen fehlgeschlagen, nutze Download', e);
    }
  }
  for (const f of objs) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return 'downloaded';
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
