'use client';

import React, { useMemo, useState } from 'react';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import type { DiffEntry } from '@/lib/calibration/compare';
import { kindOf } from '@/lib/calibration/run';

/**
 * WHICH parameters differ between the two images the compare bar names — TunerPro's compare
 * window, in the inputs pane beside INFO and the hub. Ported from the reference tuner.
 *
 * The balance on the compare bar answers "how does THIS one differ" by redrawing the visual; this
 * answers "which ones do", which is the other half and the only way to reach a parameter you did
 * not already know about. Clicking a row makes that parameter the subject.
 */

const MARK = { constant: '●', curve: '◠', map: '▦' } as const;

function fmtDelta(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    return v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4).replace(/0+$/, '');
}

export function CalibrationDiffList({
    entries,
    editedIds,
    selectedId,
    canCopyReference,
    onSelect,
    onCopyRef,
    onRevert,
}: {
    /** Null when one of the two variants has no bytes to read yet. */
    entries: DiffEntry[] | null;
    editedIds: ReadonlySet<string>;
    selectedId: string | null;
    /** Copying only means something when the subject is TUNED and the reference is another image. */
    canCopyReference: boolean;
    onSelect: (uniqueId: string) => void;
    onCopyRef: (uniqueId: string) => void;
    onRevert: (uniqueId: string) => void;
}) {
    const { t } = useLang();
    const [filter, setFilter] = useState('');

    const shown = useMemo(() => {
        if (!entries) return [];
        const q = filter.trim().toLowerCase();
        return q ? entries.filter(e => e.item.title.toLowerCase().includes(q)) : entries;
    }, [entries, filter]);

    const copyable = canCopyReference ? shown.map(e => e.item.uniqueId) : [];

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* No title and no count here. The tab immediately above is called DIFF and carries
                the same number, and a panel that repeats its own tab spends a phone's width saying
                nothing. */}
            <div className="flex h-[30px] flex-none items-center gap-2 border-b border-slate-800 px-2">
                <input
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder={C.filter}
                    className="h-[20px] min-w-0 max-w-[200px] flex-1 rounded bg-slate-800 px-2 font-mono text-[10px] text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500"
                />
                {copyable.length > 0 && (
                    <button
                        onClick={() => copyable.forEach(onCopyRef)}
                        className="ml-auto shrink-0 text-[9px] font-bold tracking-widest text-indigo-400 transition hover:text-indigo-300"
                    >
                        {C.copyShown(copyable.length)}
                    </button>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {entries === null ? (
                    <p className="p-3 text-[11px] text-slate-500">{t.diffUnavailable}</p>
                ) : !shown.length ? (
                    <p className="p-3 text-[11px] text-slate-500">{t.diffEmpty}</p>
                ) : (
                    <table className="w-full border-collapse">
                        <tbody>
                            {shown.map(entry => {
                                const id = entry.item.uniqueId;
                                const isSelected = id === selectedId;
                                return (
                                    <tr
                                        key={id}
                                        className={`h-[26px] cursor-pointer border-b border-slate-900 transition ${isSelected ? 'bg-slate-800' : 'hover:bg-slate-800/50'}`}
                                        onClick={() => onSelect(id)}
                                    >
                                        <td className="w-4 px-2 text-[9px] text-blue-500/70">
                                            {MARK[kindOf(entry.item)]}
                                        </td>
                                        <td className={`w-[45%] max-w-0 truncate px-1 font-mono text-[10px] ${isSelected ? 'text-blue-400' : 'text-slate-300'}`}>
                                            {entry.item.title}
                                            {editedIds.has(id) && (
                                                <span className="ml-1.5 inline-block size-1.5 rounded-full bg-blue-400 align-middle" />
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-1 text-right font-mono text-[9px] text-slate-500">
                                            {entry.cellsChanged} {C.cells}
                                        </td>
                                        <td className="w-[62px] whitespace-nowrap px-1 text-right font-mono text-[9px] text-slate-400">
                                            Δ {fmtDelta(entry.maxDelta)}
                                        </td>
                                        <td className="w-[104px] whitespace-nowrap px-1 text-right">
                                            {canCopyReference && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); onCopyRef(id); }}
                                                    className="mr-2 text-[8px] font-bold tracking-widest text-indigo-400 transition hover:text-indigo-300"
                                                >
                                                    {C.copyRef}
                                                </button>
                                            )}
                                            {editedIds.has(id) && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); onRevert(id); }}
                                                    className="text-[8px] font-bold tracking-widest text-slate-500 transition hover:text-red-400"
                                                >
                                                    {C.bRevert}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            <p className="flex-none border-t border-slate-800 px-2 py-1 text-[9px] text-slate-600">
                {t.diffHint}
            </p>
        </div>
    );
}
