'use client';

/**
 * A gear pair's shift band.
 *
 * The thing being tuned is not a row. It is the **hysteresis band** between the speed at which
 * the box leaves a gear going up and the speed at which it comes back down. The XDF declares one
 * 10x16 table; the catalog knows it is two stacked 5x16 blocks; and neither of those is how a
 * person thinks about it. A person thinks "2nd to 3rd is happening too early".
 *
 * So: one gear pair at a time, the two lines drawn against throttle with the band between them
 * shaded, and a two-row grid underneath sharing the same selection.
 *
 * ## The violation marker
 *
 * Any throttle column where DOWN >= UP is drawn red in both lines and both cells. Stock satisfies
 * up > down in 800 of 800 cells; an edit that crosses it is a shift hunt built by hand — the box
 * will upshift, immediately meet the downshift threshold, and oscillate at a steady speed. The
 * guard costs nothing because it is the same predicate that established the block structure.
 *
 * ## Why inline SVG rather than a chart library
 *
 * Two polylines and a shaded band. Plotly would add about a megabyte to a PWA that is read on a
 * phone in a garage, to draw something an `<svg>` draws in forty lines.
 */

import type { DecodedItem } from '@tsunagi/xdf-engine';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { Chip, LABEL } from './ui';
import { ValueGrid, formatValue, type Cell } from './ValueGrid';

/** Gear pairs, in the order the rows sit in the table. Row k is up, row k+5 is down. */
const PAIRS = ['1↔2', '2↔3', '3↔4', '4↔5', '5↔6'] as const;

export interface ShiftPointViewProps {
    decoded: DecodedItem;
    /** Which pair is open. Owned by the caller so it survives a re-render. */
    pair: number;
    onPair: (pair: number) => void;
    selected: Cell | null;
    onSelect: (cell: Cell | null) => void;
    onEdit: (row: number, col: number, physical: number) => void;
    changed?: ReadonlySet<string>;
    lockedReason?: string | null;
    /** The same table decoded from the reference image, for the ghost lines. */
    reference?: DecodedItem | null;
    referenceLabel?: string | null;
}

/** True when this decoded item is a 10x16 the catalog has marked as up/down. */
export function isShiftTable(decoded: DecodedItem): boolean {
    return decoded.kind === 'table' && decoded.rows === 10 && decoded.cols === 16;
}

function rowsOf(decoded: DecodedItem, pair: number): { up: number[]; down: number[] } {
    if (decoded.kind !== 'table') return { up: [], down: [] };
    return { up: [...decoded.values[pair]], down: [...decoded.values[pair + 5]] };
}

export function ShiftPointView({
    decoded, pair, onPair, selected, onSelect, onEdit, changed, lockedReason = null,
    reference = null, referenceLabel = null,
}: ShiftPointViewProps) {
    const { t } = useLang();
    if (decoded.kind !== 'table') return null;

    const { up, down } = rowsOf(decoded, pair);
    const ghost = reference && reference.kind === 'table' && reference.rows === 10
        ? rowsOf(reference, pair)
        : null;

    const throttle = decoded.x?.values ?? null;
    const cols = up.length;
    const violations = up.map((u, i) => down[i] >= u && !(u === 0 && down[i] === 0));
    const anyViolation = violations.some(Boolean);

    // The plot. Padded so a flat line is not drawn on the frame.
    const all = [...up, ...down, ...(ghost ? [...ghost.up, ...ghost.down] : [])];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.1 || 1;
    const yMin = lo - pad;
    const yMax = hi + pad;
    const W = 640;
    const H = 150;
    const x = (i: number) => (cols <= 1 ? 0 : (i / (cols - 1)) * W);
    const y = (v: number) => H - ((v - yMin) / (yMax - yMin || 1)) * H;
    const path = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
    const band = `${up.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')} `
        + `${down.map((v, i) => `L${x(down.length - 1 - i)},${y(down[down.length - 1 - i])}`).join(' ')} Z`;

    /** Selecting inside this view maps back to the real row so one selection serves both. */
    const select = (half: 'up' | 'down', col: number) =>
        onSelect({ row: half === 'up' ? pair : pair + 5, col });
    const selectedHalf = selected
        ? (selected.row === pair ? 'up' : selected.row === pair + 5 ? 'down' : null)
        : null;

    return (
        <div>
            <div className="flex flex-wrap items-center gap-2">
                <span className={`${LABEL} text-slate-600`}>{C.gearPair}</span>
                {PAIRS.map((label, i) => (
                    <Chip key={label} active={pair === i} onClick={() => { onPair(i); onSelect(null); }}>
                        {label}
                    </Chip>
                ))}
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={t.shiftBandAria}>
                {/* The band IS the hysteresis. Shading it is the whole point of the view. */}
                <path d={band} fill="rgba(38,174,228,0.10)" />
                {ghost && (
                    <>
                        <path d={path(ghost.up)} fill="none" stroke="#9B84E8" strokeWidth={1}
                            strokeDasharray="3 3" opacity={0.8} />
                        <path d={path(ghost.down)} fill="none" stroke="#9B84E8" strokeWidth={1}
                            strokeDasharray="3 3" opacity={0.5} />
                    </>
                )}
                <path d={path(up)} fill="none" stroke="#26AEE4" strokeWidth={2} />
                <path d={path(down)} fill="none" stroke="#26AEE4" strokeWidth={2} opacity={0.55} />
                {violations.map((bad, i) => bad && (
                    <line key={i} x1={x(i)} y1={0} x2={x(i)} y2={H} stroke="#F64A50" strokeWidth={1.5} opacity={0.6} />
                ))}
                {selectedHalf && selected && (
                    <line x1={x(selected.col)} y1={0} x2={x(selected.col)} y2={H}
                        stroke="#F2F2F5" strokeWidth={1} opacity={0.7} />
                )}
            </svg>

            <div className="mt-1 flex items-baseline justify-between">
                <span className={`${LABEL} text-slate-600`}>
                    {throttle ? `${formatValue(throttle[0], 0)}%` : '0'}
                </span>
                <span className={`${LABEL} text-slate-600`}>{C.throttleAxis}</span>
                <span className={`${LABEL} text-slate-600`}>
                    {throttle ? `${formatValue(throttle[cols - 1], 0)}%` : String(cols - 1)}
                </span>
            </div>

            {anyViolation && (
                // Reason, then the action. A warning a reader cannot act on is a bug report.
                <p className="mt-2 text-[11px] leading-relaxed text-red-400">{t.hysteresisViolated}</p>
            )}

            {/* The editing surface: the same two rows, sharing one selection with the plot. */}
            <div className="mt-3">
                <ValueGrid
                    decoded={twoRowView(decoded, pair)}
                    selected={selected && selectedHalf
                        ? { row: selectedHalf === 'up' ? 0 : 1, col: selected.col }
                        : null}
                    onSelect={cell => (cell ? select(cell.row === 0 ? 'up' : 'down', cell.col) : onSelect(null))}
                    onEdit={(row, col, physical) => onEdit(row === 0 ? pair : pair + 5, col, physical)}
                    changed={new Set([...(changed ?? [])]
                        .map(key => {
                            const [r, c] = key.split(':').map(Number);
                            if (r === pair) return `0:${c}`;
                            if (r === pair + 5) return `1:${c}`;
                            return null;
                        })
                        .filter((k): k is string => k !== null))}
                    lockedReason={lockedReason}
                    rowGroups={[{ label: 'UP', rows: [0] }, { label: 'DOWN', rows: [1] }]}
                />
            </div>

            {referenceLabel && ghost && (
                <p className="mt-1 text-[11px] text-indigo-400">{t.ghostIs(referenceLabel)}</p>
            )}
        </div>
    );
}

/**
 * The chosen pair as a standalone 2x16, so the grid needs no knowledge of the pairing.
 *
 * A view, not a copy of the data's meaning: the row indices it reports are 0 and 1 and the caller
 * maps them back. Everything that writes bytes still goes through the real row numbers.
 */
function twoRowView(decoded: DecodedItem, pair: number): DecodedItem {
    if (decoded.kind !== 'table') return decoded;
    return {
        ...decoded,
        rows: 2,
        values: [decoded.values[pair], decoded.values[pair + 5]],
        raw: [decoded.raw[pair], decoded.raw[pair + 5]],
        y: decoded.y
            ? {
                ...decoded.y,
                labels: decoded.y.labels
                    ? [decoded.y.labels[pair], decoded.y.labels[pair + 5]]
                    : null,
                raw: null,
                values: null,
            }
            : null,
    };
}
