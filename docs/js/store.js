// Wrapper fino de IndexedDB. Só roda no navegador (usa o global `indexedDB`).
// Ao mudar o formato local no futuro, suba DB_VERSION e trate em onupgradeneeded
// sem apagar o que já existe — é o jeito de nunca perder dado guardado localmente.
const DB_NAME = "sono-db";
const DB_VERSION = 1;
const LOG_LIMIT = 50;

let dbPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) {
        const os = db.createObjectStore("outbox", { keyPath: "localId", autoIncrement: true });
        os.createIndex("byTarget", "targetKey");
      }
      if (!db.objectStoreNames.contains("synclog")) db.createObjectStore("synclog", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function db() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}
function reqp(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function withStore(storeName, mode, run) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(run(store)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const putEventRow = row => withStore("events", "readwrite", s => reqp(s.put(row)));
export const getAllEvents = () => withStore("events", "readonly", s => reqp(s.getAll()));
export const deleteEventRow = id => withStore("events", "readwrite", s => reqp(s.delete(id)));

export const getMeta = key => withStore("meta", "readonly", s => reqp(s.get(key))).then(r => (r ? r.value : undefined));
export const setMeta = (key, value) => withStore("meta", "readwrite", s => reqp(s.put({ key, value })));

export const getOutbox = () => withStore("outbox", "readonly", s => reqp(s.getAll()));
export const addOutboxOp = op => withStore("outbox", "readwrite", s => reqp(s.add(op)));
export const deleteOutboxOp = localId => withStore("outbox", "readwrite", s => reqp(s.delete(localId)));

// Substitui qualquer op pendente do mesmo alvo (table+id) — só a mais recente importa.
export async function enqueueOutboxOp(op) {
  const targetKey = op.table + ":" + (op.row ? op.row.id : op.id);
  await withStore("outbox", "readwrite", async store => {
    const idx = store.index("byTarget");
    const existing = await reqp(idx.getAllKeys(targetKey));
    for (const localId of existing) store.delete(localId);
    store.add({ ...op, targetKey });
  });
}

export async function addLog(entry) {
  await withStore("synclog", "readwrite", s => reqp(s.add({ ...entry, ts: Date.now() })));
  const all = await withStore("synclog", "readonly", s => reqp(s.getAll()));
  if (all.length > LOG_LIMIT) {
    const excess = all.slice(0, all.length - LOG_LIMIT);
    await withStore("synclog", "readwrite", store => { for (const e of excess) store.delete(e.id); });
  }
}
export const getLog = () => withStore("synclog", "readonly", s => reqp(s.getAll()));

// Importa o que já estava em localStorage (versões anteriores do app) para o IndexedDB,
// uma única vez. Depois disso o localStorage simplesmente para de ser lido.
export async function migrateFromLocalStorage() {
  const existing = await getAllEvents();
  if (existing.length > 0) return false;
  let migrated = false;
  try {
    const cache = JSON.parse(localStorage.getItem("sono-cache-v3"));
    if (cache && cache.ev) {
      for (const ev of Object.values(cache.ev)) await putEventRow(ev);
      if (cache.since != null) await setMeta("since", cache.since);
      if (cache.live) await setMeta("live", cache.live);
      if (cache.config) await setMeta("config", cache.config);
      if (cache.uid != null) await setMeta("uid", cache.uid);
      if (cache.users) await setMeta("users", cache.users);
      migrated = true;
    }
  } catch { /* sem cache antigo, tudo bem */ }
  try {
    const queue = JSON.parse(localStorage.getItem("sono-queue-v3"));
    if (Array.isArray(queue) && queue.length) {
      for (const op of queue) await enqueueOutboxOp(op);
      migrated = true;
    }
  } catch { /* sem fila antiga, tudo bem */ }
  return migrated;
}
