/**
 * Which two images are being compared, and which items differ between them.
 *
 * The reference tuner's `CalVariant` is `'tuned' | 'base' | 'stock' | 'db:<id>'`. Here the same
 * three roles exist — TUNED is the loaded image with this session's edits, BASE is the image as
 * loaded, and the factory calibrations are the references the SP-DATEN provide — and they are
 * named by the reference module's own ids so nothing has to translate between two vocabularies.
 */

import { readRun, runTargetOf, type XdfDefinition, type XdfItem } from '@tsunagi/xdf-engine';
import type { ReferenceId } from '@/lib/factory/reference';

export type Variant = 'tuned' | ReferenceId;

/** Which of the three readings the numbers are. SUBJECT is the only one that can be edited. */
export type CompareView = 'subject' | 'delta' | 'reference';

/**
 * How the selected parameter is shown.
 *
 * `map` is the grid of numbers — a tuner's map IS its table, which is why it carries that name
 * and leads the row. `heat` is the same grid as colour seen from above; `2d` one section through
 * it. `shift` and `bits` are this app's own: the hysteresis band a gear pair is tuned through,
 * and a logic register as switches. A form that cannot draw the selected shape is DISABLED
 * rather than drawing something else.
 */
export type GraphMode = 'map' | '2d' | 'heat' | 'shift' | 'bits';

export interface DiffEntry {
    readonly item: XdfItem;
    readonly cellsChanged: number;
    /** Largest |physical difference| across the changed cells, or null when nothing decodes. */
    readonly maxDelta: number | null;
}

/**
 * Every item whose bytes differ between two images. Raw is what is compared — a scaling
 * correction cannot make two identical fields look different — and physical is what is reported,
 * because a raw delta of 16 means nothing to the reader.
 */
export function diffItems(
    def: XdfDefinition,
    subject: Uint8Array,
    reference: Uint8Array,
    items: readonly XdfItem[],
): DiffEntry[] {
    const out: DiffEntry[] = [];
    for (const item of items) {
        let a: number[];
        let b: number[];
        try {
            a = readRun(def, subject, item);
            b = readRun(def, reference, item);
        } catch {
            continue;
        }
        const { scaling } = runTargetOf(item);
        let cellsChanged = 0;
        let maxDelta: number | null = null;
        for (let i = 0; i < a.length; i++) {
            if (a[i] === b[i]) continue;
            cellsChanged++;
            const d = Math.abs(scaling.toPhysical(a[i]) - scaling.toPhysical(b[i]));
            if (Number.isFinite(d)) maxDelta = maxDelta === null ? d : Math.max(maxDelta, d);
        }
        if (cellsChanged > 0) out.push({ item, cellsChanged, maxDelta });
    }
    return out;
}
