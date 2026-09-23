/**
 * Turning a cloud copy back into a session on this device.
 *
 * A saved row carries the ORIGINAL image and the edits as changed CELLS (`sync.ts` → `editsJson`:
 * which item, which cell, from what raw value, to what). The local store keeps edits as whole raw
 * runs (`editStore`), so restoring means replaying each cell onto the image through `withCell` —
 * the same path a tap on the grid takes — rather than trusting a stored run. That keeps the one
 * invariant the edit set is built on: every edit is relative to the bytes actually loaded.
 *
 * A cell whose `from` does not match the image is skipped and counted, not applied. The row's
 * image is checked against its hash before this runs, so that should not happen; if it does, the
 * edit was made against different bytes, and replaying it would be writing a guess.
 */

import { readRun, type XdfDefinition } from '@tsunagi/xdf-engine';

import { shapeOf } from './calibration/run';
import { EMPTY_EDITS, withCell, type EditSet } from './edits';

export interface SharedEdit {
    readonly id: string;
    readonly title?: string;
    readonly cells: readonly { readonly row: number; readonly col: number; readonly from: number; readonly to: number }[];
}

/** Parse `edits_json` defensively: it came from storage a different build may have written. */
export function parseSharedEdits(json: string | null): SharedEdit[] {
    if (!json) return [];
    try {
        const value = JSON.parse(json) as unknown;
        if (!Array.isArray(value)) return [];
        return value.filter((e): e is SharedEdit =>
            typeof e?.id === 'string' && Array.isArray(e.cells)
            && e.cells.every((c: unknown) => {
                const cell = c as Record<string, unknown>;
                return [cell.row, cell.col, cell.from, cell.to].every(Number.isInteger);
            }));
    } catch {
        return [];
    }
}

export function editsFromShared(
    def: XdfDefinition,
    image: Uint8Array,
    shared: readonly SharedEdit[],
): { edits: EditSet; applied: number; skipped: number } {
    let edits = EMPTY_EDITS;
    let applied = 0;
    let skipped = 0;
    for (const entry of shared) {
        const item = def.items.find(i => i.uniqueId === entry.id);
        if (!item) { skipped += entry.cells.length; continue; }
        let base: number[];
        try {
            base = readRun(def, image, item);
        } catch {
            skipped += entry.cells.length;
            continue;
        }
        const { cols } = shapeOf(item);
        for (const cell of entry.cells) {
            if (base[cell.row * cols + cell.col] !== cell.from) { skipped++; continue; }
            try {
                edits = withCell(edits, def, image, item, cell.row, cell.col, cell.to);
                applied++;
            } catch {
                skipped++;
            }
        }
    }
    return { edits, applied, skipped };
}
