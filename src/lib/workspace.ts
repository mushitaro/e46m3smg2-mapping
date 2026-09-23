/**
 * The workspace: one image, where it came from, and what has been done to it.
 *
 * Provenance is captured at the moment the bytes arrive, not reconstructed later. That matters
 * even though this tool cannot write to the ECU — the day a write path exists, the only thing
 * that can prove "this edit was derived from THAT car's calibration" is a hash taken now.
 */

import { IDENTITY_ANCHORS, type ProbeCandidate, type ReadResult } from '@tsunagi/ds2-smg2';
import type { DefinitionVariant } from './definitions';
import { EMPTY_EDITS, type EditSet, changedCellCount } from './edits';

export type ImageOrigin =
    /** Read from a vehicle over DS2. */
    | { kind: 'vehicle'; addressSpace: ProbeCandidate; read: ReadResult; identity: VehicleIdentity | null }
    /** Read from the simulated device. Invented bytes; never to be confused with a dump. */
    | { kind: 'practice'; read: ReadResult }
    /** Opened from disk. */
    | { kind: 'file'; fileName: string; lastModified: number };

export interface VehicleIdentity {
    readonly zbNumber: string | null;
    readonly rawManufacturerData: string;
}

export interface Workspace {
    /**
     * The bytes as loaded. Never mutated — this is what the car gave us, and it is the only
     * thing that can prove an edit derived from THIS ECU.
     */
    readonly original: Uint8Array;
    /**
     * Which definition describes these bytes, or `null` when none does.
     *
     * `null` is a RAW CAPTURE: bytes that came off the ECU at a length neither MS4X file is
     * written for — in practice, a full-image read that died partway. It cannot be opened against
     * the definition, because applying a definition to a length it was not written for puts every
     * address somewhere it was not meant to point. It can still be exported and shared, which is
     * the whole reason it is kept: an eighteen-minute read that failed at 90% is still 460 KiB of
     * program area, and discarding it because the last telegram timed out wastes the session.
     */
    readonly variant: DefinitionVariant | null;
    readonly origin: ImageOrigin;
    readonly sha256: string;
    readonly loadedAt: number;
    /**
     * What will change, as raw runs keyed by `uniqueId`.
     *
     * There is deliberately no `edited` buffer beside this. The two used to coexist and nothing
     * kept them in step — a buffer that had been written and a map of original physical values,
     * either of which could be updated without the other. The edited image is DERIVED, by
     * `applyEdits`, so the question "what does an export contain" has exactly one answer.
     */
    readonly edits: EditSet;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    // `crypto.subtle` is available in every context this app runs in (localhost and https are
    // both secure contexts, and Web Serial requires one anyway).
    const view = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes
        : bytes.slice();
    const digest = await crypto.subtle.digest('SHA-256', view.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createWorkspace(
    bytes: Uint8Array,
    variant: DefinitionVariant | null,
    origin: ImageOrigin,
): Promise<Workspace> {
    const original = Uint8Array.from(bytes);
    return {
        original,
        variant,
        origin,
        sha256: await sha256Hex(original),
        loadedAt: Date.now(),
        edits: EMPTY_EDITS,
    };
}

export function isPractice(workspace: Workspace | null): boolean {
    return workspace?.origin.kind === 'practice';
}

export function isDirty(workspace: Workspace | null): boolean {
    return (workspace?.edits.size ?? 0) > 0;
}

/** Cells that will change, across every item. The number the reader is shown. */
export function editedCellCount(workspace: Workspace | null): number {
    return workspace ? changedCellCount(workspace.edits) : 0;
}

/**
 * The export filename.
 *
 * Three things are always in it and none of them are decoration:
 *
 *   - PRACTICE, when the bytes are invented. Six months from now the folder is all the context
 *     there is.
 *   - the checksum state: CRCOK when the calibration CRC-16 was recomputed and written, CRCBAD
 *     when the stored word does not match and could not be fixed, NOCRC when this image does not
 *     carry the descriptor at all (a raw capture, or a window that stops short of it).
 *   - the source hash prefix, so an export can be traced to the read it came from.
 *
 * A label is a promise, and CRCOK promises exactly one thing: the file is internally consistent
 * by the ECU's own rule. It does NOT promise the file can be flashed. Nothing in this build can
 * write to an ECU, and no file this tool has produced has ever been put on one.
 */
export type ChecksumTag = 'CRCOK' | 'CRCBAD' | 'NOCRC';

export function exportFileName(
    workspace: Workspace,
    stamp: Date,
    checksumTag: ChecksumTag = 'NOCRC',
): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const when = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
        `${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
    // RAW says the length matches no definition, and the byte count says which length it was.
    // Both are in the name because six months from now the folder is all the context there is.
    const scope = workspace.variant === 'partial-24k' ? 'PARTIAL24K'
        : workspace.variant === 'full-512k' ? 'FULL512K'
            : `RAW${workspace.original.length}B`;
    const parts = [
        'SMG2_510',
        scope,
        when,
        workspace.sha256.slice(0, 8),
        checksumTag,
    ];
    if (isPractice(workspace)) parts.unshift('PRACTICE');
    return `${parts.join('_')}.bin`;
}

export function describeOrigin(origin: ImageOrigin): string {
    switch (origin.kind) {
        case 'vehicle':
            return `vehicle, segment 0x${origin.addressSpace.segment.toString(16).padStart(2, '0')} ` +
                `base 0x${origin.addressSpace.baseAddress.toString(16)}`;
        case 'practice':
            return 'practice device (invented bytes)';
        case 'file':
            return origin.fileName;
    }
}

/**
 * The ZB this image states about itself.
 *
 * `ImageOrigin` carries an identity only when the bytes came off a car — a file opened from disk
 * has no `VehicleIdentity` even though the bytes it holds contain the same block the ECU would
 * have reported. Deriving it from the image instead means the flash preflight can check "did
 * these bytes come from this ECU" for a file the operator exported yesterday, which is exactly
 * the case the check exists for.
 *
 * ## Why the offset is used and not a search
 *
 * §4.1 places the ZB at `0x2FF94`, six times. The block as it actually reads is:
 *
 *     0510 7843260 7843260 7843260 7843260 7843260 7843260 --+
 *
 * — one contiguous run of digits with the tail of the previous string in front of it. Scanning
 * that for seven digits finds `0510784` first, and every other phase (`3260784`, `2607843`, …)
 * is equally well-formed. A search cannot tell them apart, because there is nothing to tell
 * apart: the answer is a fact about **where**, not about shape.
 *
 * So the offset supplies the candidate and the repetitions verify it. Two matching copies are
 * required, which is what makes a marginal read still decisive and a single stray number not.
 */
export function zbFromImage(image: Uint8Array): string | null {
    const at = 0x2ff94;
    const block = IDENTITY_ANCHORS.zbBlock;
    if (image.length < block.address + block.length) return null;
    const text = (from: number, length: number) =>
        Array.from(image.slice(from, from + length))
            .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' '))
            .join('');

    const surrounding = text(block.address, block.length);
    const copiesOf = (value: string) => {
        let n = 0;
        for (let i = 0; i + value.length <= surrounding.length; i++) {
            if (surrounding.startsWith(value, i)) n++;
        }
        return n;
    };

    const atAnchor = text(at, 7);
    if (/^\d{7}$/.test(atAnchor) && copiesOf(atAnchor) >= 2) return atAnchor;

    // The copy at the anchor is damaged. Six repetitions exist so that this is survivable, so
    // fall back to counting: the true value occurs once per repetition and every rival phase
    // occurs once less, because a phase cannot wrap past the end of the run. That one-count
    // margin is thin, so it is required to be strict — a tie means the block is not periodic and
    // nothing here knows what it holds.
    const counts = new Map<string, number>();
    for (let i = 0; i + 7 <= surrounding.length; i++) {
        const window = surrounding.slice(i, i + 7);
        if (/^\d{7}$/.test(window)) counts.set(window, (counts.get(window) ?? 0) + 1);
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    const [best, runnerUp] = ranked;
    if (!best || best[1] < 2) return null;
    if (runnerUp && runnerUp[1] === best[1]) return null;
    return best[0];
}
