'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { DecodedRun } from '@/lib/calibration/run';
import { fmtAt } from '@/lib/calibration/run';
import { heat, signedHeat } from './ValueChart';

/**
 * The editable value grid — the reference tuner's `CalibrationValueGrid`, on this app's runs.
 *
 * Sticky headers, fixed cell width, mono digits, and ONE input swapped into the selected cell;
 * 480 mounted inputs would be jank for nothing. The grid always renders the DECODED truth: a
 * commit hands the typed number up, the edit store quantises it, and what comes back down is the
 * value the flash would actually hold. The typed string is never echoed.
 *
 * Colour: `heat` matches ValueChart's ramp so HEAT and MAP agree about hot; `diff` is the house
 * diverging convention (blue = below the basis, red = above); `signed` means the cells ARE
 * differences and colour diverges from zero. Edited cells carry the interactive blue — they are
 * your input.
 *
 * One addition to the port: **row groups**. Ten of this ECU's tables are two stacked 5×16 blocks
 * — upshift over downshift — and the XDF declares them as one 10×16. A heading row between the
 * halves is what stops "row 7" from being edited as if it were a fourth-gear upshift.
 */

const CELL = 50;
const HEAD = 64;

const DIFF_BLUE = '10, 155, 219';
const DIFF_RED = '241, 26, 34';

function diffFill(delta: number, maxAbs: number): string {
    const a = Math.min(0.7, Math.max(0.12, (Math.abs(delta) / (maxAbs || 1)) * 0.6));
    return `rgba(${delta > 0 ? DIFF_RED : DIFF_BLUE}, ${a})`;
}

export function CalibrationValueGrid({
    rows,
    cols,
    corner,
    xLabel,
    yLabel,
    run,
    diffAgainst,
    editedMask,
    mode,
    selected,
    onSelect,
    onCommit,
    readOnly,
    decimals,
    hex,
    rowGroups,
}: {
    rows: number;
    cols: number;
    /** The top-left cell: `Y\X`. */
    corner: string;
    xLabel: (i: number) => string;
    yLabel: (i: number) => string;
    /** What this view shows (subject / reference / difference). */
    run: DecodedRun;
    /** The Δ basis run; colours cells that differ from it in 'diff' mode. */
    diffAgainst?: DecodedRun | null;
    /** Cells the edit set changed vs base — drawn as the reader's own input. */
    editedMask?: readonly boolean[] | null;
    mode: 'heat' | 'diff' | 'signed';
    selected: number | null;
    onSelect: (index: number) => void;
    onCommit: (index: number, physical: number) => void;
    readOnly: boolean;
    /** The definition's own precision for these values, when it states one. */
    decimals: number | null;
    /** The definition's display radix says hexadecimal — a bit pattern, not a quantity. */
    hex?: boolean;
    rowGroups?: readonly { readonly label: string; readonly rows: readonly number[] }[] | null;
}) {
    const [editing, setEditing] = useState<number | null>(null);
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // The selection is the caller's; local editing follows it and never outlives it. Render-time
    // adjustment, so a moved cursor can never show one frame of an input over the wrong cell.
    if (editing !== null && editing !== selected) setEditing(null);
    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [editing]);

    const fmt = (v: number | null, raw: number) => {
        if (hex) return `0x${(raw >>> 0).toString(16).toUpperCase().padStart(4, '0')}`;
        return fmtAt(v, decimals);
    };

    const finiteValues = run.phys.filter((p): p is number => p !== null);
    const lo = finiteValues.length ? Math.min(...finiteValues) : 0;
    const hi = finiteValues.length ? Math.max(...finiteValues) : 1;
    /** Signed mode's scale is anchored on zero, so it needs the largest step either way rather
     *  than the range the values happen to span. */
    const maxAbsSigned = finiteValues.length ? Math.max(...finiteValues.map(Math.abs)) : 0;

    let maxAbsDelta = 0;
    if (mode === 'diff' && diffAgainst) {
        for (let i = 0; i < run.phys.length; i++) {
            const a = run.phys[i];
            const b = diffAgainst.phys[i];
            if (a !== null && b !== null && b !== undefined) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(a - b));
        }
    }

    const beginEdit = (index: number, seed?: string) => {
        if (readOnly) return;
        setEditing(index);
        setDraft(seed ?? fmtAt(run.phys[index], decimals).replace('—', ''));
    };

    const commit = () => {
        if (editing === null) return;
        const parsed = Number(draft);
        if (draft.trim() !== '' && Number.isFinite(parsed)) onCommit(editing, parsed);
        setEditing(null);
    };

    const move = (from: number, dRow: number, dCol: number) => {
        const r = Math.floor(from / cols) + dRow;
        const c = (from % cols) + dCol;
        if (r < 0 || r >= rows || c < 0 || c >= cols) return;
        onSelect(r * cols + c);
    };

    const onCellKeyDown = (e: React.KeyboardEvent, index: number) => {
        if (editing !== null) return;
        if (e.key === 'Enter') { e.preventDefault(); beginEdit(index); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(index, -1, 0); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); move(index, 1, 0); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); move(index, 0, -1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); move(index, 0, 1); }
        else if (!readOnly && /^[-\d.]$/.test(e.key)) { e.preventDefault(); beginEdit(index, e.key); }
    };

    const cell = (index: number) => {
        const phys = run.phys[index] ?? null;
        const raw = run.raw[index] ?? 0;
        const isSelected = selected === index;
        const isEdited = editedMask?.[index] ?? false;
        let background: string | undefined;
        if (mode === 'signed') {
            if (phys !== null && phys !== 0) background = signedHeat(phys, maxAbsSigned);
        } else if (mode === 'diff' && diffAgainst) {
            const b = diffAgainst.phys[index] ?? null;
            const delta = phys !== null && b !== null ? phys - b : 0;
            if (run.raw[index] !== diffAgainst.raw[index] && delta !== 0) background = diffFill(delta, maxAbsDelta);
        } else if (phys !== null) {
            background = heat(phys, lo, hi);
        }
        // Ink flips against the bright end of the ramp so the number stays legible.
        const bright = mode === 'heat' && phys !== null && hi !== lo && (phys - lo) / (hi - lo) > 0.65;
        return (
            <td
                key={index}
                className={`border border-slate-800 p-0 text-right align-middle ${readOnly ? '' : 'cursor-cell'}`}
                style={{ width: CELL, minWidth: CELL, height: 22, background }}
                onClick={() => (isSelected && !readOnly ? beginEdit(index) : onSelect(index))}
                onKeyDown={e => onCellKeyDown(e, index)}
                tabIndex={0}
            >
                {editing === index ? (
                    <input
                        ref={inputRef}
                        type="text"
                        inputMode="decimal"
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); commit(); }
                            else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                            e.stopPropagation();
                        }}
                        className="h-full w-full bg-slate-800 px-1 text-right font-mono text-[10px] text-blue-400 outline-none"
                    />
                ) : (
                    <span
                        className={`block px-1 font-mono text-[10px] tabular-nums ${isEdited ? 'text-blue-400' : bright ? 'text-slate-950' : 'text-slate-200'}`}
                        style={isSelected ? { boxShadow: 'inset 0 0 0 2px #F2F2F5' } : isEdited && !background ? { background: 'rgba(10, 155, 219, 0.10)' } : undefined}
                    >
                        {fmt(phys, raw)}
                    </span>
                )}
            </td>
        );
    };

    /** The group whose FIRST row this is, so a heading can precede it. */
    const groupStartingAt = (r: number) => rowGroups?.find(g => g.rows[0] === r) ?? null;
    const span = cols + (rows > 1 ? 1 : 0);

    // Constants: a single cell, same machinery.
    return (
        <div className="max-h-full overflow-auto">
            <table className="border-collapse" style={{ width: cols * CELL + (rows > 1 ? HEAD : 0) }}>
                {cols > 1 && (
                    <thead>
                        <tr>
                            {rows > 1 && (
                                <th
                                    className="sticky left-0 top-0 z-20 bg-slate-950 px-1 text-left text-[8px] font-bold tracking-widest text-slate-600"
                                    style={{ width: HEAD, minWidth: HEAD }}
                                >
                                    {corner}
                                </th>
                            )}
                            {Array.from({ length: cols }, (_, c) => (
                                <th
                                    key={c}
                                    className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950 px-1 text-right font-mono text-[9px] text-slate-500"
                                    style={{ width: CELL, minWidth: CELL }}
                                >
                                    {xLabel(c)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                )}
                <tbody>
                    {Array.from({ length: rows }, (_, r) => {
                        const group = groupStartingAt(r);
                        return (
                            <React.Fragment key={r}>
                                {group && (
                                    <tr>
                                        <th
                                            colSpan={span}
                                            className="sticky left-0 z-10 bg-slate-950 px-1 pt-2 pb-0.5 text-left text-[8px] font-bold tracking-widest text-slate-500"
                                        >
                                            {group.label}
                                        </th>
                                    </tr>
                                )}
                                <tr>
                                    {rows > 1 && (
                                        <td
                                            className="sticky left-0 z-10 border-r border-slate-800 bg-slate-950 px-1 text-right font-mono text-[9px] text-slate-500"
                                            style={{ width: HEAD, minWidth: HEAD }}
                                        >
                                            {yLabel(r)}
                                        </td>
                                    )}
                                    {Array.from({ length: cols }, (_, c) => cell(r * cols + c))}
                                </tr>
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
