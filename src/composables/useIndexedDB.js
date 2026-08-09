
/**
 * useIndexedDB
 *
 * Persists MediaRecorder chunks to IndexedDB while recording is in progress.
 * If the tab crashes, the user navigates away, or the battery dies, the chunks
 * survive in the database. On the next visit the app calls checkOrphan() and
 * offers to upload the saved take.
 *
 * Resolves F4 Layer 3.
 *
 * Schema:
 *   DB: voice-app-db  (v1)
 *   Store 'chunks':  autoIncrement key, value: Blob
 *   Store 'session': keyPath 'key', value: { key, mimeType, startedAt, durationMs }
 */

const DB_NAME    = 'voice-app-db'
const DB_VERSION = 1
const STORE_CHUNKS  = 'chunks'
const STORE_SESSION = 'session'
const SESSION_KEY   = 'current'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(STORE_SESSION)) {
        db.createObjectStore(STORE_SESSION, { keyPath: 'key' })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

function txPut(db, storeName, value, key) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req   = key !== undefined ? store.put(value, key) : store.put(value)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function txGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req   = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function txGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req   = store.get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function txClear(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req   = store.clear()
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

export function useIndexedDB() {
  let db = null

  async function getDB() {
    if (!db) db = await openDB()
    return db
  }

  /**
   * Start a new recording session — saves MIME type and start time.
   * Call this when MediaRecorder.start() fires.
   */
  async function beginSession(mimeType) {
    const database = await getDB()
    await Promise.all([
      txClear(database, STORE_CHUNKS),
      txPut(database, STORE_SESSION, {
        key: SESSION_KEY,
        mimeType,
        startedAt: Date.now(),
        durationMs: 0,
      }),
    ])
  }

  /**
   * Append a chunk that arrived from ondataavailable.
   * Call this inside the ondataavailable handler.
   */
  async function appendChunk(blob) {
    const database = await getDB()
    await txPut(database, STORE_CHUNKS, blob)
  }

  /**
   * Update the running duration so even a crash preserves an approximate length.
   */
  async function updateDuration(durationMs) {
    const database = await getDB()
    const session  = await txGet(database, STORE_SESSION, SESSION_KEY)
    if (!session) return
    await txPut(database, STORE_SESSION, { ...session, durationMs })
  }

  /**
   * Finalize — clear both stores after a successful upload or deliberate discard.
   */
  async function clear() {
    const database = await getDB()
    await Promise.all([
      txClear(database, STORE_CHUNKS),
      txClear(database, STORE_SESSION),
    ])
  }

  /**
   * Check whether there is an orphaned recording from a previous session.
   * Returns null if nothing found, or { blob, mimeType, durationMs, startedAt }.
   */
  async function checkOrphan() {
    try {
      const database = await getDB()
      const session  = await txGet(database, STORE_SESSION, SESSION_KEY)
      if (!session) return null
      const chunks = await txGetAll(database, STORE_CHUNKS)
      if (!chunks.length) return null
      const blob = new Blob(chunks, { type: session.mimeType })
      if (blob.size < 1000) return null // too small to be a real recording
      return {
        blob,
        mimeType:   session.mimeType,
        durationMs: session.durationMs,
        startedAt:  session.startedAt,
      }
    } catch {
      return null
    }
  }

  return { beginSession, appendChunk, updateDuration, clear, checkOrphan }
}
