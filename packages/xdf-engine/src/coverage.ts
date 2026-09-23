/**
 * How much of the calibration window a definition actually accounts for.
 *
 * This is a first-class output, not a diagnostic. Siemens SMG2 510 defines 5,477 of the 24,576
 * bytes it spans — 22.3% — and declares two categories, Pressure and Clutch, that contain no
 * items at all. Those are the hydraulic and clutch tables: the part of the ECU a shift tune most
 * wants and the definition does not reach. Rendering the map as if it were complete would hide
 * the single most important fact about it.
 */

import { spansOf } from './codec';
import type { XdfDefinition } from './types';

export interface CoverageGap {
    /** FILE offsets. */
    readonly start: number;
    readonly end: number;
    readonly bytes: number;
    /** The same range in the definition's own address space, for quoting in notes and issues. */
    readonly xdfStart: number;
    readonly xdfEnd: number;
}

export interface CoverageReport {
    /** The window examined, in FILE offsets. */
    readonly windowStart: number;
    readonly windowEnd: number;
    readonly windowBytes: number;
    /** Distinct bytes claimed by at least one item. Overlaps count once. */
    readonly definedBytes: number;
    readonly fraction: number;
    /** Undefined runs of at least `minGapBytes`, largest-first. */
    readonly gaps: readonly CoverageGap[];
    /** Category name -> number of items. Zero-item categories are kept; they are the finding. */
    readonly itemsPerCategory: Readonly<Record<string, number>>;
    readonly emptyCategories: readonly string[];
    /** Lowest and highest byte any item touches, in FILE offsets. */
    readonly firstDefined: number | null;
    readonly lastDefined: number | null;
}

export interface CoverageOptions {
    /** Defaults to the span of the definition's own items, rounded out to `align`. */
    readonly windowStart?: number;
    readonly windowEnd?: number;
    /** Gaps smaller than this are noise from padding between tables. */
    readonly minGapBytes?: number;
    /** Round an inferred window outwards to this boundary. Defaults to 4 KiB. */
    readonly align?: number;
}

export function coverageOf(def: XdfDefinition, options: CoverageOptions = {}): CoverageReport {
    const minGapBytes = options.minGapBytes ?? 512;
    const align = options.align ?? 0x1000;

    const ranges: Array<[number, number]> = [];
    const perCategory: Record<string, number> = {};
    for (const name of def.header.categories) if (name) perCategory[name] = 0;

    for (const item of def.items) {
        for (const category of item.categories) {
            perCategory[category] = (perCategory[category] ?? 0) + 1;
        }
        for (const span of spansOf(def, item)) {
            if (span.end > span.start) ranges.push([span.start, span.end]);
        }
    }

    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    // Merge to get distinct coverage. Overlapping definitions (shared axes) must count once, or
    // the percentage flatters the definition.
    const merged: Array<[number, number]> = [];
    for (const [start, end] of ranges) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }

    const firstDefined = merged.length ? merged[0][0] : null;
    const lastDefined = merged.length ? merged[merged.length - 1][1] : null;

    const windowStart = options.windowStart
        ?? (firstDefined === null ? 0 : Math.floor(firstDefined / align) * align);
    const windowEnd = options.windowEnd
        ?? (lastDefined === null ? 0 : Math.ceil(lastDefined / align) * align);

    let definedBytes = 0;
    for (const [start, end] of merged) {
        definedBytes += Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
    }

    const gaps: CoverageGap[] = [];
    let cursor = windowStart;
    for (const [start, end] of merged) {
        if (start > cursor) addGap(gaps, def, cursor, Math.min(start, windowEnd), minGapBytes);
        cursor = Math.max(cursor, end);
        if (cursor >= windowEnd) break;
    }
    if (cursor < windowEnd) addGap(gaps, def, cursor, windowEnd, minGapBytes);
    gaps.sort((a, b) => b.bytes - a.bytes);

    const windowBytes = Math.max(0, windowEnd - windowStart);
    return {
        windowStart,
        windowEnd,
        windowBytes,
        definedBytes,
        fraction: windowBytes === 0 ? 0 : definedBytes / windowBytes,
        gaps,
        itemsPerCategory: perCategory,
        emptyCategories: Object.entries(perCategory).filter(([, n]) => n === 0).map(([name]) => name),
        firstDefined,
        lastDefined,
    };
}

function addGap(
    out: CoverageGap[], def: XdfDefinition, start: number, end: number, minGapBytes: number,
): void {
    const bytes = end - start;
    if (bytes < minGapBytes) return;
    out.push({ start, end, bytes, xdfStart: def.xdfAddressOf(start), xdfEnd: def.xdfAddressOf(end) });
}
