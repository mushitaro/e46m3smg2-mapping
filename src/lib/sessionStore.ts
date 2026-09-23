/**
 * Every image this tool has held, kept.
 *
 * ## Why the app needed this
 *
 * A read off the car is eighteen minutes and one chance. Until now the tool held exactly one
 * image — the current one — and CLEAR threw it away. So the ordinary act of opening a factory
 * file to compare against, or reading the window a second time to check something, destroyed the
 * previous read. The bytes survived only if the operator had remembered to press EXPORT, in a
 * workflow where the reason to press EXPORT is usually that you are finished.
 *
 * The reference tuner's SESSIONS list solves this by making the record, not the buffer, the thing
 * the app is about: every read becomes a numbered session that stays until it is deleted. This is
 * that, for images.
 *
 * ## What a session is, and what it is not
 *
 * A session is **bytes plus how they were obtained**. It is not a snapshot of edits — those live
 * in `editStore`, keyed by the same SHA-256, and follow the bytes rather than the session. So
 * reopening session #3 gets the edits back because they were attached to the image all along, and
 * two sessions that read the same ECU twice and got identical bytes share one edit set, which is
 * correct: they are the same calibration.
 *
 * `seq` is never reused. Deleting #2 must not renumber #3, because the number is what an operator
 * writes on a sticky note next to the car.
 *
 * Everything here is best-effort, exactly like `editStore`: IndexedDB is refused in private
 * windows and by some Android WebViews, and a tool that cannot open its own storage must still
 * let you read an ECU. Nothing in this file throws at the caller.
 */

import type { ImageOrigin } from './workspace';
import type { DefinitionVariant } from './definitions';

const DB_NAME = 'smg2-drivelogic';
/**
 * Bumped from 1 to add the two stores below.
 *
 * `editStore` opens the same database, so both modules must agree on the version. They do it by
 * both calling `upgrade()` here rather than by each creating what it happens to need — two
 * modules running different `onupgradeneeded` handlers against one database is how a store ends
 * up existing on the machine that created it and nowhere else.
 */
export const DB_VERSION = 2;
export const EDITS_STORE = 'edits';
const SESSIONS_STORE = 'sessions';
const BINARIES_STORE = 'binaries';

export interface SessionRecord {
    readonly id: string;
    /** Stable, human-sized, never reused. What an operator writes down. */
    readonly seq: number;
    readonly createdAt: number;
    readonly label: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly origin: ImageOrigin;
    readonly variant: DefinitionVariant | null;
    /** The ZB found in the image, when the image was long enough to carry one. */
    readonly zb: string | null;
    /** Verdict at the time of capture. `null` when no definition applied. */
    readonly checksumOk: boolean | null;
    /** True for invented bytes. Kept on the record so a badge cannot be lost. */
    readonly practice: boolean;
}

/** The bytes, stored apart so the listing can be read without loading megabytes. */
interface BinaryRecord {
    readonly sha256: string;
    readonly bytes: ArrayBuffer;
}

export function upgrade(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(EDITS_STORE)) db.createObjectStore(EDITS_STORE, { keyPath: 'sha256' });
    if (!db.objectStoreNames.contains(SESSIONS_STORE)) db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(BINARIES_STORE)) db.createObjectStore(BINARIES_STORE, { keyPath: 'sha256' });
}

export function open(): Promise<IDBDatabase | null> {
    return new Promise(resolve => {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null); return;
        }
        request.onupgradeneeded = () => upgrade(request.result);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
    });
}

function run<T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => IDBRequest<T>): Promise<T | null> {
    return new Promise(resolve => {
        try {
            const tx = db.transaction(stores, mode);
            const request = body(tx);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            tx.onabort = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

export async function listSessions(): Promise<SessionRecord[]> {
    const db = await open();
    if (!db) return [];
    const all = await run<SessionRecord[]>(db, SESSIONS_STORE, 'readonly', tx => tx.objectStore(SESSIONS_STORE).getAll());
    db.close();
    if (!Array.isArray(all)) return [];
    return all
        .filter(s => typeof s?.id === 'string' && typeof s.sha256 === 'string' && Number.isInteger(s.seq))
        .sort((a, b) => b.seq - a.seq);
}

/**
 * Record an image, or update the one that already holds these bytes.
 *
 * Keyed on SHA-256 rather than on the moment of loading: reading the same ECU twice and getting
 * identical bytes is one calibration, and two rows claiming otherwise would put the operator in
 * front of a choice that has no content. The existing row's `createdAt` and `seq` are kept, so
 * the number stays where it was written down.
 */
export async function recordSession(
    input: Omit<SessionRecord, 'id' | 'seq' | 'createdAt' | 'label'> & { label?: string },
    bytes: Uint8Array,
): Promise<SessionRecord | null> {
    const db = await open();
    if (!db) return null;
    const existing = await run<SessionRecord[]>(db, SESSIONS_STORE, 'readonly', tx => tx.objectStore(SESSIONS_STORE).getAll());
    const rows = Array.isArray(existing) ? existing : [];
    const already = rows.find(s => s.sha256 === input.sha256);
    const seq = already?.seq ?? rows.reduce((max, s) => Math.max(max, s.seq ?? 0), 0) + 1;
    const record: SessionRecord = {
        id: already?.id ?? crypto.randomUUID(),
        seq,
        createdAt: already?.createdAt ?? Date.now(),
        label: input.label ?? already?.label ?? `#${seq}`,
        ...input,
    };
    const copy = bytes.slice();
    await run(db, [SESSIONS_STORE, BINARIES_STORE], 'readwrite', tx => {
        tx.objectStore(BINARIES_STORE).put({ sha256: record.sha256, bytes: copy.buffer } satisfies BinaryRecord);
        return tx.objectStore(SESSIONS_STORE).put(record) as unknown as IDBRequest<IDBValidKey>;
    });
    db.close();
    return record;
}

export async function loadSessionBytes(sha256: string): Promise<Uint8Array | null> {
    const db = await open();
    if (!db) return null;
    const record = await run<BinaryRecord>(db, BINARIES_STORE, 'readonly', tx => tx.objectStore(BINARIES_STORE).get(sha256));
    db.close();
    if (!record || !(record.bytes instanceof ArrayBuffer)) return null;
    return new Uint8Array(record.bytes);
}

/**
 * Delete one session, its bytes and its edits.
 *
 * The bytes go only if no other session references them — two reads of the same ECU share one
 * binary, and deleting one must not empty the other.
 */
export async function deleteSession(id: string): Promise<void> {
    const db = await open();
    if (!db) return;
    const all = await run<SessionRecord[]>(db, SESSIONS_STORE, 'readonly', tx => tx.objectStore(SESSIONS_STORE).getAll());
    const rows = Array.isArray(all) ? all : [];
    const target = rows.find(s => s.id === id);
    const orphaned = !!target && rows.filter(s => s.sha256 === target.sha256).length === 1;
    await run(db, [SESSIONS_STORE, BINARIES_STORE, EDITS_STORE], 'readwrite', tx => {
        if (orphaned && target) {
            tx.objectStore(BINARIES_STORE).delete(target.sha256);
            tx.objectStore(EDITS_STORE).delete(target.sha256);
        }
        return tx.objectStore(SESSIONS_STORE).delete(id) as unknown as IDBRequest<undefined>;
    });
    db.close();
}

export async function renameSession(id: string, label: string): Promise<void> {
    const db = await open();
    if (!db) return;
    const record = await run<SessionRecord>(db, SESSIONS_STORE, 'readonly', tx => tx.objectStore(SESSIONS_STORE).get(id));
    if (record) {
        await run(db, SESSIONS_STORE, 'readwrite', tx =>
            tx.objectStore(SESSIONS_STORE).put({ ...record, label: label.slice(0, 60) }) as unknown as IDBRequest<IDBValidKey>);
    }
    db.close();
}
