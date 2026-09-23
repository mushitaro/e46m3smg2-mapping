'use client';

import React from 'react';
import { runTargetOf, type DecodedItem, type OverlayNote, type XdfItem } from '@tsunagi/xdf-engine';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { kindOf, shapeOf } from '@/lib/calibration/run';

/**
 * The INFO pane: what the selected thing IS — meta, the definition's own description, and what
 * this project knows about it that the definition does not. Modelled on the reference tuner's
 * `ParamInfo`, with its rule intact: the composed tier — this project's notes — is drawn as its
 * own visually distinct tier, because it is inference layered on a vendor file, not the file.
 */

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <span className="flex items-baseline gap-1">
            <span className="text-[8px] font-bold tracking-widest text-slate-600">{label}</span>
            <span className="font-mono text-[10px] text-slate-300">{children}</span>
        </span>
    );
}

function Heading({ children }: { children: React.ReactNode }) {
    return <div className="mb-0.5 text-[8px] font-bold tracking-widest text-slate-600">{children}</div>;
}

export function ParamInfo({
    item,
    decoded,
    note,
    added,
    lockReason,
    readers,
    onOpenFunction,
}: {
    item: XdfItem | null;
    decoded: DecodedItem | null;
    /** Structure the XDF cannot express: row groups, bit legends, prose. */
    note: OverlayNote | null;
    added: boolean;
    /** Why this cannot be edited, stated in place, or null. */
    lockReason: string | null;
    /**
     * The functions that refer to this item's bytes, or `null` when nothing was disassembled.
     *
     * `null` and `[]` are different answers and are shown differently. `null` means no program
     * was available — a 24 KiB window read carries no instructions. `[]` means the sweep ran and
     * found nothing pointing here, which is a fact about the item worth knowing before editing
     * it, and which the prose beside it is careful not to overstate: the sweep does not follow
     * computed jumps, so "no reader found" is not "never read".
     */
    readers: readonly { readonly at: number; readonly label: string }[] | null;
    onOpenFunction?: (at: number) => void;
}) {
    const { t, lang } = useLang();

    if (!item) {
        return <p className="p-3 text-[11px] text-slate-500">{t.pickAnItem}</p>;
    }

    const { data, scaling } = runTargetOf(item);
    const kind = kindOf(item);
    const { rows, cols } = shapeOf(item);
    const kindLabel = kind === 'map' ? C.kindMap : kind === 'curve' ? C.kindCurve : C.kindConstant;
    const units = decoded?.units ?? (item.kind === 'constant' ? item.units : item.z.units);
    const address = data.address;

    return (
        <div className="h-full space-y-3 overflow-y-auto p-3">
            {/* Header */}
            <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[13px] font-bold text-slate-100">{item.title}</span>
                <span className="text-[9px] text-slate-500">{kindLabel}</span>
                {added && (
                    <span className="rounded border border-dashed border-indigo-600 px-1 text-[8px] font-bold text-indigo-400">
                        ◇ {C.vAdded}
                    </span>
                )}
            </div>

            {/* Who reads it. Directly under the identity, because "does anything use this?" is
                the question that decides whether editing it can do anything at all. */}
            {readers !== null && (
                <div>
                    <Heading>{C.readBy}</Heading>
                    {readers.length === 0 ? (
                        <p className="text-[11px] leading-relaxed text-slate-500">{t.noReaderExplain}</p>
                    ) : (
                        <p className="font-mono text-[10px] leading-relaxed">
                            {readers.map(r => (
                                <button
                                    key={r.at}
                                    onClick={() => onOpenFunction?.(r.at)}
                                    className="mr-3 text-blue-400 transition hover:text-blue-300"
                                >
                                    {r.label}
                                </button>
                            ))}
                        </p>
                    )}
                </div>
            )}

            {/* Meta line */}
            <div className="flex flex-wrap items-center gap-3">
                {address !== null && (
                    <Meta label={C.infoAddr}>0x{address.toString(16).toUpperCase().padStart(5, '0')}</Meta>
                )}
                <Meta label={C.infoWidth}>
                    {data.bits}bit {data.signed ? C.infoSigned : C.infoUnsigned} {data.lsbFirst ? 'LE' : 'BE'}
                </Meta>
                {units && units !== '-' && <Meta label={C.infoUnits}>{units}</Meta>}
                <Meta label={C.infoScaling}>{scaling.math}</Meta>
                {kind !== 'constant' && <Meta label={C.infoDims}>{rows}×{cols}</Meta>}
            </div>

            {/* Lock notice — the reason a parameter cannot be edited, stated in place. */}
            {lockReason && (
                <p className="rounded border border-dashed border-amber-700 px-2 py-1 text-[10px] text-amber-400">
                    {lockReason}
                </p>
            )}

            {/* Categories */}
            {item.categories.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {item.categories.map(name => (
                        <span key={name} className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400">
                            {name}
                        </span>
                    ))}
                </div>
            )}

            {/* The definition's own description. */}
            {item.description && (
                <div>
                    <Heading>{C.infoDescription}</Heading>
                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300">{item.description}</p>
                </div>
            )}

            {/* This project's reading — its own tier: measured against a dump, not from the
                vendor file. The amber rule is the reference tuner's mark for exactly this class
                of text. */}
            {note?.prose && (
                <div className="border-l-2 border-amber-500 pl-3">
                    <div className="mb-0.5 text-[8px] font-bold tracking-widest text-amber-400">
                        ⌾ {C.infoNote}
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-300">{note.prose[lang]}</p>
                    <p className="mt-0.5 text-[9px] text-slate-600">{t.catalogNoteProvenance}</p>
                </div>
            )}

            {note?.rowGroups && (
                <div>
                    <Heading>{C.infoRows}</Heading>
                    {note.rowGroups.map(g => (
                        <p key={g.label} className="font-mono text-[10px] text-slate-300">
                            {g.label} <span className="text-slate-500">{g.rows[0]}–{g.rows[g.rows.length - 1]}</span>
                        </p>
                    ))}
                </div>
            )}

            {note?.bits && (
                <div>
                    <Heading>{C.infoBits}</Heading>
                    {note.bits.map(b => (
                        <p key={b.bit} className="flex items-baseline gap-2 text-[10px]">
                            <span className="w-9 shrink-0 font-mono text-slate-500">bit {b.bit}</span>
                            <span className={b.documented ? 'text-slate-300' : 'text-slate-500'}>
                                {lang === 'ja' ? b.labelJa : b.label}
                            </span>
                        </p>
                    ))}
                </div>
            )}

            {item.kind === 'table' && item.x?.labels && (
                <div>
                    <Heading>{C.infoAxisX}</Heading>
                    <p className="font-mono text-[10px] text-slate-400">{item.x.labels.filter(Boolean).join(' · ')}</p>
                </div>
            )}
            {item.kind === 'table' && item.y?.labels && (
                <div>
                    <Heading>{C.infoAxisY}</Heading>
                    <p className="font-mono text-[10px] text-slate-400">{item.y.labels.filter(Boolean).join(' · ')}</p>
                </div>
            )}
        </div>
    );
}
