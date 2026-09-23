'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decode, RESET_DPP, walk, type Insn } from '@tsunagi/c166';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { EmptyState } from '@/components/ui';
import { Code2 } from 'lucide-react';
import type { CodeFunction } from '@/lib/code/model';

/**
 * The function, read top to bottom.
 *
 * Only the rows on screen are in the DOM. The whole sweep of this car's image is 56,135
 * instructions across 942 functions, and the largest single function is over a thousand; every
 * entry is exactly one line tall, so which rows are visible is arithmetic rather than
 * measurement.
 *
 * ## The gap markers
 *
 * A recursive sweep does not produce a contiguous listing — it produces the bytes something
 * branched to. Between two decoded instructions there can be a hole: an island of data, a run
 * only reachable through a computed jump, padding. Those holes are drawn as an explicit
 * `── N bytes not reached ──` rule rather than closed up silently, because a listing that hides
 * them reads as a complete function and is not one. This is the same commitment the sweep makes
 * upstream: what was reached is shown, what was not is named.
 */

const ROW = 18;
const OVERSCAN = 14;

/** Address column, then bytes, then the instruction — the widths a hex dump has always used. */
const ADDR_W = 52;
const BYTES_W = 84;

interface Line {
    readonly kind: 'insn' | 'gap';
    readonly at: number;
    readonly insn?: Insn;
    readonly gapBytes?: number;
}

function bytesOf(image: Uint8Array, at: number, len: number): string {
    return [...image.slice(at, at + len)].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function CodeListing({
    image,
    fn,
    onOpen,
    focusAddress,
}: {
    image: Uint8Array;
    fn: CodeFunction | null;
    /** Following a call moves the subject; the tree and the picture follow. */
    onOpen: (at: number) => void;
    /** An address to reveal — used when a reader arrives here from a calibration item. */
    focusAddress?: number | null;
}) {
    const { t } = useLang();
    const scroller = useRef<HTMLDivElement>(null);
    const [range, setRange] = useState({ from: 0, to: 80 });

    /**
     * The instructions are re-walked here rather than carried in the model.
     *
     * The model holds structure — boundaries, call graph, cross-references — for nine hundred
     * functions; keeping every instruction of all of them costs about four megabytes of objects
     * to show at most one function's worth. Walking one function is under a millisecond.
     */
    const lines = useMemo<Line[]>(() => {
        if (!fn) return [];
        const insns = walk(image, fn.at).insns;
        const out: Line[] = [];
        let prevEnd: number | null = null;
        for (const insn of insns) {
            if (prevEnd !== null && insn.at > prevEnd) {
                out.push({ kind: 'gap', at: prevEnd, gapBytes: insn.at - prevEnd });
            }
            out.push({ kind: 'insn', at: insn.at, insn });
            prevEnd = insn.at + insn.len;
        }
        return out;
    }, [image, fn]);

    const measure = useCallback(() => {
        const el = scroller.current;
        if (!el) return;
        const first = Math.floor(el.scrollTop / ROW);
        const visible = Math.ceil(el.clientHeight / ROW);
        setRange({ from: Math.max(0, first - OVERSCAN), to: Math.min(lines.length, first + visible + OVERSCAN) });
    }, [lines.length]);

    useEffect(() => {
        measure();
        const el = scroller.current;
        if (!el) return;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [measure]);

    useEffect(() => {
        scroller.current?.scrollTo({ top: 0 });
        measure();
    }, [fn, measure]);

    useEffect(() => {
        if (focusAddress == null) return;
        const i = lines.findIndex(l => l.kind === 'insn' && l.insn?.data?.at === focusAddress);
        if (i >= 0) scroller.current?.scrollTo({ top: Math.max(0, i * ROW - 60) });
    }, [focusAddress, lines]);

    if (!fn) return <EmptyState Icon={Code2} label={C.formListing} hint={t.pickFunction} />;

    return (
        <div ref={scroller} onScroll={measure} className="min-h-0 flex-1 overflow-auto">
            <div style={{ height: lines.length * ROW }} className="relative">
                {lines.slice(range.from, range.to).map((line, i) => {
                    const top = (range.from + i) * ROW;
                    if (line.kind === 'gap') {
                        return (
                            <div key={top} style={{ top, height: ROW }} className="absolute inset-x-0 flex items-center gap-2 px-3">
                                <span className="h-px flex-1 bg-slate-800" />
                                <span className="font-mono text-[9px] text-slate-600">{t.notReached(line.gapBytes ?? 0)}</span>
                                <span className="h-px flex-1 bg-slate-800" />
                            </div>
                        );
                    }
                    const insn = line.insn!;
                    const jump = insn.target !== undefined && (insn.flow === 'call' || insn.flow === 'jmp' || insn.flow === 'cjmp');
                    const ref = insn.data?.at;
                    return (
                        <div
                            key={top}
                            style={{ top, height: ROW }}
                            className="absolute inset-x-0 flex items-center whitespace-pre px-3 font-mono text-[11px] leading-[18px]"
                        >
                            <span style={{ width: ADDR_W }} className="flex-none text-slate-600">
                                {insn.at.toString(16).toUpperCase().padStart(5, '0')}
                            </span>
                            <span style={{ width: BYTES_W }} className="flex-none text-slate-700">
                                {bytesOf(image, insn.at, insn.len)}
                            </span>
                            <span className={insn.undef ? 'text-red-400' : 'text-slate-300'}>{insn.text}</span>
                            {jump && insn.flow === 'call' && (
                                <button
                                    onClick={() => onOpen(insn.target!)}
                                    className="ml-3 text-[10px] text-blue-400 transition hover:text-blue-300"
                                >
                                    ↳
                                </button>
                            )}
                            {ref !== undefined && (
                                <span
                                    className="ml-3 text-[9px] text-slate-600"
                                    title={`${insn.data!.kind === 'indexed' ? C.walks : C.reads} · ${insn.data!.via}`}
                                >
                                    {insn.data!.kind === 'indexed' ? '▦' : '·'} {ref.toString(16).toUpperCase().padStart(5, '0')}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
