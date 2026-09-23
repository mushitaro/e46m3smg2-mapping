'use client';

/**
 * What the definition accounts for, and what it does not.
 *
 * This is a deliverable, not a diagnostic. The MS4X definition reaches 22.3% of the calibration
 * window and declares a `Pressure` category with nothing in it — the hydraulic tables are simply
 * not mapped yet. Drawing the window as a solid block of named tables would imply the ECU has
 * been understood, and the single most useful thing this screen can tell a reader is where to
 * point a disassembler next.
 *
 * The strip is 192 columns across whatever window is loaded — 128 bytes each for the 24 KiB
 * partial — so it fits without scrolling and the smallest gap the report calls large (512 bytes)
 * still covers four columns. A column is shaded by the FRACTION of it that is claimed, so a
 * half-covered column reads as half-lit instead of rounding to mapped or unknown.
 */

import type { CoverageReport } from '@tsunagi/xdf-engine';
import { Field, LABEL, MicroLabel, Well } from './ui';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';

function hex(n: number): string {
    return `0x${n.toString(16).toUpperCase()}`;
}

export function CoverageMap({
    report,
    /** Ranges the definition claims, in file offsets. */
    covered,
    /**
     * File offset -> the definition's own address. Every address a reader sees on this screen is
     * in ONE space, the definition's, so a gap in the list and the window it sits in can be
     * compared without arithmetic. Showing the 24 KiB variant's file offsets here would print
     * `0x0-0x6000` beside gaps at `0x32082`, which are the same bytes under two names.
     */
    toXdfAddress,
    highlight = [],
}: {
    report: CoverageReport;
    covered: readonly (readonly [number, number])[];
    toXdfAddress: (fileOffset: number) => number;
    /**
     * The selected item's bytes, in file offsets. Drawn in the pointer colour — slate-100, never
     * an accent — because it says WHERE you are in the window, not what anything is.
     */
    highlight?: readonly (readonly [number, number])[];
}) {
    const { t } = useLang();
    const { windowStart, windowEnd, windowBytes } = report;
    const CELLS = 192;
    const bytesPerCell = Math.max(1, Math.ceil(windowBytes / CELLS));

    // Fraction of each cell that is claimed, so a cell that is half-covered reads as half-lit
    // rather than as either fully mapped or fully unknown.
    const cells = new Array<number>(CELLS).fill(0);
    for (const [start, end] of covered) {
        const from = Math.max(start, windowStart);
        const to = Math.min(end, windowEnd);
        for (let a = from; a < to;) {
            const index = Math.floor((a - windowStart) / bytesPerCell);
            if (index < 0 || index >= CELLS) break;
            const cellEnd = windowStart + (index + 1) * bytesPerCell;
            const chunk = Math.min(to, cellEnd) - a;
            cells[index] = Math.min(1, cells[index] + chunk / bytesPerCell);
            a += chunk;
        }
    }

    const lit = new Set<number>();
    for (const [start, end] of highlight) {
        const from = Math.max(start, windowStart);
        const to = Math.min(end, windowEnd);
        for (let a = from; a < to; a += bytesPerCell) {
            const index = Math.floor((a - windowStart) / bytesPerCell);
            if (index >= 0 && index < CELLS) lit.add(index);
        }
        if (to > from) lit.add(Math.min(CELLS - 1, Math.floor((to - 1 - windowStart) / bytesPerCell)));
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <Field
                    label={C.fDefined}
                    value={`${report.definedBytes.toLocaleString()} / ${windowBytes.toLocaleString()}`}
                    unit="B"
                    tone="text-blue-400"
                    stacked
                />
                <Field
                    label={C.fCoverage}
                    value={`${(report.fraction * 100).toFixed(1)}`}
                    unit="%"
                    tone={report.fraction > 0.5 ? 'text-emerald-400' : 'text-amber-400'}
                    stacked
                />
                <Field
                    label={C.fWindow}
                    value={`${hex(toXdfAddress(windowStart))}–${hex(toXdfAddress(windowEnd))}`}
                    stacked
                />
                <Field label={C.fLargeGaps} value={report.gaps.length} stacked />
            </div>

            <div>
                <MicroLabel>{C.covWindowMap}</MicroLabel>
                <div className="mt-1.5 flex h-8 w-full overflow-hidden rounded bg-slate-800">
                    {cells.map((fill, i) => (
                        <span
                            key={i}
                            className="h-full flex-1"
                            style={{
                                backgroundColor: lit.has(i)
                                    ? '#F2F2F5'
                                    : fill === 0 ? 'transparent' : `rgba(38, 174, 228, ${0.25 + fill * 0.75})`,
                            }}
                        />
                    ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                    {t.covWindowMapNote(bytesPerCell.toLocaleString())}
                </p>
            </div>

            <div>
                <MicroLabel>{C.covUnmapped}</MicroLabel>
                <div className="mt-1.5 flex flex-col gap-1">
                    {report.gaps.map(gap => (
                        <div
                            key={gap.start}
                            className="flex items-baseline justify-between gap-4 rounded bg-slate-800/40 px-2 py-1"
                        >
                            <span className="font-mono text-[11px] tabular-nums text-slate-300">
                                {hex(gap.xdfStart)} – {hex(gap.xdfEnd)}
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-slate-500">
                                {(gap.bytes / 1024).toFixed(1)} KiB
                            </span>
                        </div>
                    ))}
                    {report.gaps.length === 0 && (
                        <span className="text-[11px] text-slate-500">{t.covNoGaps}</span>
                    )}
                </div>
            </div>

            <div>
                <MicroLabel>{C.covPerCategory}</MicroLabel>
                <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-2">
                    {Object.entries(report.itemsPerCategory).map(([name, count]) => (
                        <Field
                            key={name}
                            label={name}
                            value={count}
                            tone={count === 0 ? 'text-amber-400' : 'text-slate-200'}
                            stacked
                        />
                    ))}
                </div>
                {report.emptyCategories.length > 0 && (
                    <Well className="mt-3">
                        <p className="text-[11px] leading-relaxed text-slate-400">
                            <span className={`${LABEL} text-amber-400`}>{C.covDeclaredEmpty}</span>
                            {t.covEmptyNote(report.emptyCategories.join(', '), report.emptyCategories.length)}
                        </p>
                    </Well>
                )}
            </div>
        </div>
    );
}
