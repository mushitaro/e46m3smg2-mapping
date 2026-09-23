/**
 * Turning what a person typed into what the flash can hold.
 *
 * One boundary, because there is exactly one moment where a physical number becomes a raw one and
 * every path has to agree about it. When two paths quantise separately they disagree eventually,
 * and the symptom is a cell that reads back one LSB away from what the reader typed with nothing
 * on screen to explain it.
 *
 * The step is MEASURED, never assumed: `|toPhysical(raw + 1) - toPhysical(raw)|` at the value in
 * hand. A definition's scaling is not always affine — this engine derives an inverse by bisection
 * when it has to — so a step computed once for a whole table would be wrong across most of it.
 */

import { type XdfDefinition, type XdfItem, runTargetOf } from '@tsunagi/xdf-engine';

export interface RawLimits {
    readonly min: number;
    readonly max: number;
}

/** What the field can physically hold, from its width and signedness alone. */
export function rawLimits(item: XdfItem): RawLimits {
    const { data } = runTargetOf(item);
    const span = 2 ** data.bits;
    return data.signed
        ? { min: -(span / 2), max: span / 2 - 1 }
        : { min: 0, max: span - 1 };
}

export interface Quantised {
    /** The raw the flash will hold. Always inside `rawLimits`. */
    readonly raw: number;
    /** What that raw decodes back to — what the grid must display, not what was typed. */
    readonly value: number;
    /** True when the raw had to be clamped to fit the field. */
    readonly clamped: boolean;
}

export class QuantiseError extends Error {
    constructor(message: string) { super(message); this.name = 'QuantiseError'; }
}

/**
 * Physical -> raw, clamped to the field.
 *
 * Clamping rather than throwing is deliberate for the range case: a person dragging a slider to
 * the end of its travel has not made an error, and refusing the drag would leave the control
 * feeling broken. `clamped` is returned so the caller can say so. A scaling that cannot be
 * inverted at all IS an error, because there is no honest value to fall back to.
 */
export function quantise(item: XdfItem, physical: number): Quantised {
    const { scaling } = runTargetOf(item);
    if (scaling.inverse === 'none') {
        throw new QuantiseError(
            `"${item.title}" uses MATH ${JSON.stringify(scaling.math)}, which cannot be inverted; ` +
            `this item is read-only`);
    }
    if (!Number.isFinite(physical)) {
        throw new QuantiseError(`"${physical}" is not a number`);
    }

    const limits = rawLimits(item);
    const exact = Math.round(scaling.toRaw(physical));
    const raw = Math.min(limits.max, Math.max(limits.min, exact));
    return { raw, value: scaling.toPhysical(raw), clamped: raw !== exact };
}

/**
 * The physical distance one raw count covers AT this value.
 *
 * This is the slider's step and the answer to "how finely can I actually set this". Measured
 * upward, falling back to downward at the top of the field so the last cell still reports a step
 * rather than zero.
 */
export function physicalStep(item: XdfItem, raw: number): number {
    const { scaling } = runTargetOf(item);
    const limits = rawLimits(item);
    const here = scaling.toPhysical(raw);
    if (raw < limits.max) return Math.abs(scaling.toPhysical(raw + 1) - here);
    if (raw > limits.min) return Math.abs(here - scaling.toPhysical(raw - 1));
    return 0;
}

/**
 * The physical range this item can express, for a slider's ends.
 *
 * From the FIELD, not from the values currently in the table: a slider that stopped at the
 * table's own maximum could never raise the highest cell, which is usually the one being raised.
 */
export function physicalRange(item: XdfItem): { min: number; max: number } {
    const { scaling } = runTargetOf(item);
    const limits = rawLimits(item);
    const a = scaling.toPhysical(limits.min);
    const b = scaling.toPhysical(limits.max);
    return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Whether this item can be written at all. The honest source for a read-only badge. */
export function isWritable(item: XdfItem): boolean {
    const { data, scaling } = runTargetOf(item);
    return data.address !== null && scaling.inverse !== 'none';
}

/** Why it cannot be written, in one sentence naming the next action. */
export function whyNotWritable(item: XdfItem, def: XdfDefinition): string | null {
    const { data, scaling } = runTargetOf(item);
    if (data.address === null) {
        return `The definition gives "${item.title}" no address, so there is nothing to write to. ` +
            `It is a label, not a value.`;
    }
    if (scaling.inverse === 'none') {
        return `"${item.title}" converts with ${scaling.math}, which this engine cannot run ` +
            `backwards. Reading is exact; writing would have to guess. Edit it in a hex editor at ` +
            `0x${def.fileOffsetOf(data.address).toString(16).toUpperCase()} if you must.`;
    }
    return null;
}
