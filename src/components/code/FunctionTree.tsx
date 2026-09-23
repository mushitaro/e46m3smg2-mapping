'use client';

import React, { useMemo, useState } from 'react';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { EmptyState, SearchInput } from '@/components/ui';
import { SearchX } from 'lucide-react';
import type { CodeFunction, CodeModel } from '@/lib/code/model';

/**
 * The functions, grouped the way the hardware groups them.
 *
 * Same shape as the calibration tree next door — two levels, guides down the left, one row per
 * thing you can open — because it is the same reader looking at the same image from the other
 * side. The grouping is by **segment**, which is not a filing decision: §5.1 established the code
 * regions by measuring which segment each one predominantly calls into, so segment 5 is a fact
 * about where this code lives rather than a folder someone chose.
 *
 * A function that touches calibration carries a blue count. That is the whole point of the view
 * — it is how a reader gets from "I want to change the 2-3 upshift" to a piece of code — so it is
 * the one thing besides the name that earns space on the row.
 */

/** Segments, in the order §5.1 lists them, with what that section says each one is. */
const SEGMENTS: readonly { readonly seg: number; readonly why: string }[] = [
    { seg: 0, why: 'reset, traps, shared runtime' },
    { seg: 1, why: 'second vector table' },
    { seg: 4, why: 'code' },
    { seg: 5, why: 'code' },
    { seg: 6, why: 'code' },
    { seg: 7, why: 'code' },
];

function Row({
    fn,
    selected,
    onSelect,
    indent,
    isLast,
}: {
    fn: CodeFunction;
    selected: boolean;
    onSelect: (at: number) => void;
    indent: number;
    isLast: boolean;
}) {
    const touches = fn.items.length;
    return (
        <button
            onClick={() => onSelect(fn.at)}
            className={`flex h-[26px] w-full items-center gap-2 pr-2 text-left transition ${
                selected ? 'bg-blue-500/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
            style={{ paddingLeft: indent }}
        >
            {indent > 0 && <span className="select-none font-mono text-[10px] text-slate-700">{isLast ? '└' : '├'}</span>}
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{fn.label}</span>
            {touches > 0 && (
                <span className="flex-none font-mono text-[9px] text-blue-400" title={fn.items.map(i => i.title).join('\n')}>
                    {touches}
                </span>
            )}
            <span className="w-[34px] flex-none text-right font-mono text-[9px] text-slate-600">{fn.insnCount}</span>
        </button>
    );
}

export function FunctionTree({
    model,
    selected,
    onSelect,
}: {
    model: CodeModel;
    selected: number | null;
    onSelect: (at: number) => void;
}) {
    const { t } = useLang();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([4, 5, 7]));

    const groups = useMemo(() => {
        const byteSeg = (at: number) => at >> 16;
        const buckets = new Map<number, CodeFunction[]>();
        for (const fn of model.ordered) {
            const seg = byteSeg(fn.at);
            const list = buckets.get(seg) ?? [];
            list.push(fn);
            buckets.set(seg, list);
        }
        return [...buckets].sort((a, b) => a[0] - b[0]);
    }, [model]);

    /**
     * Search covers the label AND the titles of everything the function touches, so "upshift"
     * finds the code even though no function is called that. Matching only the label would make
     * the box useless here: nine hundred of these are named after their own address.
     */
    const found = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        return model.ordered.filter(
            fn =>
                fn.label.toLowerCase().includes(q) ||
                fn.at.toString(16).includes(q.replace(/^0x/, '')) ||
                fn.items.some(i => i.title.toLowerCase().includes(q)),
        );
    }, [model, query]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-none border-b border-slate-900 px-3 py-2">
                <SearchInput value={query} onChange={setQuery} placeholder={t.searchCode} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {found ? (
                    found.length === 0 ? (
                        <EmptyState Icon={SearchX} label={C.search} hint={t.noMatches} />
                    ) : (
                        found.map((fn, i) => (
                            <Row key={fn.at} fn={fn} selected={fn.at === selected} onSelect={onSelect} indent={0} isLast={i === found.length - 1} />
                        ))
                    )
                ) : (
                    groups.map(([seg, list]) => {
                        const isOpen = open.has(seg);
                        const why = SEGMENTS.find(s => s.seg === seg)?.why;
                        return (
                            <div key={seg}>
                                <button
                                    onClick={() =>
                                        setOpen(prev => {
                                            const next = new Set(prev);
                                            if (next.has(seg)) next.delete(seg); else next.add(seg);
                                            return next;
                                        })
                                    }
                                    className="flex h-[26px] w-full items-center gap-2 px-3 text-left text-slate-300 transition hover:bg-slate-900"
                                    title={why}
                                >
                                    <span className="select-none font-mono text-[10px] text-slate-600">{isOpen ? '▾' : '▸'}</span>
                                    <span className="flex-1 text-[10px] font-bold uppercase tracking-widest">
                                        {C.segment} {seg}
                                    </span>
                                    <span className="font-mono text-[9px] text-slate-600">{list.length}</span>
                                </button>
                                {isOpen &&
                                    list.map((fn, i) => (
                                        <Row key={fn.at} fn={fn} selected={fn.at === selected} onSelect={onSelect} indent={22} isLast={i === list.length - 1} />
                                    ))}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
