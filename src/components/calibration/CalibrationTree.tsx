'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { XdfItem } from '@tsunagi/xdf-engine';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { groupItems } from '@/lib/itemGroups';
import { searchItems } from '@/lib/itemSearch';
import { kindOf, type ItemKind } from '@/lib/calibration/run';

/**
 * The tree, as the reference tuner draws it.
 *
 * PARAMETERS is the factory's own category partition, and inside each category the three storage
 * kinds — a constant, a curve, a map are different things to open, and GEAR LOGIC holds all
 * three. So the nesting is category → kind → symbol, sorted at every level.
 *
 * Collapses to a 28 px rail rather than vanishing — the pane edge never moves. It sits to the
 * RIGHT of the picture, on the side the picture's inputs come from, and the rail's chevron points
 * the way the panel will go.
 */

/** Storage kinds in display order. Labels are the instrument's own vocabulary, one English form. */
const KINDS: Record<ItemKind, { label: string; mark: string }> = {
    constant: { label: C.kindConstant, mark: '●' },
    curve: { label: C.kindCurve, mark: '◠' },
    map: { label: C.kindMap, mark: '▦' },
};

const NodeRow = React.memo(function NodeRow({
    item,
    indent,
    isLast,
    selected,
    edited,
    added,
    onSelect,
    scrollTo,
}: {
    item: XdfItem;
    /** Left padding in px; 0 draws no guide glyph (the flat search list). */
    indent: number;
    isLast: boolean;
    selected: boolean;
    edited: boolean;
    /** Invented by this project — badged so it is never mistaken for a vendor item. */
    added: boolean;
    onSelect: (id: string) => void;
    scrollTo: boolean;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (scrollTo) ref.current?.scrollIntoView({ block: 'nearest' });
    }, [scrollTo]);
    return (
        <button
            ref={ref}
            onClick={() => onSelect(item.uniqueId)}
            style={{ paddingLeft: indent }}
            className={`flex h-[22px] w-full items-center gap-1 pr-1 text-left transition min-[900px]:h-[20px] ${selected ? 'bg-slate-800 text-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
        >
            {indent > 0 && (
                <span className="select-none whitespace-pre font-mono text-[9px] text-slate-700">
                    {isLast ? '└─▸' : '├─▸'}
                </span>
            )}
            <span className="text-[9px] text-blue-500/70">{KINDS[kindOf(item)].mark}</span>
            <span className="truncate font-mono text-[10px]">{item.title}</span>
            {added && <span className="shrink-0 font-mono text-[9px] text-indigo-400">◇</span>}
            {edited && <span className="size-1.5 shrink-0 rounded-full bg-blue-400" />}
        </button>
    );
});

export function CalibrationTree({
    items,
    categories,
    selectedId,
    editedIds,
    addedIds,
    onSelect,
    collapsed,
    onToggleCollapse,
}: {
    items: readonly XdfItem[];
    /** Category → count, most-populous first; the order the groups take. */
    categories: readonly (readonly [string, number])[];
    selectedId: string | null;
    editedIds: ReadonlySet<string>;
    addedIds: ReadonlySet<string>;
    onSelect: (id: string) => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
}) {
    const { t } = useLang();
    const [query, setQuery] = useState('');
    const [openCats, setOpenCats] = useState<ReadonlySet<string>>(new Set());
    /** Open kind groups, keyed `${category}:${kind}` — the same kind can be open under one
     *  category and shut under another. */
    const [openKinds, setOpenKinds] = useState<ReadonlySet<string>>(new Set());

    const groups = useMemo(() => groupItems(items, categories, C.uncategorised), [items, categories]);

    /** Ranked, not filtered: exact title, then prefix, then substring, then description only. */
    const results = useMemo(() => {
        if (!query.trim()) return null;
        return searchItems(items, query).map(h => h.item).slice(0, 100);
    }, [items, query]);

    // A selection made elsewhere (the diff list, a change row) opens the branches holding it.
    // Render-time adjustment on a genuine selection change only.
    const [prevSelected, setPrevSelected] = useState<string | null>(null);
    if (selectedId !== prevSelected) {
        setPrevSelected(selectedId);
        const item = selectedId ? items.find(i => i.uniqueId === selectedId) : undefined;
        // A query left in the box would filter the selection out — the list would come forward
        // holding nothing. Cleared only when the selection is not already among the results, so
        // clicking one result does not collapse the list you are working through.
        if (selectedId && results && !results.some(r => r.uniqueId === selectedId)) setQuery('');
        if (item) {
            const cat = item.categories[0] ?? C.uncategorised;
            const key = `${cat}:${kindOf(item)}`;
            if (!openCats.has(cat)) setOpenCats(new Set([...openCats, cat]));
            if (!openKinds.has(key)) setOpenKinds(new Set([...openKinds, key]));
        }
    }

    if (collapsed) {
        return (
            <div className="flex w-[28px] flex-none flex-col items-center border-l border-slate-900 pt-1">
                <button
                    onClick={onToggleCollapse}
                    className="p-1 text-slate-500 transition hover:text-slate-300"
                    title={C.tree}
                >
                    {/* The rail is at the right edge, so it opens leftwards. */}
                    <ChevronsLeft className="size-3.5" />
                </button>
                <span className="mt-2 text-[9px] font-bold tracking-widest text-slate-600 [writing-mode:vertical-rl]">
                    {C.tree}
                </span>
            </div>
        );
    }

    const toggle = <T,>(set: ReadonlySet<T>, key: T): ReadonlySet<T> => {
        const next = new Set(set);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
    };

    // Full width below 900px, where it is the only thing on screen. `min-w-[240px]` against a
    // 360px viewport is what left the picture 88px in the reference app: the min-width is a
    // promise about a COLUMN, and on a phone this is not a column.
    return (
        <div className="flex min-h-0 w-full flex-none flex-col border-l border-slate-900 min-[900px]:w-[38.2%] min-[900px]:min-w-[240px] min-[900px]:max-w-[320px]">
            <div className="flex h-[34px] flex-none items-center gap-1 border-b border-slate-900 px-2">
                {/* The control sits on the edge that moves — the one facing the picture — and
                    points the way the panel will go. */}
                <button
                    onClick={onToggleCollapse}
                    className="shrink-0 p-1 text-slate-500 transition hover:text-slate-300"
                    title={C.tree}
                >
                    <ChevronsRight className="size-3.5" />
                </button>
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={C.search}
                    className="h-[22px] min-w-0 flex-1 rounded bg-slate-800 px-2 font-mono text-[10px] text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500"
                />
            </div>

            <div className="flex h-[26px] flex-none items-center gap-4 border-b border-slate-900 px-2">
                <button
                    className="flex h-full items-center gap-1.5 border-b-2 border-blue-400 text-[10px] font-bold uppercase tracking-widest text-blue-400"
                >
                    {C.parameters}
                    <span className="font-mono text-[9px] text-slate-600">{items.length}</span>
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {results ? (
                    <>
                        <div className="px-2 py-1 text-[9px] font-bold tracking-widest text-slate-600">
                            {C.results} · {results.length}
                        </div>
                        {results.length === 0 && (
                            <p className="px-2 py-2 text-[10px] text-slate-500">{t.noItemsMatch}</p>
                        )}
                        {results.map(item => (
                            <NodeRow
                                key={item.uniqueId}
                                item={item}
                                indent={0}
                                isLast={false}
                                selected={item.uniqueId === selectedId}
                                edited={editedIds.has(item.uniqueId)}
                                added={addedIds.has(item.uniqueId)}
                                onSelect={onSelect}
                                scrollTo={false}
                            />
                        ))}
                    </>
                ) : (
                    groups.map(cat => {
                        const open = openCats.has(cat.name);
                        return (
                            <div key={cat.name}>
                                <button
                                    onClick={() => setOpenCats(prev => toggle(prev, cat.name))}
                                    className="flex h-[22px] w-full items-center gap-1.5 px-2 text-left text-[10px] text-slate-300 transition hover:text-slate-100"
                                >
                                    <span className="w-2 text-slate-500">{open ? '▾' : '▸'}</span>
                                    <span className="flex-1 truncate">{cat.name}</span>
                                    <span className="font-mono text-[9px] text-slate-600">{cat.count}</span>
                                </button>
                                {open && cat.kinds.map(group => {
                                    const key = `${cat.name}:${group.kind}`;
                                    const kindOpen = openKinds.has(key);
                                    return (
                                        <div key={key}>
                                            <button
                                                onClick={() => setOpenKinds(prev => toggle(prev, key))}
                                                className="flex h-[20px] w-full items-center gap-1.5 pl-5 pr-2 text-left text-[9px] font-bold tracking-widest text-slate-500 transition hover:text-slate-300"
                                            >
                                                <span className="w-2">{kindOpen ? '▾' : '▸'}</span>
                                                <span className="flex-1 truncate">{KINDS[group.kind].label}</span>
                                                <span className="font-mono text-slate-600">{group.members.length}</span>
                                            </button>
                                            {kindOpen && group.members.map((item, i) => (
                                                <NodeRow
                                                    key={item.uniqueId}
                                                    item={item}
                                                    indent={28}
                                                    isLast={i === group.members.length - 1}
                                                    selected={item.uniqueId === selectedId}
                                                    edited={editedIds.has(item.uniqueId)}
                                                    added={addedIds.has(item.uniqueId)}
                                                    onSelect={onSelect}
                                                    scrollTo={item.uniqueId === selectedId}
                                                />
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
