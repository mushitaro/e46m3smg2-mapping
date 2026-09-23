/**
 * Handing an extraction up to D1.
 *
 * The point of this path is that a phone in a garage can produce a 24 KiB calibration and have it
 * land somewhere it can be analysed, without a cable to a laptop, an email attachment, or a file
 * manager. What gets uploaded is the image plus everything needed to judge it later: how it was
 * read, how the read went, which car it came from, and whether it was verified.
 *
 * **Practice rows are marked at the source.** A simulated read produces plausible bytes; a row that
 * does not say so is indistinguishable from a real dump once the session is closed. The flag rides
 * with the payload rather than being inferred at the far end.
 */

import type { Workspace } from './workspace';
import { changedCells } from './edits';
import { APP_VERSION } from './version';

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
    id: string;
    /** Bytes actually sent, so a slow upload on a phone can be reported as a size and not a mood. */
    uploadedBytes: number;
    error?: string;
}

export function isSyncConfigured(): boolean {
    // With no token and no base this still works against a same-origin Pages deployment, which is
    // the normal case. The check is for whether a sync UI should be offered at all, and it should:
    // the deployment supplies the endpoint.
    return typeof fetch !== 'undefined';
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

/** Inverse of `gzipToBase64`, for anything that reads a row back in the browser. */
export async function base64ToUngzipped(b64: string): Promise<Uint8Array> {
    const binary = atob(b64);
    const packed = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) packed[i] = binary.charCodeAt(i);
    const stream = new Blob([packed.buffer as ArrayBuffer]).stream()
        .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
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
        id: crypto.randomUUID(),
        createdAt: workspace.loadedAt,
        label: extras.label,
        transport: extras.transport,
        practice: origin.kind === 'practice',
        appBuild: APP_VERSION,
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

export async function uploadExtraction(payload: SyncPayload): Promise<SyncResult> {
    const body = JSON.stringify(payload);
    try {
        // Same origin, carrying the session cookie the gate set. No token: the owner is whoever
        // the gate says this browser is.
        const response = await fetch('/api/extractions', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body,
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            return {
                ok: false,
                id: payload.id,
                uploadedBytes: body.length,
                error: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
            };
        }
        return { ok: true, id: payload.id, uploadedBytes: body.length };
    } catch (error) {
        // A phone in a garage is the normal place for this to fail. Say that it was the network and
        // that the bytes are still here, rather than implying the read was lost.
        return {
            ok: false,
            id: payload.id,
            uploadedBytes: body.length,
            error: `${(error as Error).message} — the extraction is still loaded; export it or retry.`,
        };
    }
}
