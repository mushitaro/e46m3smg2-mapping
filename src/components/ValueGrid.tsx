'use client';

/**
 * A calibration value, rendered as an editable grid.
 *
 * Replaces `MapGrid`, which had three defects that only look small:
 *
 *   1. **A constant had no edit affordance at all.** It returned a static readout, so 56 of the
 *      111 items — every bitfield, every Clutch Math constant, every RPM threshold — were behind
 *      a locked door nobody had noticed. Here a constant is a 1x1 grid and takes the same path.
 *   2. **`readOnly = !onEdit` with a caller that always passed `onEdit`**, so the flag was
 *      permanently false while the file's own comment claimed non-invertible items rendered
 *      read-only. Now it is derived from the scaling, and the reason is rendered rather than
 *      discovered by typing into a cell and getting a red banner.
 *   3. **Only a mouse could reach it** — double-click to edit, no keyboard at all.
 *
 * ## The spreadsheet model
 *
 * Exactly ONE `<input>` exists, swapped into the selected cell. 160 mounted inputs would be jank
 * for nothing. Selection is owned by the caller so it survives a tab switch; the local `editing`
 * flag follows it and is reconciled during render, so a moved cursor can never paint an input
 * over the wrong cell for even one frame.
 *
 * ## What is displayed is what the flash would hold
 *
 * A commit hands the typed number up, the caller quantises it, and what comes back down is the
 * decoded value. The typed string is never echoed. Otherwise a cell shows 8.15 while the ECU
 * holds 8.1 and nothing on screen says so.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import type { DecodedItem } from '@tsunagi/xdf-engine';

import { LABEL } from './ui';

/** blue-400 -> a neutral -> red-400. Cool is low, warm is high; nothing between carries meaning. */
const COLD = [0x26, 0xae, 0xe4];
const MID = [0x4c, 0x4c, 0x58];
const HOT = [0xf6, 0x4a, 0x50];

function heatColor(t: number): string {
    const clamped = Math.min(1, Math.max(0, t));
    const [a, b, k] = clamped < 0.5 ? [COLD, MID, clamped * 2] : [MID, HOT, (clamped - 0.5) * 2];
    const mix = a.map((v, i) => Math.round(v + (b[i] - v) * k));
    // Held under full opacity so the mono digits stay readable on every cell; the ramp shows
    // shape at a glance and is not the primary readout.
    return `rgba(${mix[0]}, ${mix[1]}, ${mix[2]}, 0.32)`;
}

export function formatValue(value: number, decimals: number | null): string {
    if (!Number.isFinite(value)) return '--';
    const places = decimals ?? (Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2);
    return value.toFixed(places);
}

/** A 16-bit value the way a bitfield wants to be read. */
function formatHex(raw: number, bits: number): string {
    const width = Math.max(2, bits / 4);
    return `0x${(raw >>> 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

export interface Cell { readonly row: number; readonly col: number }

export interface ValueGridProps {
    decoded: DecodedItem;
    /** The selected cell, owned by the caller so it outlives this component. */
    selected: Cell | null;
    onSelect: (cell: Cell | null) => void;
    /** Called with the new PHYSICAL value. The caller quantises. */
    onEdit: (row: number, col: number, physical: number) => void;
    /** Cells that differ from the loaded bytes, keyed `row:col`. */
    changed?: ReadonlySet<string>;
    /**
     * Why this item cannot be written, or null when it can.
     *
     * A sentence, not a boolean, because a control that refuses without saying why is reported as
     * broken. Rendered above the grid — the reason a thing cannot be used is not background
     * reading, so it does not go behind a tooltip that a phone cannot open anyway.
     */
    lockedReason?: string | null;
    /** Show values in hex — the definition's own `outputtype 3`. */
    hex?: boolean;
    /**
     * Row groups the definition cannot express.
     *
     * The AUTO tables are two stacked 5x16 blocks — upshift then downshift — and the XDF declares
     * one 10-row table. Without a heading, "row 7" reads as the seventh row of one thing rather
     * than as third-gear DOWNSHIFT, and the person editing it has no way to know.
     */
    rowGroups?: readonly { readonly label: string; readonly rows: readonly number[] }[];
}

/** Row/column headings: the definition's labels if it has them, else its breakpoints. */
function headings(
    axis: { labels: readonly string[] | null; values: readonly number[] | null; decimals: number | null } | null,
    count: number,
    unit: string | null,
): string[] {
    if (axis?.labels && axis.labels.length >= count) return axis.labels.slice(0, count) as string[];
    if (axis?.values && axis.values.length >= count) {
        return axis.values.slice(0, count).map(v => {
            const text = formatValue(v, axis.decimals);
            // The unit belongs on the axis, not only in a corner cell nobody reads. Suppressed
            // for a wide table, where repeating it 16 times is noise rather than information.
            return unit && count <= 8 ? `${text} ${unit}` : text;
        });
    }
    return Array.from({ length: count }, (_, i) => String(i));
}

/** Grid shape and values, whether the item is a table or a constant. */
function gridOf(decoded: DecodedItem) {
    if (decoded.kind === 'constant') {
        return {
            rows: 1,
            cols: 1,
            values: [[decoded.value]],
            raw: [[decoded.raw]],
            units: decoded.units,
            decimals: (decoded.item as Extract<typeof decoded.item, { kind: 'constant' }>).decimals,
            x: null,
            y: null,
            bits: (decoded.item as Extract<typeof decoded.item, { kind: 'constant' }>).data.bits,
        };
    }
    return {
        rows: decoded.rows,
        cols: decoded.cols,
        values: decoded.values,
        raw: decoded.raw,
        units: decoded.units,
        decimals: decoded.decimals,
        x: decoded.x,
        y: decoded.y,
        bits: decoded.item.kind === 'table' ? decoded.item.z.data.bits : 16,
    };
}

export function ValueGrid({
    decoded, selected, onSelect, onEdit, changed, lockedReason = null, hex = false, rowGroups,
}: ValueGridProps) {
    const g = gridOf(decoded);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const readOnly = lockedReason !== null;

    const selectedKey = selected ? `${selected.row}:${selected.col}` : null;
    // Render-time reconciliation, not an effect: an input must never be painted over a cell the
    // selection has already left, not even for one commit.
    if (editing !== null && editing !== selectedKey) setEditing(null);

    useEffect(() => {
        if (editing !== null) inputRef.current?.select();
    }, [editing]);

    const flat = g.values.flat();
    const min = Math.min(...flat);
    const span = Math.max(...flat) - min;

    const cols = headings(g.x, g.cols, g.x?.units ?? null);
    const rows = headings(g.y, g.rows, null);

    /**
     * Open the editor on a cell, selecting it first.
     *
     * The selection is not optional here. The render-time reconciliation above closes any editor
     * that is not on the selected cell — that is what stops an input being painted over a cell
     * the cursor has left. So opening an editor on an UNSELECTED cell opened it and closed it in
     * the same commit, which is exactly what keyboard entry did: focus a cell, press Enter or a
     * digit, and nothing happened. Selecting here makes the two agree by construction rather than
     * by every caller remembering.
     */
    const beginEdit = (row: number, col: number, seed: string) => {
        if (readOnly) return;
        onSelect({ row, col });
        setEditing(`${row}:${col}`);
        setDraft(seed);
    };

    const commit = (row: number, col: number) => {
        setEditing(null);
        const parsed = Number(draft);
        if (!Number.isFinite(parsed)) return;
        onEdit(row, col, parsed);
    };

    const move = (row: number, col: number, dRow: number, dCol: number) => {
        onSelect({
            row: Math.min(g.rows - 1, Math.max(0, row + dRow)),
            col: Math.min(g.cols - 1, Math.max(0, col + dCol)),
        });
    };

    const onCellKey = (e: React.KeyboardEvent, row: number, col: number, value: number) => {
        if (e.key === 'Enter') { e.preventDefault(); beginEdit(row, col, formatValue(value, g.decimals)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); move(row, col, -1, 0); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); move(row, col, 1, 0); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); move(row, col, 0, -1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); move(row, col, 0, 1); return; }
        // Type-to-replace: any character that could start a number begins the edit seeded with it,
        // so entering a value is one keystroke rather than two.
        if (/^[-0-9.]$/.test(e.key)) { e.preventDefault(); beginEdit(row, col, e.key); }
    };

    return (
        <div>
            {lockedReason && (
                <p className="mb-2 text-[11px] leading-relaxed text-amber-400">{lockedReason}</p>
            )}
            <div className="overflow-x-auto">
                <table className="border-separate border-spacing-0 font-mono text-[11px] tabular-nums">
                    <thead>
                        <tr>
                            <th className={`sticky left-0 z-10 bg-slate-950 px-2 py-1 text-left ${LABEL} text-slate-600`}>
                                {g.units ?? ''}
                            </th>
                            {cols.map((heading, c) => (
                                <th key={c} className="px-2 py-1 text-right text-[10px] font-bold text-slate-500">
                                    {heading}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {g.values.map((row, r) => (
                            <Fragment key={r}>
                            {rowGroups?.find(group => group.rows[0] === r) && (
                                <tr>
                                    <th
                                        colSpan={g.cols + 1}
                                        className={`sticky left-0 bg-slate-950 px-2 pb-0.5 pt-2 text-left ${LABEL} text-slate-500`}
                                    >
                                        {rowGroups.find(group => group.rows[0] === r)!.label}
                                    </th>
                                </tr>
                            )}
                            <tr>
                                <th className="sticky left-0 z-10 bg-slate-950 px-2 py-1 text-right text-[10px] font-bold text-slate-500">
                                    {rows[r]}
                                </th>
                                {row.map((value, c) => {
                                    const key = `${r}:${c}`;
                                    const isSelected = selectedKey === key;
                                    const isChanged = changed?.has(key) ?? false;
                                    return (
                                        <td
                                            key={c}
                                            tabIndex={0}
                                            onKeyDown={e => onCellKey(e, r, c, value)}
                                            onClick={() => {
                                                // Click an unselected cell to select; click the
                                                // selected one to edit. One tap never destroys
                                                // what the reader was looking at.
                                                if (isSelected) beginEdit(r, c, formatValue(value, g.decimals));
                                                else onSelect({ row: r, col: c });
                                            }}
                                            className={`px-2 py-1 text-right outline-none ${
                                                readOnly ? 'text-slate-400' : 'cursor-cell text-slate-100'
                                            } ${isChanged ? 'text-blue-300' : ''}`}
                                            style={{
                                                backgroundColor: span === 0
                                                    ? 'transparent'
                                                    : heatColor((value - min) / span),
                                                // Inset, not a ring: with border-collapse a ring
                                                // lands under the neighbour's border on two sides.
                                                // slate-100 because a pointer is not a status.
                                                boxShadow: isSelected
                                                    ? 'inset 0 0 0 2px #F2F2F5'
                                                    : isChanged ? 'inset 0 0 0 1px #9B84E8' : undefined,
                                            }}
                                        >
                                            {editing === key ? (
                                                <input
                                                    ref={inputRef}
                                                    autoFocus
                                                    inputMode="decimal"
                                                    value={draft}
                                                    onChange={e => setDraft(e.target.value)}
                                                    onBlur={() => commit(r, c)}
                                                    onKeyDown={e => {
                                                        e.stopPropagation();
                                                        if (e.key === 'Enter') commit(r, c);
                                                        if (e.key === 'Escape') setEditing(null);
                                                    }}
                                                    className="w-16 bg-slate-800 px-1 text-right text-slate-100 outline-none ring-1 ring-blue-500"
                                                />
                                            ) : hex ? formatHex(g.raw[r][c], g.bits) : formatValue(value, g.decimals)}
                                        </td>
                                    );
                                })}
                            </tr>
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            {/* Reserved slot: the readout appears inside it so the grid never shifts when a cell
                is tapped. Rendered rather than hovered — there is no hover on a phone. */}
            <div className="mt-2 flex min-h-[22px] items-baseline gap-3">
                {selected && (
                    <>
                        <span className={`${LABEL} text-slate-600`}>
                            {g.rows > 1 ? `${rows[selected.row]} · ` : ''}{cols[selected.col]}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-slate-200">
                            {formatValue(g.values[selected.row][selected.col], g.decimals)}
                            {g.units && <span className="ml-1 text-slate-500">{g.units}</span>}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-slate-600">
                            {formatHex(g.raw[selected.row][selected.col], g.bits)}
                            {' · '}
                            {g.raw[selected.row][selected.col]}
                        </span>
                    </>
                )}
            </div>
        </div>
    );
}
