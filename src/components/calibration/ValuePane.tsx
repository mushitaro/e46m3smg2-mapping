'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Scale } from 'lucide-react';
import { runTargetOf, type DecodedItem, type OverlayNote, type XdfItem } from '@tsunagi/xdf-engine';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import type { CompareView, GraphMode, Variant } from '@/lib/calibration/compare';
import {
    axesEqual, axisTicks, decimalsOf, kindOf, runOf, shapeOf, type DecodedRun,
} from '@/lib/calibration/run';
import { physicalRange, physicalStep } from '@/lib/quantise';
import { CompareBar, type CompareOption } from '@/components/CompareBar';
import { BitField } from '@/components/BitField';
import { ShiftPointView, isShiftTable } from '@/components/ShiftPointView';
import { HeatField, ScalarReadout, SectionChart } from './ValueChart';
import { CalibrationValueGrid } from './CalibrationValueGrid';

/**
 * The visualize-and-input surface — the reference tuner's `ValuePane`, on this ECU's items.
 *
 * The compare bar on top is the DIFFERENCE question's own control: SUBJECT is what is drawn,
 * REFERENCE is what it is drawn against, and both are chosen from the app's own records — this
 * session's bytes, the image as loaded, or a factory calibration. Below it one row picks the FORM,
 * and under the picture sit the two things that act on it: the slider that walks the pinned axis,
 * and the edit ops.
 *
 * Two forms are this app's own. SHIFT is the hysteresis band a gear pair is tuned through — the
 * thing being tuned is not a row, it is the gap between the up line and the down line. BITS is a
 * logic register as switches. Each is offered only where the catalog has established the
 * structure it draws; a form that cannot draw the selected shape is DISABLED, never repurposed.
 */

export interface BulkOp {
    readonly kind: 'add' | 'scale';
    readonly amount: number;
}

function ModeButton({ on, onClick, disabled, title, children }: {
    on: boolean; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`border-b-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest transition disabled:opacity-30 ${on ? 'border-blue-400 text-blue-400' : 'border-transparent text-slate-600 hover:text-slate-300'}`}
        >
            {children}
        </button>
    );
}

export function ValuePane({
    item,
    subjectDecoded,
    referenceDecoded,
    editedMask,
    hasEdit,
    note,
    lockReason,
    baseRaw,
    graphMode,
    onGraphMode,
    sectionAxis,
    onSectionAxis,
    gearPair,
    onGearPair,
    subject,
    onSubject,
    reference,
    onReference,
    compareOptions,
    view,
    onView,
    diffCount,
    onShowList,
    onEditCell,
    onBulkOp,
    onCopyRef,
    onRevert,
    onToggleBit,
}: {
    item: XdfItem | null;
    /** The values SUBJECT holds, and REFERENCE's — null when they are the same, or not loaded. */
    subjectDecoded: DecodedItem | null;
    referenceDecoded: DecodedItem | null;
    /** Cells the edit set changed vs BASE, by index. Only meaningful while SUBJECT is TUNED. */
    editedMask: readonly boolean[] | null;
    hasEdit: boolean;
    note: OverlayNote | null;
    lockReason: string | null;
    /** What the loaded image holds for a bitfield, so a flipped bit can be marked. */
    baseRaw: number | null;
    graphMode: GraphMode;
    onGraphMode: (m: GraphMode) => void;
    sectionAxis: 'x' | 'y';
    onSectionAxis: (a: 'x' | 'y') => void;
    gearPair: number;
    onGearPair: (p: number) => void;
    subject: Variant;
    onSubject: (v: Variant) => void;
    reference: Variant;
    onReference: (v: Variant) => void;
    compareOptions: CompareOption[];
    view: CompareView;
    onView: (v: CompareView) => void;
    /** How many parameters differ, for the balance's badge. Null when nothing to compare. */
    diffCount: number | null;
    /** Ask for the list of them. It lives in the inputs pane, which this pane does not own. */
    onShowList?: () => void;
    onEditCell: (index: number, physical: number) => void;
    /** `indices` is what is currently on screen; omitted means the whole run. */
    onBulkOp: (op: BulkOp, indices?: readonly number[]) => void;
    onCopyRef: () => void;
    onRevert: () => void;
    onToggleBit: (bit: number) => void;
}) {
    const { t } = useLang();
    const [selectedCell, setSelectedCell] = useState<number | null>(null);
    const [amount, setAmount] = useState('');
    /** The sign of a bulk step, as a control rather than as a character to type: a phone's decimal
     *  keypad has no minus key, and "subtract 0.05 from this row" is half of what this bar is for. */
    const [amountSign, setAmountSign] = useState<1 | -1>(1);
    const [cellDraft, setCellDraft] = useState<string | null>(null);

    /**
     * The box the picture is actually given, measured off the element it is drawn into. One
     * element, one observer, both numbers: they cannot drift apart. FLOOR, not round: the
     * container scrolls, and a height rounded up past its own box is a scrollbar that then
     * narrows the box.
     */
    const visualRef = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState({ w: 360, h: 300 });
    useEffect(() => {
        const el = visualRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            const r = entries[0]?.contentRect;
            if (r) setBox({ w: Math.floor(r.width), h: Math.floor(r.height) });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    /** Fill the box exactly, with no floor under it: a chart taller than its scroller has to be
     *  SCROLLED to be seen. The short screen gets a short picture rather than a clipped one. */
    const chartH = box.h;

    // A new selection is a new question; the cell cursor does not carry over.
    const [prevItemId, setPrevItemId] = useState<string | undefined>(item?.uniqueId);
    if (prevItemId !== item?.uniqueId) {
        setPrevItemId(item?.uniqueId);
        setSelectedCell(null);
    }

    const kind = item ? kindOf(item) : 'constant';
    const { rows, cols } = item ? shapeOf(item) : { rows: 1, cols: 1 };
    const isMap = kind === 'map';
    const isCurve = kind === 'curve';
    const isConstant = kind === 'constant';

    // The drawn forms only exist for the shapes that have them; the grid always does. A mode that
    // cannot draw is disabled rather than drawing something else, and an impossible one falls back
    // to the grid.
    const canHeat = isMap;
    const can2d = isMap || isCurve;
    const canShift = !!subjectDecoded && isShiftTable(subjectDecoded) && (note?.rowGroups?.length ?? 0) === 2;
    const canBits = isConstant && !!note?.bits;
    const effectiveMode: GraphMode =
        graphMode === 'heat' && canHeat ? 'heat'
            : graphMode === '2d' && can2d ? '2d'
                : graphMode === 'shift' && canShift ? 'shift'
                    : graphMode === 'bits' && canBits ? 'bits'
                        : 'map';

    const selected = selectedCell === null ? null
        : { row: Math.floor(selectedCell / cols), col: selectedCell % cols };

    /** Whether there are two different images to subtract. A property of the SELECTORS, not of
     *  what happens to be selected — the balance is the compare bar's control, and it must not go
     *  dead because no parameter is open yet. */
    const comparing = subject !== reference && diffCount !== null;
    const subjectRun: DecodedRun | null = subjectDecoded ? runOf(subjectDecoded) : null;
    const referenceRun: DecodedRun | null = referenceDecoded ? runOf(referenceDecoded) : null;
    /** ...though drawing the difference still needs both runs for THIS item. */
    const showingDiff = view === 'delta' && comparing && !!referenceRun;
    const showingReference = view === 'reference' && comparing && !!referenceRun;
    /** Editing acts on the SUBJECT, so it is only offered while looking at it. */
    const onSubjectValues = !showingDiff && !showingReference;
    const editable = !!item && !lockReason && subject === 'tuned' && !!subjectRun && onSubjectValues;
    const amountNumber = Number(amount) * amountSign;
    const amountOk = amount.trim() !== '' && Number.isFinite(amountNumber);
    const canCopyRef = !!item && !lockReason && subject === 'tuned' && comparing && !!referenceRun;

    const axesDiffer = !!referenceDecoded && !!subjectDecoded
        && subjectDecoded.kind === 'table' && referenceDecoded.kind === 'table'
        && (!axesEqual(subjectDecoded.x, referenceDecoded.x) || !axesEqual(subjectDecoded.y, referenceDecoded.y));

    /** What the visual draws: whose values, or the difference between them. */
    const shownRun: DecodedRun | null = (() => {
        if (showingReference && referenceRun) return referenceRun;
        if (!subjectRun) return null;
        if (!showingDiff || !referenceRun) return subjectRun;
        return {
            raw: subjectRun.raw,
            phys: subjectRun.phys.map((p, i) => {
                const r = referenceRun.phys[i];
                return p === null || r === null || r === undefined ? null : p - r;
            }),
        };
    })();

    /** The grid, as rows of numbers, with an undecodable cell as NaN. */
    const gridOf = (run: DecodedRun | null): number[][] | null => {
        if (!run || !isMap) return null;
        const flat = run.phys.map(p => (p === null ? NaN : p));
        const out: number[][] = [];
        for (let r = 0; r < rows; r++) out.push(flat.slice(r * cols, (r + 1) * cols));
        return out;
    };

    const xAxis = subjectDecoded?.kind === 'table' ? subjectDecoded.x : null;
    const yAxis = subjectDecoded?.kind === 'table' ? subjectDecoded.y : null;
    const xName = (item?.kind === 'table' ? item.x?.units : null) || 'X';
    const yName = (item?.kind === 'table' ? item.y?.units : null) || 'Y';
    const xTicks = axisTicks(xAxis, cols);
    const yTicks = axisTicks(yAxis, rows);
    const at = selected ?? { row: 0, col: 0 };
    const decimals = subjectDecoded ? decimalsOf(subjectDecoded) : null;
    const hex = item?.kind === 'constant' && item.outputType === 3;
    const units = subjectDecoded?.units && subjectDecoded.units !== '-' ? subjectDecoded.units : null;

    /** In 2-D the section is drawn ALONG one axis and pinned at the other. */
    const fixed = sectionAxis === 'x'
        ? { index: at.row, count: rows, label: yName, ticks: yTicks }
        : { index: at.col, count: cols, label: xName, ticks: xTicks };

    /**
     * WHICH cells a bulk step lands on: the ones on screen. In 2-D that is the one section being
     * drawn, so "×0.98" moves the line you are looking at and nothing else. Null means "all".
     */
    const scopeIndices: number[] | null = effectiveMode === '2d' && isMap
        ? (sectionAxis === 'x'
            ? Array.from({ length: cols }, (_, c) => at.row * cols + c)
            : Array.from({ length: rows }, (_, r) => r * cols + at.col))
        : null;
    const scopeLabel = scopeIndices
        ? `${fixed.label} ${fixed.ticks.label(fixed.index)} · ${scopeIndices.length} ${C.cells}`
        : C.scopeAllCells(String(rows * cols));

    /**
     * The selected cell, as a number you can type and a slider you can drag.
     *
     * The slider spans this table's OWN range, widened a fifth either way and clamped to what the
     * field can hold — a slider across a 16-bit field's whole domain moves thousands of counts per
     * pixel and is no use for the nudge this is for. The step is what one raw count is worth HERE,
     * measured, because a reciprocal scaling's step varies by orders of magnitude across a range.
     */
    const cellEdit = (() => {
        if (!item || selectedCell === null || !subjectRun || !onSubjectValues) return null;
        const value = subjectRun.phys[selectedCell];
        if (value === null || value === undefined) return null;
        const finite = subjectRun.phys.filter((p): p is number => p !== null);
        const lo = Math.min(...finite, value);
        const hi = Math.max(...finite, value);
        const pad = (hi - lo || Math.abs(value) || 1) * 0.2;
        let min = lo - pad;
        let max = hi + pad;
        try {
            const range = physicalRange(item);
            min = Math.max(min, range.min);
            max = Math.min(max, range.max);
        } catch { /* an uninvertible scaling has no range; the wider one stands */ }
        const raw = subjectRun.raw[selectedCell];
        let step = (max - min) / 100 || 1;
        try { step = physicalStep(item, raw) || step; } catch { /* as above */ }
        const where = isMap
            ? `${yName} ${yTicks.label(at.row)} · ${xName} ${xTicks.label(at.col)}`
            : isCurve ? `${xName} ${xTicks.label(selectedCell)}` : item.title;
        return { value, min, max, step, where, index: selectedCell };
    })();

    const visual = (() => {
        if (!item || !shownRun || !subjectDecoded) {
            return (
                <p className="p-2 text-[11px] text-slate-500">
                    {item ? t.noValuesForItem : t.pickAnItem}
                </p>
            );
        }

        if (effectiveMode === 'bits' && note?.bits && subjectDecoded.kind === 'constant') {
            return (
                <div className="p-2">
                    <BitField
                        raw={subjectDecoded.raw}
                        baseRaw={baseRaw ?? subjectDecoded.raw}
                        bits={item.kind === 'constant' ? item.data.bits : 16}
                        legend={note.bits}
                        onToggle={onToggleBit}
                        disabled={!editable}
                    />
                </div>
            );
        }

        if (isConstant) {
            return <ScalarReadout value={shownRun.phys[0]} raw={shownRun.raw[0]} units={showingDiff ? 'Δ' : units} />;
        }

        if (effectiveMode === 'shift' && subjectDecoded.kind === 'table') {
            return (
                <ShiftPointView
                    decoded={subjectDecoded}
                    pair={gearPair}
                    onPair={onGearPair}
                    selected={selected}
                    onSelect={c => setSelectedCell(c ? c.row * cols + c.col : null)}
                    onEdit={(r, c, physical) => onEditCell(r * cols + c, physical)}
                    changed={new Set((editedMask ?? []).flatMap((e, i) => (e ? [`${Math.floor(i / cols)}:${i % cols}`] : [])))}
                    lockedReason={editable ? null : (lockReason ?? t.viewReferenceHint)}
                    reference={referenceDecoded}
                    referenceLabel={comparing ? compareOptions.find(o => o.value === reference)?.label ?? null : null}
                />
            );
        }

        if (effectiveMode === 'map') {
            return (
                <CalibrationValueGrid
                    rows={rows}
                    cols={cols}
                    corner={`${yName}\\${xName}`}
                    xLabel={xTicks.label}
                    yLabel={yTicks.label}
                    run={shownRun}
                    // In diff mode the cells ARE the difference, so colouring them against the
                    // reference a second time would be the same subtraction drawn twice.
                    diffAgainst={showingDiff ? null : showingReference ? subjectRun : referenceRun}
                    editedMask={subject === 'tuned' && onSubjectValues ? editedMask : null}
                    mode={showingDiff ? 'signed' : referenceRun && comparing ? 'diff' : 'heat'}
                    selected={selectedCell}
                    onSelect={setSelectedCell}
                    onCommit={onEditCell}
                    readOnly={!editable}
                    decimals={decimals}
                    hex={hex}
                    rowGroups={note?.rowGroups ?? null}
                />
            );
        }

        if (effectiveMode === 'heat') {
            const grid = gridOf(shownRun);
            if (!grid) return null;
            return (
                <HeatField
                    grid={grid}
                    xLabel={xName}
                    yLabel={yName}
                    xLabels={xTicks.label}
                    yLabels={yTicks.label}
                    selected={selected}
                    onSelectCell={(r, c) => setSelectedCell(r * cols + c)}
                    signed={showingDiff}
                    width={box.w}
                    height={chartH}
                />
            );
        }

        // 2-D: one section through the map, or the curve itself.
        const slice = (run: DecodedRun | null): number[] | null => {
            if (!run) return null;
            const phys = run.phys.map(p => (p === null ? NaN : p));
            if (!isMap) return phys;
            return sectionAxis === 'x'
                ? phys.slice(at.row * cols, (at.row + 1) * cols)
                : Array.from({ length: rows }, (_, r) => phys[r * cols + at.col]);
        };
        const along = !isMap || sectionAxis === 'x' ? xTicks : yTicks;
        const indexInSection = !isMap ? selectedCell : sectionAxis === 'x' ? at.col : at.row;
        return (
            <SectionChart
                xs={along.xs}
                xLabels={along.label}
                subject={slice(shownRun)!}
                // In diff mode the single line IS the difference; a reference line beside it
                // would be a second answer to one question.
                reference={showingDiff || !comparing ? null : slice(showingReference ? subjectRun : referenceRun)}
                xLabel={isMap && sectionAxis === 'y' ? yName : xName}
                yLabel={showingDiff ? 'Δ' : (units ?? 'value')}
                selectedIndex={indexInSection}
                onSelectIndex={i => setSelectedCell(
                    !isMap ? i : sectionAxis === 'x' ? at.row * cols + i : i * cols + at.col,
                )}
                width={box.w}
                height={chartH}
            />
        );
    })();

    /** Enough digits to show a quantisation step without printing float noise. */
    const round = (v: number) => Number(v.toPrecision(8));

    const commitCell = () => {
        if (cellDraft === null) return;
        const parsed = Number(cellDraft);
        if (cellEdit && cellDraft.trim() !== '' && Number.isFinite(parsed)) {
            onEditCell(cellEdit.index, parsed);
        }
        setCellDraft(null);
    };

    const opButton = (label: string, enabled: boolean, onClick: () => void, title: string, tone = 'text-slate-300 hover:text-blue-400') => (
        <button
            onClick={onClick}
            disabled={!enabled}
            title={title}
            className={`h-[22px] rounded bg-slate-800 px-2 text-[9px] font-bold tracking-widest transition ${tone} disabled:pointer-events-none disabled:opacity-30`}
        >
            {label}
        </button>
    );

    return (
        // `@container`, because what the rows below have to fit is THIS PANE, not the viewport.
        // The pane is 38.2% of a wide screen and the whole of a narrow one, so a viewport
        // breakpoint gets it wrong from both sides.
        <div className="@container flex h-full min-h-0 flex-col">
            <CompareBar
                options={compareOptions}
                subject={subject}
                onSubject={v => onSubject(v as Variant)}
                reference={reference}
                onReference={v => onReference(v as Variant)}
                trailing={
                    // The balance stays put: the count has a width whether it has a number in it or
                    // not, so every digit it gains cannot push the icon along.
                    <button
                        onClick={onShowList}
                        disabled={!comparing}
                        title={comparing ? t.listTitle : t.sameVariant}
                        className="flex h-[24px] shrink-0 items-center gap-1 rounded px-2 text-slate-400 transition hover:text-slate-200 disabled:opacity-30"
                    >
                        <Scale className="size-3.5" />
                        <span className="w-[28px] text-right font-mono text-[10px] tabular-nums">
                            {diffCount === null ? '—' : diffCount}
                        </span>
                    </button>
                }
            />

            {/* The form, and the axis a section runs along. Reserved height. */}
            <div className="no-scrollbar flex h-[26px] flex-none items-center gap-3 overflow-x-auto whitespace-nowrap px-1">
                {/* A floor, because everything else in this row refuses to shrink and this is
                    the only thing that will. */}
                <span className="min-w-[64px] max-w-[38%] truncate font-mono text-[11px] font-bold text-slate-100">
                    {item ? item.title : '—'}
                </span>
                <div className="flex items-center gap-2">
                    <ModeButton on={effectiveMode === 'map'} onClick={() => onGraphMode('map')}>{C.formMap}</ModeButton>
                    <ModeButton on={effectiveMode === '2d'} disabled={!can2d} onClick={() => onGraphMode('2d')}>{C.form2d}</ModeButton>
                    <ModeButton on={effectiveMode === 'heat'} disabled={!canHeat} onClick={() => onGraphMode('heat')}>{C.formHeat}</ModeButton>
                    <ModeButton on={effectiveMode === 'shift'} disabled={!canShift} onClick={() => onGraphMode('shift')} title={canShift ? undefined : t.formShiftUnavailable}>{C.formShift}</ModeButton>
                    <ModeButton on={effectiveMode === 'bits'} disabled={!canBits} onClick={() => onGraphMode('bits')}>{C.formBits}</ModeButton>
                </div>
                {/* WHOSE numbers, next to what shape they are drawn in. Three readings, not two. */}
                {comparing && (
                    <div className="flex shrink-0 items-center gap-2">
                        <ModeButton on={view === 'subject'} onClick={() => onView('subject')} title={t.viewSubjectHint}>
                            {C.viewSubject}
                        </ModeButton>
                        <ModeButton on={view === 'delta'} onClick={() => onView('delta')} title={t.viewDeltaHint}>
                            {C.viewDelta}
                        </ModeButton>
                        <ModeButton on={view === 'reference'} onClick={() => onView('reference')} title={t.viewReferenceHint}>
                            {C.viewReference}
                        </ModeButton>
                    </div>
                )}
                {/* Only a map has two axes to section along; a curve has one, and offering the
                    choice there would be a control that does nothing. */}
                {effectiveMode === '2d' && isMap && (
                    <div className="flex items-center gap-2">
                        <span className="text-[8px] font-bold tracking-widest text-slate-600">{C.along}</span>
                        <ModeButton on={sectionAxis === 'x'} onClick={() => onSectionAxis('x')}>X</ModeButton>
                        <ModeButton on={sectionAxis === 'y'} onClick={() => onSectionAxis('y')}>Y</ModeButton>
                    </div>
                )}
                {/* Only what the lit button cannot say: which way round Δ subtracts, and what the
                    cell colour is measured against. Gated on the CONTAINER, like everything else. */}
                {comparing && (
                    <span className={`hidden whitespace-nowrap text-[8px] font-bold tracking-widest @min-[520px]:inline ${showingDiff ? 'text-blue-400' : 'text-slate-500'}`}>
                        {showingDiff ? C.bannerDelta : showingReference ? C.bannerReference : C.bannerSubject}
                    </span>
                )}
            </div>

            {/* One reserved caution line — it doubles as the empty spacer, so nothing below it
                moves when the caveat appears. */}
            <div className="h-[14px] flex-none truncate px-1 text-[9px] text-amber-400">
                {axesDiffer ? t.axesDiffer : ''}
            </div>

            <div ref={visualRef} className="min-h-0 flex-1 overflow-auto px-1">{visual}</div>

            {/* UNDER the picture, because it moves the picture: the axis the 2-D section is
                pinned at. Reserved so the ops bar never shifts. */}
            <div className="flex h-[20px] flex-none items-center gap-2 px-1">
                {effectiveMode === '2d' && isMap && item && (
                    <>
                        <span className="whitespace-nowrap font-mono text-[9px] text-slate-400">
                            {fixed.label} = {fixed.ticks.label(fixed.index)}
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={Math.max(0, fixed.count - 1)}
                            value={fixed.index}
                            onChange={e => {
                                const i = Number(e.target.value);
                                setSelectedCell(sectionAxis === 'x' ? i * cols + at.col : at.row * cols + i);
                            }}
                            className="h-1 min-w-0 flex-1 accent-blue-500"
                        />
                        <span className="whitespace-nowrap font-mono text-[9px] text-slate-600">
                            {fixed.index + 1}/{fixed.count}
                        </span>
                    </>
                )}
            </div>

            {/* ONE editing row, and WHAT it edits is the selection. A cell picked means you are
                working on that cell: a box for the value you know, a slider for the one you are
                looking for. None picked means the same step applied to every cell the current form
                draws. The label on the left names the target either way. Wraps below 420px, and the
                taller height is RESERVED at that size rather than switched on by the wrap. */}
            <div className="flex h-[34px] flex-none flex-wrap content-center items-center gap-1.5 border-t border-slate-900 px-1 @max-[420px]:h-[58px]">
                {cellEdit && editable && effectiveMode !== 'bits' ? (
                    <>
                        <button
                            onClick={() => setSelectedCell(null)}
                            title={t.clearCell}
                            className="flex max-w-[38%] shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[9px] text-slate-400 transition hover:text-slate-200"
                        >
                            <span className="truncate">{cellEdit.where}</span>
                            <span className="text-slate-600">✕</span>
                        </button>
                        <input
                            value={cellDraft ?? String(round(cellEdit.value))}
                            onChange={e => setCellDraft(e.target.value)}
                            onBlur={commitCell}
                            onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); commitCell(); }
                                else if (e.key === 'Escape') { e.preventDefault(); setCellDraft(null); }
                            }}
                            inputMode="decimal"
                            className="h-[22px] w-[72px] shrink-0 rounded bg-slate-800 px-2 text-right font-mono text-[10px] text-blue-400 outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                            type="range"
                            min={cellEdit.min}
                            max={cellEdit.max}
                            step={cellEdit.step}
                            value={cellEdit.value}
                            onChange={e => { setCellDraft(null); onEditCell(cellEdit.index, Number(e.target.value)); }}
                            className="h-1 min-w-0 flex-1 accent-blue-500"
                        />
                    </>
                ) : (
                    <div className={`flex items-center gap-1.5 ${editable && effectiveMode !== 'bits' ? '' : 'pointer-events-none opacity-40'}`}>
                        <span className="shrink-0 whitespace-nowrap font-mono text-[9px] text-slate-400">{scopeLabel}</span>
                        <button
                            onClick={() => setAmountSign(s => (s === 1 ? -1 : 1))}
                            title={t.signHint}
                            className={`size-[22px] rounded bg-slate-800 text-[11px] font-bold transition ${amountSign === -1 ? 'text-red-400' : 'text-slate-300'}`}
                        >
                            {amountSign === -1 ? '−' : '+'}
                        </button>
                        <input
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            inputMode="decimal"
                            placeholder="0.0"
                            className="h-[22px] w-[60px] rounded bg-slate-800 px-2 text-right font-mono text-[10px] text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500"
                        />
                        {opButton(C.bAdd, amountOk, () => onBulkOp({ kind: 'add', amount: amountNumber }, scopeIndices ?? undefined), t.addHint)}
                        {opButton(C.bScale, amountOk, () => onBulkOp({ kind: 'scale', amount: amountNumber }, scopeIndices ?? undefined), t.scaleHint)}
                    </div>
                )}
                {/* These act on the whole parameter either way, so they do not move when the
                    row's left half changes job. */}
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {opButton(C.copyRef, canCopyRef, onCopyRef, t.copyRefHint, 'text-indigo-400 hover:text-indigo-300')}
                    {opButton(C.bRevert, hasEdit, onRevert, t.revertHint, 'text-slate-400 hover:text-red-400')}
                </div>
            </div>
        </div>
    );
}
