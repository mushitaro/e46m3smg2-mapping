/**
 * SYNC: a session's cloud copy, in the owner's own account.
 *
 * The point of this path is that a phone in a garage can produce a calibration and have it kept
 * somewhere it survives the phone, and open it again on a laptop — without a cable, an email
 * attachment or a file manager. What is saved is the image as it came off the car plus everything
 * needed to judge it later (how it was read, how the read went, which car, whether it was
 * verified) and the edits made to it since.
 *
 * **Whose it is.** Requests are same-origin and carry the session cookie the owner gate set when
 * the owner arrived from m3; the server files every row under that account and shows each owner
 * only their own. There is no token and nothing to configure (`owner-sync.ts`).
 *
 * **Preview only.** Production is local-only and its privacy text says so: every function here
 * that makes a request returns without one unless `isPreviewBuild()`.
 *
 * **Practice rows are marked at the source.** A simulated read produces plausible bytes; a row that
 * does not say so is indistinguishable from a real dump once the session is closed. The flag rides
 * with the payload rather than being inferred at the far end.
 */

import type { Workspace } from './workspace';
import { changedCells } from './edits';
import { api, gunzipB64, isPreviewBuild } from './owner-sync';
import { APP_VERSION, BUILD_ID } from './version';

/** Which build wrote a row: the hand-bumped version and the source hash the page runs. */
export const APP_BUILD = `${APP_VERSION} ${BUILD_ID}`;

export interface SyncPayload {
    id: string;
    createdAt: number;
    label: string | null;
    transport: string;
    practice: boolean;
    appBuild: string;
    variant: string;
    byteLength: number;
    sha256: string;
    segment: number | null;
    baseAddress: number | null;
    zbNumber: string | null;
    manufacturerData: string | null;
    checksumStored: number | null;
    chunkSize: number | null;
    exchanges: number | null;
    retries: number | null;
    elapsedMs: number | null;
    verifiedReread: boolean | null;
    imageGzB64: string;
    editsJson: string | null;
    logText: string | null;
}

export interface SyncResult {
    ok: boolean;
    /** The row's id in the cloud — the one the server kept, which for a re-save is the first one. */
    id: string;
    /** Bytes actually sent, so a slow upload on a phone can be reported as a size and not a mood. */
    uploadedBytes: number;
    /** 401: the preview session lapsed. The work is still here; signing in again is offered. */
    expired?: boolean;
    /** 413: more than a row can hold. */
    tooLarge?: boolean;
    /** No request reached the server — offline, or not a preview build. */
    notSent?: boolean;
    error?: string;
}

/** gzip, because a 24 KiB calibration is mostly structure and compresses to a fraction of itself. */
export async function gzipToBase64(bytes: Uint8Array): Promise<string> {
    if (typeof CompressionStream === 'undefined') {
        throw new Error(
            'This browser has no CompressionStream, so the image cannot be compressed for upload. ' +
            'Export the .bin instead — the bytes are the same either way.');
    }
    const source = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer]);
    const compressed = source.stream().pipeThrough(new CompressionStream('gzip'));
    const buffer = new Uint8Array(await new Response(compressed).arrayBuffer());

    // Chunked so a large image does not blow the argument limit on String.fromCharCode.
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < buffer.length; i += CHUNK) {
        binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/**
 * The 16-bit checksum the SMG2 stores at XDF `0x32080`.
 *
 * Pulled out as a column because identifying the algorithm needs this value across many images,
 * and a query beats a download-and-decode loop. Little-endian, like every other 16-bit value in
 * this ECU — see `@tsunagi/xdf-engine`'s note on `mmedtypeflags`.
 */
export const CHECKSUM_XDF_ADDRESS = 0x32080;

export function readStoredChecksum(image: Uint8Array, fileOffsetOfChecksum: number): number | null {
    if (fileOffsetOfChecksum < 0 || fileOffsetOfChecksum + 2 > image.length) return null;
    return image[fileOffsetOfChecksum] | (image[fileOffsetOfChecksum + 1] << 8);
}

export async function buildPayload(
    workspace: Workspace,
    extras: {
        label: string | null;
        checksumStored: number | null;
        zbNumber: string | null;
        manufacturerData: string | null;
        logText: string | null;
        /**
         * Whether the range was read twice and the two passes agreed.
         *
         * `null` means nobody checked — which is a different claim from "checked and matched", and
         * the column keeps them apart. A row that does not distinguish the two would let an
         * unverified dump be treated as a verified one later, which is exactly the confusion the
         * two-pass read exists to prevent.
         */
        verifiedReread: boolean | null;
        /**
         * The session this is the cloud copy of. The local session id, so saving the same session
         * again updates its row instead of adding one.
         */
        id: string;
        /**
         * Which route the bytes came in over: 'serial', 'usb', 'practice' or 'file'.
         *
         * The workspace's own origin cannot answer this — it only knows "vehicle" — and the
         * difference is the point of the column: a row that says `usb` is the evidence that a
         * phone read this ECU, and comparing read timings between the two routes needs them
         * told apart rather than merged into "some cable".
         */
        transport: string;
    },
): Promise<SyncPayload> {
    const origin = workspace.origin;
    const read = origin.kind === 'vehicle' || origin.kind === 'practice' ? origin.read : null;

    return {
        // An opaque id, not the image hash. The hash is the same for every stock car, so as an id
        // it made two owners' identical calibrations collide; the server keeps one row per owner
        // per image instead (UNIQUE(owner, sha256)), so a retry still cannot duplicate a row.
        id: extras.id,
        createdAt: workspace.loadedAt,
        label: extras.label,
        transport: extras.transport,
        practice: origin.kind === 'practice',
        appBuild: APP_BUILD,
        // 'raw' when no definition is written for this length — a full read that died partway.
        // The column keeps it apart from a complete image so a query for full dumps does not
        // silently include truncated ones.
        variant: workspace.variant ?? 'raw',
        byteLength: workspace.original.length,
        sha256: workspace.sha256,
        segment: origin.kind === 'vehicle' ? origin.addressSpace.segment : null,
        baseAddress: origin.kind === 'vehicle' ? origin.addressSpace.baseAddress : null,
        zbNumber: extras.zbNumber,
        manufacturerData: extras.manufacturerData,
        checksumStored: extras.checksumStored,
        chunkSize: read?.chunkSize ?? null,
        exchanges: read?.exchanges ?? null,
        retries: read?.retries ?? null,
        elapsedMs: read?.elapsedMs ?? null,
        verifiedReread: extras.verifiedReread,
        // The ORIGINAL bytes, never the edited ones. What is being shared is what the car had; an
        // edit is a local hypothesis and rides along separately in `editsJson`.
        imageGzB64: await gzipToBase64(workspace.original),
        /**
         * The edits as CELLS, not as whole runs.
         *
         * A run carries every element of the item, most of which are unchanged, so serialising it
         * whole would put a 160-cell table in the row to record three changed cells. What matters
         * downstream is which cells moved and from what — in RAW, because that is what the flash
         * holds and it survives a later correction to the scaling.
         */
        editsJson: workspace.edits.size
            ? JSON.stringify([...workspace.edits.values()].map(entry => ({
                id: entry.uniqueId,
                title: entry.title,
                cells: changedCells(entry).map(c => ({
                    row: c.row, col: c.col, from: c.baseRaw, to: c.raw,
                })),
            })))
            : null,
        logText: extras.logText,
    };
}

/** Save (or save again) a session's cloud copy. Never throws; says why when it did not work. */
export async function saveExtraction(payload: SyncPayload): Promise<SyncResult> {
    if (!isPreviewBuild()) return { ok: false, id: payload.id, uploadedBytes: 0, notSent: true };
    const bytes = JSON.stringify(payload).length;
    const result = await api<{ id?: string; error?: string }>('/api/extractions', { method: 'POST', body: payload });
    if (result.ok) return { ok: true, id: result.data?.id ?? payload.id, uploadedBytes: bytes };
    return {
        ok: false,
        id: payload.id,
        uploadedBytes: bytes,
        expired: result.expired,
        tooLarge: result.tooLarge,
        // Status 0 is the network, not the server: a phone in a garage is the normal place for it.
        notSent: result.status === 0,
        error: result.status === 0 ? 'offline' : `HTTP ${result.status}${result.data?.error ? `: ${result.data.error}` : ''}`,
    };
}

/** A row of the owner's cloud list: everything but the bytes. */
export interface CloudSession {
    readonly id: string;
    readonly created_at: number;
    readonly synced_at: number;
    readonly label: string | null;
    readonly transport: string;
    readonly practice: number;
    readonly variant: string;
    readonly byte_length: number;
    readonly sha256: string;
    readonly segment: number | null;
    readonly base_address: number | null;
    readonly zb_number: string | null;
    readonly chunk_size: number | null;
    readonly exchanges: number | null;
    readonly retries: number | null;
    readonly elapsed_ms: number | null;
    readonly verified_reread: number | null;
    readonly has_edits: number;
}

/** One row, bytes included. */
export interface CloudSessionFull extends CloudSession {
    readonly image_gz_b64: string;
    readonly edits_json: string | null;
    readonly log_text: string | null;
}

/** A list, or null when it could not be read — and whether that was because the session lapsed. */
export interface CloudList<T> {
    readonly rows: readonly T[] | null;
    readonly expired: boolean;
}

/** The owner's saved sessions, newest first, practice ones included and marked. */
export async function listCloudSessions(): Promise<CloudList<CloudSession>> {
    if (!isPreviewBuild()) return { rows: null, expired: false };
    const r = await api<{ extractions?: CloudSession[] }>('/api/extractions?practice=1&limit=100');
    return { rows: r.ok ? r.data?.extractions ?? [] : null, expired: r.expired };
}

export async function fetchCloudSession(id: string): Promise<{ row: CloudSessionFull | null; expired: boolean }> {
    if (!isPreviewBuild()) return { row: null, expired: false };
    const r = await api<{ extraction?: CloudSessionFull }>(`/api/extractions/${encodeURIComponent(id)}`);
    return { row: r.ok ? r.data?.extraction ?? null : null, expired: r.expired };
}

export async function deleteCloudSession(id: string): Promise<{ ok: boolean; expired: boolean }> {
    if (!isPreviewBuild()) return { ok: false, expired: false };
    const r = await api(`/api/extractions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { ok: r.ok, expired: r.expired };
}

/** The image a cloud row carries. The caller checks it hashes to the row's `sha256`. */
export function imageOf(row: CloudSessionFull): Promise<Uint8Array> {
    return gunzipB64(row.image_gz_b64);
}
