/**
 * The selected item as flat runs, the shape the calibration views are written for.
 *
 * `DecodedItem` is a constant or a rows×cols table; the reference tuner's views (grid, heat
 * field, section, diff list) all think in ONE index space — `index = row * cols + col` — so the
 * cell a chart is pointing at is the cell the grid is editing is the cell the diff list counts.
 * This module is the one place that flattening happens.
 */

import type { DecodedAxis, DecodedItem, XdfItem } from '@tsunagi/xdf-engine';

export interface DecodedRun {
    readonly raw: readonly number[];
    /** Null where the value could not be decoded. */
    readonly phys: readonly (number | null)[];
}

export interface RunShape {
    readonly rows: number;
    readonly cols: number;
}

export type ItemKind = 'constant' | 'curve' | 'map';

/** ● a single value, ◠ one axis, ▦ two. What the tree groups by and the form row switches on. */
export function kindOf(item: XdfItem): ItemKind {
    if (item.kind === 'constant') return 'constant';
    return Math.max(1, item.z.data.rows) > 1 ? 'map' : 'curve';
}

export function shapeOf(item: XdfItem): RunShape {
    if (item.kind === 'constant') return { rows: 1, cols: 1 };
    return { rows: Math.max(1, item.z.data.rows), cols: Math.max(1, item.z.data.cols) };
}

export function runOf(decoded: DecodedItem): DecodedRun {
    if (decoded.kind === 'constant') {
        return { raw: [decoded.raw], phys: [Number.isFinite(decoded.value) ? decoded.value : null] };
    }
    return {
        raw: decoded.raw.flat(),
        phys: decoded.values.flat().map(v => (Number.isFinite(v) ? v : null)),
    };
}

/** Decimal places the definition asks for, when it says. */
export function decimalsOf(decoded: DecodedItem): number | null {
    if (decoded.kind === 'constant') return decoded.item.kind === 'constant' ? decoded.item.decimals : null;
    return decoded.decimals;
}

/** A value at the definition's own precision, or the chart's compact form when it states none. */
export function fmtAt(v: number | null, decimals: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—';
    if (decimals === null) {
        if (Number.isInteger(v)) return String(v);
        return v.toFixed(Math.abs(v) < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '');
    }
    return v.toFixed(decimals);
}

/** Axis positions and their printed labels, for whichever axis a view runs along. */
export function axisTicks(axis: DecodedAxis | null, n: number): { xs: number[]; label: (i: number) => string } {
    if (!axis) {
        return { xs: Array.from({ length: n }, (_, i) => i), label: i => String(i) };
    }
    if (axis.values) {
        const values = [...axis.values];
        return {
            xs: values,
            label: i => {
                // A labelled AND valued axis prints the label; the value is what the chart plots.
                if (axis.labels?.[i]) return axis.labels[i];
                const v = values[i];
                if (v === undefined || !Number.isFinite(v)) return String(i);
                return fmtAt(v, axis.decimals);
            },
        };
    }
    if (axis.labels) {
        const labels = axis.labels;
        return { xs: labels.map((_, i) => i), label: i => labels[i] || String(i) };
    }
    return { xs: Array.from({ length: n }, (_, i) => i), label: i => String(i) };
}

/** Same breakpoints in both images? Compared on the decoded arrays — the exact values both views
 *  label their cells with. A label-only axis has no bytes to differ. */
export function axesEqual(a: DecodedAxis | null, b: DecodedAxis | null): boolean {
    if (!a || !b) return a === b;
    if (!a.values || !b.values) return true;
    return a.values.length === b.values.length && a.values.every((v, i) => v === b.values![i]);
}
