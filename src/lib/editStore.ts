/**
 * Edits that survive a reload.
 *
 * Today a refresh loses everything. That is worse than it sounds on a phone: the browser reclaims
 * a backgrounded tab whenever it likes, so "I lost my edits" and "I looked at a message" are the
 * same event. An 18-minute read followed by twenty minutes of careful cell work should not be one
 * memory-pressure event away from gone.
 *
 * Keyed by the image's SHA-256, so edits follow the BYTES rather than the session. Load the same
 * dump tomorrow and the work is there; load a different one and it is not, with no way for the two
 * to be confused.
 *
 * Everything here is best-effort. IndexedDB is refused in private windows and by some Android
 * WebViews, and a tool that cannot open its own storage must still let you tune. Nothing in this
 * file throws at the caller.
 */

import type { EditSet, EditEntry } from './edits';

import { DB_VERSION, EDITS_STORE as STORE, upgrade } from './sessionStore';

const DB_NAME = 'smg2-drivelogic';

interface StoredRecord {
    /** The image SHA-256. The primary key. */
    readonly sha256: string;
    readonly savedAt: number;
    readonly entries: readonly EditEntry[];
}

function open(): Promise<IDBDatabase | null> {
    return new Promise(resolve => {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null); return;
        }
        // Both modules share one database, so both run the SAME upgrade. Two `onupgradeneeded`
        // handlers each creating only what they need is how a store ends up existing on the
        // machine that happened to open one module first, and nowhere else.
        request.onupgradeneeded = () => upgrade(request.result);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        // A blocked upgrade means another tab holds the old version. Rather than hang, give up:
        // the tuning session must not wait on storage.
        request.onblocked = () => resolve(null);
    });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    return new Promise(resolve => {
        try {
            const transaction = db.transaction(STORE, mode);
            const request = run(transaction.objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            transaction.onabort = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

/**
 * Save, or delete the record when the set is empty.
 *
 * Deleting rather than storing an empty set matters: a stale empty record and "no record" would
 * behave the same on load but differ in the listing, and two representations of one fact is the
 * bug this whole layer was built to remove.
 */
export async function saveEdits(sha256: string, edits: EditSet): Promise<void> {
    const db = await open();
    if (!db) return;
    if (edits.size === 0) {
        await tx(db, 'readwrite', store => store.delete(sha256) as unknown as IDBRequest<undefined>);
    } else {
        const record: StoredRecord = {
            sha256,
            savedAt: Date.now(),
            // Structured-cloneable only: plain arrays, no Map, no typed arrays.
            entries: [...edits.values()].map(e => ({
                uniqueId: e.uniqueId, title: e.title,
                raw: [...e.raw], baseRaw: [...e.baseRaw], rows: e.rows, cols: e.cols,
            })),
        };
        await tx(db, 'readwrite', store => store.put(record) as unknown as IDBRequest<IDBValidKey>);
    }
    db.close();
}

/**
 * Load a saved set. The caller MUST `rebase` it against the bytes actually loaded.
 *
 * This function deliberately does not rebase for you: it has no definition and no image, and a
 * layer that guessed at either would be the place a stale edit slips back in.
 */
export async function loadEdits(sha256: string): Promise<EditEntry[] | null> {
    const db = await open();
    if (!db) return null;
    const record = await tx<StoredRecord>(db, 'readonly', store => store.get(sha256));
    db.close();
    if (!record || !Array.isArray(record.entries)) return null;
    // Shape-check rather than trust: this came out of storage a previous build wrote.
    const ok = record.entries.every(e =>
        typeof e?.uniqueId === 'string' && Array.isArray(e.raw) && Array.isArray(e.baseRaw)
        && e.raw.length === e.baseRaw.length && Number.isInteger(e.rows) && Number.isInteger(e.cols));
    return ok ? record.entries : null;
}

/** Forget one image's edits. */
export async function clearEdits(sha256: string): Promise<void> {
    const db = await open();
    if (!db) return;
    await tx(db, 'readwrite', store => store.delete(sha256) as unknown as IDBRequest<undefined>);
    db.close();
}
