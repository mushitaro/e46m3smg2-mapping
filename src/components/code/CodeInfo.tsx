'use client';

import React from 'react';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { DataList, DataRow, Field, MicroLabel, Pill, Provenance, humanName } from '@/components/ui';
import type { CodeFunction, CodeModel } from '@/lib/code/model';

/**
 * What is known about one function, and how firmly.
 *
 * The INFO pane next door answers "what is this number"; this answers "what is this code", and
 * the two questions have the same shape — a stack of facts, each with the thing that establishes
 * it. The rows here are all measurements from the sweep, so none of them needs hedging except
 * the calibration attributions, which get a badge apiece because their footing genuinely differs.
 */

const hex = (n: number, w = 5) => n.toString(16).toUpperCase().padStart(w, '0');

export function CodeInfo({
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

    if (!fn) {
        const { stats } = model;
        const pct = ((stats.coveredBytes / Math.max(1, EXEC_TOTAL)) * 100).toFixed(1);
        return (
            <div className="space-y-3">
                <MicroLabel>{C.coverage}</MicroLabel>
                <p className="text-[11px] leading-relaxed text-slate-500">
                    {t.sweepSummary(stats.funcs, stats.insns, pct)}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label={C.functions} value={stats.funcs.toLocaleString()} stacked />
                    <Field label={C.instructions} value={stats.insns.toLocaleString()} stacked />
                    <Field label={C.readBy} value={`${stats.itemsWithReader} / ${stats.itemsTotal}`} stacked />
                    <Field label={C.unnamedReads} value={model.unnamedReads.length.toLocaleString()} stacked />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <MicroLabel>{fn.label}</MicroLabel>
                {fn.returns ? <Pill tone="ok">{C.fnReturns}</Pill> : <Pill tone="caution">{C.fnNoReturn}</Pill>}
            </div>
            {fn.labelWhy && <Provenance>{fn.labelWhy}</Provenance>}

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label={C.entryPoint} value={`0x${hex(fn.at)}`} stacked />
                <Field label={C.instructions} value={fn.insnCount.toLocaleString()} stacked />
                <Field label={C.callers} value={String(fn.callers.length)} stacked />
                <Field label={C.callees} value={String(fn.calls.length)} stacked />
            </div>

            {fn.items.length > 0 && (
                <div>
                    <MicroLabel>{C.touches}</MicroLabel>
                    <DataList>
                        {fn.items.map(item => (
                            <DataRow
                                key={item.id}
                                name={humanName(item.title)}
                                onSelect={() => onPickItem(item.id)}
                                code={item.how === 'walks' ? '▦' : '·'}
                                trailing={
                                    <Pill tone={item.tier === 'stated' ? 'ok' : 'secondary'}>
                                        {item.tier === 'stated' ? C.stated : C.inferred}
                                    </Pill>
                                }
                            />
                        ))}
                    </DataList>
                    {fn.items.some(i => i.tier === 'inferred') && <Provenance>{t.readersInferred}</Provenance>}
                </div>
            )}

            {fn.unnamed.length > 0 && (
                <div>
                    <MicroLabel>{C.unnamedReads}</MicroLabel>
                    {/* Addresses in the calibration body that this function reads and that no
                        definition names. This is the list the coverage figure is about: 43.4% of
                        the programmed bytes have a name, and these are some of the rest, with a
                        reader attached — which is more than the coverage map can say. */}
                    <p className="font-mono text-[10px] leading-relaxed text-slate-500">
                        {fn.unnamed.slice(0, 24).map(a => `0x${hex(a)}`).join('  ')}
                        {fn.unnamed.length > 24 ? `  +${fn.unnamed.length - 24}` : ''}
                    </p>
                </div>
            )}

            {fn.callers.length > 0 && (
                <div>
                    <MicroLabel>{C.callers}</MicroLabel>
                    <p className="font-mono text-[10px] leading-relaxed">
                        {fn.callers.slice(0, 16).map(at => (
                            <button
                                key={at}
                                onClick={() => onOpen(at)}
                                className="mr-3 text-slate-500 transition hover:text-blue-400"
                            >
                                {model.funcs.get(at)?.label ?? `0x${hex(at)}`}
                            </button>
                        ))}
                        {fn.callers.length > 16 && <span className="text-slate-600">+{fn.callers.length - 16}</span>}
                    </p>
                </div>
            )}
        </div>
    );
}

/** Total bytes in the measured code regions, so coverage is a share of something real. */
const EXEC_TOTAL = 0x02c2a + 0x200 + (0x5fb90 - 0x40000) + (0x6f574 - 0x6d000) + (0x7bfea - 0x70000);
