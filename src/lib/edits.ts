/**
 * The edit set: what will change, and nothing else.
 *
 * ## Why this replaces `workspace.edits`
 *
 * The old shape was a `Map<'itemId:row:col', number>` of ORIGINAL PHYSICAL values, sitting beside
 * a mutated `edited` buffer. Two representations of one fact with nothing keeping them in step,
 * and the comparison that decided whether a cell had changed was a float comparison — so "the
 * user typed the value it already had" and "the user typed something one LSB away" were the same
 * event. The count meant nothing, the diff was never rendered, and a reload lost all of it.
 *
 * ## The rule that makes the count mean something
 *
 * Entries are RAW, and an entry whose raw run equals its base is DROPPED. So:
 *
 *   - the set is exactly "what will differ from the loaded bytes"
 *   - an empty set means an export carries nothing
 *   - typing a value back to what it was removes the edit rather than recording a no-op
 *   - `+d` then `-d` cancels exactly, because raw integers cancel exactly and physical floats do not
 *
 * ## No undo stack, deliberately
 *
 * The two recovery targets that matter are always present: the loaded bytes (base) and the
 * factory data. Revert-cell, revert-item and revert-all reach both. A stack that survived a
 * reload would be the stale-state bug this file exists to remove.
 */

import {
    type XdfDefinition,
    type XdfItem,
    encodeRun,
    offsetsOf,
    readRun,
    runTargetOf,
} from '@tsunagi/xdf-engine';

export interface EditEntry {
    readonly uniqueId: string;
    readonly title: string;
    /** The raw run that will be written. Row-major, one element per cell. */
    readonly raw: readonly number[];
    /** The raw run the loaded image holds. Kept so a revert needs no second read. */
    readonly baseRaw: readonly number[];
    readonly rows: number;
    readonly cols: number;
}

/** Keyed by `uniqueId` — titles repeat three times in this definition and indices shift. */
export type EditSet = ReadonlyMap<string, EditEntry>;

export const EMPTY_EDITS: EditSet = new Map();

function sameRun(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

function shapeOf(item: XdfItem): { rows: number; cols: number } {
    const { data } = runTargetOf(item);
    return item.kind === 'constant'
        ? { rows: 1, cols: 1 }
        : { rows: Math.max(1, data.rows), cols: Math.max(1, data.cols) };
}

/**
 * Put a whole raw run into the set, or drop the entry if it matches base.
 *
 * The single mutation point. Every other function here reduces to this one, so the
 * self-cancelling rule cannot be bypassed by a caller that forgot about it.
 */
export function withRun(
    edits: EditSet, def: XdfDefinition, base: Uint8Array, item: XdfItem, raw: readonly number[],
): EditSet {
    const baseRaw = readRun(def, base, item);
    if (raw.length !== baseRaw.length) {
        throw new Error(`"${item.title}" holds ${baseRaw.length} element(s) and ${raw.length} were given`);
    }
    const next = new Map(edits);
    if (sameRun(raw, baseRaw)) {
        next.delete(item.uniqueId);
        return next;
    }
    const { rows, cols } = shapeOf(item);
    next.set(item.uniqueId, {
        uniqueId: item.uniqueId, title: item.title, raw: [...raw], baseRaw, rows, cols,
    });
    return next;
}

/** The raw run currently in force: the edit if there is one, otherwise the loaded bytes. */
export function currentRun(
    edits: EditSet, def: XdfDefinition, base: Uint8Array, item: XdfItem,
): number[] {
    const entry = edits.get(item.uniqueId);
    return entry ? [...entry.raw] : readRun(def, base, item);
}

/** Set one cell by its raw value. */
export function withCell(
    edits: EditSet, def: XdfDefinition, base: Uint8Array, item: XdfItem,
    row: number, col: number, raw: number,
): EditSet {
    const run = currentRun(edits, def, base, item);
    const { cols } = shapeOf(item);
    const index = row * cols + col;
    if (index < 0 || index >= run.length) {
        throw new Error(`cell (${row}, ${col}) is outside "${item.title}"`);
    }
    run[index] = raw;
    return withRun(edits, def, base, item, run);
}

/** Put one cell back to what the loaded image holds. */
export function withCellReverted(
    edits: EditSet, def: XdfDefinition, base: Uint8Array, item: XdfItem, row: number, col: number,
): EditSet {
    const baseRaw = readRun(def, base, item);
    const { cols } = shapeOf(item);
    return withCell(edits, def, base, item, row, col, baseRaw[row * cols + col]);
}

/** Drop every edit to one item. */
export function withoutItem(edits: EditSet, uniqueId: string): EditSet {
    const next = new Map(edits);
    next.delete(uniqueId);
    return next;
}

/**
 * Apply a function to a chosen subset of cells.
 *
 * `indices` is the caller's to state. A bulk edit that reached cells off the screen would be the
 * most expensive kind of surprise, so this function never decides the scope for itself.
 */
export function withBulk(
    edits: EditSet, def: XdfDefinition, base: Uint8Array, item: XdfItem,
    indices: readonly number[], transform: (raw: number, index: number) => number,
): EditSet {
    const run = currentRun(edits, def, base, item);
    for (const i of indices) {
        if (i < 0 || i >= run.length) throw new Error(`index ${i} is outside "${item.title}"`);
        run[i] = transform(run[i], i);
    }
    return withRun(edits, def, base, item, run);
}

/**
 * Copy a run in from a reference image — the factory data, or another program's rows.
 *
 * RAW, never physical. Both buffers decode through the same definition, so a physical round trip
 * could shift a cell by one LSB for no reason at all.
 */
export function withRunFrom(
    edits: EditSet, def: XdfDefinition, base: Uint8Array, reference: Uint8Array, item: XdfItem,
): EditSet {
    return withRun(edits, def, base, item, readRun(def, reference, item));
}

/** The image an export would produce. `base` is never mutated. */
export function applyEdits(def: XdfDefinition, base: Uint8Array, edits: EditSet, items: readonly XdfItem[]): Uint8Array {
    const out = Uint8Array.from(base);
    const byId = new Map(items.map(i => [i.uniqueId, i]));
    for (const entry of edits.values()) {
        const item = byId.get(entry.uniqueId);
        // An edit whose item is gone is dropped rather than guessed at: the definition changed
        // under us and there is no honest place to put those bytes.
        if (item) encodeRun(def, out, item, entry.raw);
    }
    return out;
}

export interface ChangedCell {
    readonly index: number;
    readonly row: number;
    readonly col: number;
    readonly baseRaw: number;
    readonly raw: number;
}

/** Which cells of one entry differ, with their positions. */
export function changedCells(entry: EditEntry): ChangedCell[] {
    const out: ChangedCell[] = [];
    for (let i = 0; i < entry.raw.length; i++) {
        if (entry.raw[i] === entry.baseRaw[i]) continue;
        out.push({
            index: i, row: Math.floor(i / entry.cols), col: i % entry.cols,
            baseRaw: entry.baseRaw[i], raw: entry.raw[i],
        });
    }
    return out;
}

/** Total cells that will change across the whole set. */
export function changedCellCount(edits: EditSet): number {
    let n = 0;
    for (const entry of edits.values()) n += changedCells(entry).length;
    return n;
}

/**
 * Every byte an export is PERMITTED to differ in — the full width of every changed cell.
 *
 * A superset of what actually changes, and deliberately so: raising a 16-bit cell by 16 moves
 * only its low byte, and which half moved is incidental. The property worth protecting is the
 * other direction — **no byte outside this set may differ** — because that is what catches an
 * edit reaching bytes nothing named, which a recomputed CRC would otherwise make look correct.
 *
 * Computed from the edit set rather than by diffing the two images, so the prediction and the
 * observation are independent and can be checked against each other.
 */
export function editedSpanOffsets(
    def: XdfDefinition, edits: EditSet, items: readonly XdfItem[],
): number[] {
    const byId = new Map(items.map(i => [i.uniqueId, i]));
    const out = new Set<number>();
    for (const entry of edits.values()) {
        const item = byId.get(entry.uniqueId);
        if (!item) continue;
        const width = runTargetOf(item).data.bits / 8;
        const offsets = offsetsOf(def, item);
        for (const cell of changedCells(entry)) {
            for (let b = 0; b < width; b++) out.add(offsets[cell.index] + b);
        }
    }
    return [...out].sort((a, b) => a - b);
}

/**
 * Re-arm a restored edit set against the bytes now loaded.
 *
 * Any edit whose raw already matches the current image is dropped — that change has landed, so
 * carrying it would claim a pending edit that would write nothing. Any edit whose item is gone is
 * dropped for the same reason `applyEdits` skips it.
 */
export function rebase(
    edits: EditSet, def: XdfDefinition, base: Uint8Array, items: readonly XdfItem[],
): EditSet {
    const byId = new Map(items.map(i => [i.uniqueId, i]));
    let next: EditSet = EMPTY_EDITS;
    for (const entry of edits.values()) {
        const item = byId.get(entry.uniqueId);
        if (!item) continue;
        try {
            next = withRun(next, def, base, item, entry.raw);
        } catch {
            // Shape changed under the edit. Dropping is the only honest option.
        }
    }
    return next;
}
