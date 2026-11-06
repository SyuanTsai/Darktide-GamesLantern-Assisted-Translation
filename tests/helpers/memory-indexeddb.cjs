// Minimal transactional IndexedDB test double. Requests are asynchronous and transactions
// serialize; readwrite maps are committed together or discarded on abort.
function memoryIndexedDB() {
  const databases = new Map();
  return { databases, open(name) {
    const request = {};
    setImmediate(() => {
      let db = databases.get(name); const fresh = !db;
      if (!db) {
        const maps = new Map(); const keyPaths = new Map(); const queue = []; let busy = false;
        db = { maps, keyPaths, objectStoreNames: { contains: k => maps.has(k) }, close() {},
          createObjectStore(k, options) { maps.set(k, new Map()); keyPaths.set(k, options.keyPath); },
          transaction(names, mode) {
            const allowed = typeof names === 'string' ? [names] : names;
            let working; let aborted = false; const jobs = [];
            const tx = { error: null,
              abort() { if (!aborted) { aborted = true; setImmediate(() => { tx.onabort?.(); finish(); }); } },
              objectStore(k) {
                if (!allowed.includes(k)) throw new Error('outside transaction');
                function schedule(action) { const req = {}; jobs.push(() => { req.result = action(); req.onsuccess?.(); }); return req; }
                return {
                  get: key => schedule(() => structuredClone(working.get(k).get(key))),
                  getAll: () => schedule(() => structuredClone([...working.get(k).values()])),
                  getAllKeys: () => schedule(() => [...working.get(k).keys()]),
                  put: value => { const copy = structuredClone(value); return schedule(() => { working.get(k).set(copy[keyPaths.get(k)], copy); return copy[keyPaths.get(k)]; }); },
                  delete: key => schedule(() => working.get(k).delete(key))
                };
              }
            };
            let finished = false;
            function finish() { if (finished) return; finished = true; busy = false; pump(); }
            function run() {
              if (aborted) return;
              if (!jobs.length) {
                if (mode === 'readwrite') for (const k of allowed) maps.set(k, working.get(k));
                tx.oncomplete?.(); finish(); return;
              }
              try { jobs.shift()(); } catch (error) { tx.error = error; tx.onerror?.(); tx.abort(); return; }
              setImmediate(run);
            }
            queue.push(() => { working = new Map(allowed.map(k => [k, structuredClone(maps.get(k))])); setImmediate(run); });
            setImmediate(pump); return tx;
          }
        };
        function pump() { if (busy || !queue.length) return; busy = true; queue.shift()(); }
        databases.set(name, db);
      }
      request.result = db;
      if (fresh) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  } };
}
module.exports = { memoryIndexedDB };
