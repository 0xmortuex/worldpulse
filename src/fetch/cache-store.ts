import type { CacheEntry } from './cache-policy';

/**
 * Where cached responses live.
 *
 * An interface with two implementations so the transport can be tested without
 * IndexedDB — the policy that decides freshness is already pure, and this keeps
 * the storage that serves it equally substitutable.
 */
export interface CacheStore {
  read(key: string): Promise<CacheEntry | null>;
  write(entry: CacheEntry): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryCacheStore implements CacheStore {
  #entries = new Map<string, CacheEntry>();

  async read(key: string): Promise<CacheEntry | null> {
    return this.#entries.get(key) ?? null;
  }

  async write(entry: CacheEntry): Promise<void> {
    this.#entries.set(entry.cacheKey, entry);
  }

  async clear(): Promise<void> {
    this.#entries.clear();
  }
}

const DB_NAME = 'worldpulse-cache';
const STORE = 'responses';
const DB_VERSION = 1;

/**
 * IndexedDB store.
 *
 * EVERY METHOD SWALLOWS ITS ERRORS AND DEGRADES TO A MISS. That is deliberate
 * and is the single most important property here: the browser may evict this
 * store at any time under storage pressure, private-browsing modes may refuse it
 * outright, and quota may be exhausted mid-write. None of those are errors about
 * the data — they are the cache being a cache. A fact must never depend on an
 * entry existing, so a storage failure degrades to a fetch rather than to a
 * failed panel.
 */
export class IndexedDbCacheStore implements CacheStore {
  #db: Promise<IDBDatabase | null> | null = null;

  #open(): Promise<IDBDatabase | null> {
    this.#db ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'cacheKey' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.#db;
  }

  async read(key: string): Promise<CacheEntry | null> {
    const db = await this.#open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        request.onsuccess = () => resolve((request.result as CacheEntry | undefined) ?? null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async write(entry: CacheEntry): Promise<void> {
    const db = await this.#open();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry);
        request.onsuccess = () => resolve();
        // A failed write is not a failed request. The value is already in hand;
        // only the next visit is slower.
        request.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async clear(): Promise<void> {
    const db = await this.#open();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const request = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
