'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { EmptyState } from '@/components/ui';
import { Network } from 'lucide-react';
import type { CodeFunction, CodeModel } from '@/lib/code/model';

/**
 * One function's neighbourhood, drawn.
 *
 * Values travel **downward**: callers at the top hand control to the subject in the middle, which
 * hands it to its callees below. Calibration hangs off the right, because that is data coming in
 * rather than control going through, and it is the only thing on this picture drawn in the
 * interactive blue — everything else is machinery.
 *
 * Two link weights, and the difference is a claim about the code:
 *
 *   **solid** — the function indexes off this table's base, so it walks the whole table
 *   **dashed** — the address was formed from a page register this project inferred rather than
 *                watched being set, which is every reference in segments 4-7
 *
 * Dashed meaning inferred is the same convention the reference tuner's diagram uses, and it is
 * load-bearing here: 1,863 of the 1,863 calibration references in this image are inferred, and a
 * picture that drew them like proofs would be lying at every edge.
 */

const ROW = 22;
const BOX_H = 18;
const PAD = 14;

interface Placed {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly label: string;
    readonly at?: number;
    readonly kind: 'caller' | 'subject' | 'callee' | 'item';
    readonly title: string;
    readonly dashed?: boolean;
}

const FILL: Record<Placed['kind'], string> = {
    caller: 'fill-slate-900 stroke-slate-700',
    subject: 'fill-slate-900 stroke-blue-500',
    callee: 'fill-slate-900 stroke-slate-700',
    item: 'fill-slate-900 stroke-blue-500/70',
};
const TEXT: Record<Placed['kind'], string> = {
    caller: 'fill-slate-400',
    subject: 'fill-slate-200',
    callee: 'fill-slate-400',
    item: 'fill-[#26AEE4]',
};

/** Monospace advance at 10px, so a box can be sized without measuring the DOM. */
const CH = 6.0;
const widthOf = (s: string) => Math.max(64, Math.round(s.length * CH) + 16);

export function CodeNetwork({
    model,
    fn,
    onOpen,
    onPickItem,
}: {
    model: CodeModel;
    fn: CodeFunction | null;
    onOpen: (at: number) => void;
    onPickItem: (id: string) => void;
}) {
    const { t } = useLang();
    /**
     * The pane's own width, measured.
     *
     * It was a prop with a hardcoded 420 in it, and the result was visible the first time this
     * ran against a real function: an item box called `SPORT/RACE: Upshift Speed Low Thresholds`
     * ran off the right edge and was clipped rather than wrapped. The pane is 38.2% of whatever
     * the window is; nothing in this file can know that number, so it asks.
     */
    const box = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, []);

    const layout = useMemo(() => {
        if (!fn) return null;
        const label = (at: number) => model.funcs.get(at)?.label ?? `FN ${at.toString(16).toUpperCase()}`;
        // Both fans are capped. A dispatcher with sixty callers is a fact worth stating in a
        // number, not sixty boxes nobody can read; the row underneath says how many were left out.
        const CAP = 7;
        const callers = fn.callers.slice(0, CAP);
        const callees = fn.calls.slice(0, CAP);
        const items = fn.items.slice(0, CAP);

        const inner = Math.max(160, width - PAD * 2);
        const nodes: Placed[] = [];

        /**
         * Lay one band out, wrapping to as many lines as it needs.
         *
         * Boxes are capped at the pane's own width, so a long calibration title becomes an
         * ellipsis inside its box rather than a box that leaves the picture. Returns the height
         * consumed, because the band below has to start under whatever this one used.
         */
        const lay = (list: string[], y: number, kind: Placed['kind'], meta: (i: number) => Partial<Placed>): number => {
            if (list.length === 0) return 0;
            const widths = list.map(text => Math.min(widthOf(text), inner));
            const lines: number[][] = [[]];
            let used = 0;
            widths.forEach((w, i) => {
                const line = lines[lines.length - 1];
                if (line.length > 0 && used + 10 + w > inner) { lines.push([i]); used = w; }
                else { line.push(i); used += (line.length > 1 ? 10 : 0) + w; }
            });
            lines.forEach((line, row) => {
                const total = line.reduce((a, i) => a + widths[i], 0) + Math.max(0, line.length - 1) * 10;
                let x = PAD + Math.max(0, (inner - total) / 2);
                for (const i of line) {
                    nodes.push({ x, y: y + row * ROW, w: widths[i], label: list[i], kind, title: list[i], ...meta(i) });
                    x += widths[i] + 10;
                }
            });
            return lines.length * ROW;
        };

        const yCallers = PAD;
        const callerRows = Math.max(1, Math.ceil(callers.length * 84 / inner));
        const ySubject = yCallers + callerRows * ROW + ROW;
        const yCallees = ySubject + ROW * 2;
        const calleeRows = Math.max(1, Math.ceil(callees.length * 84 / inner));
        const yItems = yCallees + calleeRows * ROW + ROW;

        lay(callers.map(label), yCallers, 'caller', i => ({ at: callers[i], title: `0x${callers[i].toString(16).toUpperCase()}` }));
        lay([fn.label], ySubject, 'subject', () => ({ at: fn.at, title: fn.labelWhy || `0x${fn.at.toString(16).toUpperCase()}` }));
        lay(callees.map(label), yCallees, 'callee', i => ({ at: callees[i], title: `0x${callees[i].toString(16).toUpperCase()}` }));
        lay(
            items.map(i => i.title),
            yItems,
            'item',
            i => ({
                title: `${items[i].how === 'walks' ? C.walks : C.reads} · ${items[i].tier === 'stated' ? C.stated : C.inferred}`,
                dashed: items[i].tier !== 'stated',
            }),
        );

        const subject = nodes.find(n => n.kind === 'subject')!;
        const edges: { d: string; dashed: boolean }[] = [];
        for (const n of nodes) {
            if (n.kind === 'subject') continue;
            const from = n.kind === 'caller' ? { x: n.x + n.w / 2, y: n.y + BOX_H } : { x: subject.x + subject.w / 2, y: subject.y + BOX_H };
            const to = n.kind === 'caller' ? { x: subject.x + subject.w / 2, y: subject.y } : { x: n.x + n.w / 2, y: n.y };
            const mid = (from.y + to.y) / 2;
            edges.push({ d: `M${from.x} ${from.y} C${from.x} ${mid} ${to.x} ${mid} ${to.x} ${to.y}`, dashed: !!n.dashed });
        }

        return {
            nodes,
            edges,
            more: {
                callers: fn.callers.length - callers.length,
                callees: fn.calls.length - callees.length,
                items: fn.items.length - items.length,
            },
            height: yItems + Math.max(1, items.length) * ROW + PAD,
        };
    }, [fn, model, width]);

    return (
        <div ref={box} className="h-full min-h-0 flex-1 overflow-auto">
            {!fn || !layout ? (
                <EmptyState Icon={Network} label={C.formNetwork} hint={t.pickFunction} />
            ) : (
            <svg width={Math.max(width, 200)} height={layout.height} className="font-mono">
                <defs>
                    <marker id="code-tick" viewBox="0 0 7 7" refX={6} refY={3.5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
                        <path d="M0 0.5 L 7 3.5 L 0 6.5 z" fill="context-stroke" />
                    </marker>
                </defs>
                {layout.edges.map((e, i) => (
                    <path
                        key={i}
                        d={e.d}
                        className={`fill-none ${e.dashed ? 'stroke-slate-800' : 'stroke-slate-600'}`}
                        strokeDasharray={e.dashed ? '3 3' : undefined}
                        markerEnd="url(#code-tick)"
                    />
                ))}
                {layout.nodes.map((n, i) => (
                    <g
                        key={i}
                        className="cursor-pointer"
                        onClick={() => {
                            if (n.kind === 'item') {
                                const hit = fn.items.find(it => it.title === n.label);
                                if (hit) onPickItem(hit.id);
                            } else if (n.at !== undefined && n.kind !== 'subject') onOpen(n.at);
                        }}
                    >
                        <title>{n.title}</title>
                        <rect x={n.x} y={n.y} width={n.w} height={BOX_H} rx={3} className={FILL[n.kind]} />
                        <text x={n.x + n.w / 2} y={n.y + 12.5} textAnchor="middle" className={`${TEXT[n.kind]} text-[10px]`}>
                            {n.label.length * CH > n.w - 10 ? `${n.label.slice(0, Math.floor((n.w - 16) / CH))}…` : n.label}
                        </text>
                    </g>
                ))}
            </svg>
            )}
        </div>
    );
}
