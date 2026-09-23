'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The primitives that carry the ///M border rule.
 *
 * ## The rule
 *
 * A border is a RULE BETWEEN REGIONS, never an OUTLINE AROUND A THING.
 *
 * Allowed, and nothing else:
 *   - one-sided hairlines that separate — `border-b` under a bar, `border-r`
 *     between the two columns, `divide-y` between list rows
 *   - exactly one outline per FLOATING surface (modal, popover), because it is
 *     detached from the page and needs an edge
 *   - the tab underline (`border-b-2`), which is a position indicator
 *   - the hub ring, which is a state indicator
 *   - a dashed drop zone, because a drop target genuinely is an area
 *
 * Everything else — panels, list rows, inputs, pills, buttons — is separated by
 * SURFACE (`bg-slate-800`, `bg-<role>/15`) or by SPACE. The reference app has
 * not a single outlined button anywhere, and it reads as an instrument for
 * exactly that reason: outlines stack, and three levels of them turn a dense
 * data view into a stack of cards.
 *
 * These components exist so the rule lives in one file instead of in the
 * discipline of whoever writes the next call site. Reach for them first.
 */

/**
 * ## The type ramp, and why there are only two steps
 *
 * Micro-labels shipped at 8, 9, 10 and 11px, bold and not, in slate-400/500/600,
 * as `div`, `span`, `summary` and `p`. Four sizes cannot encode three levels of
 * importance; they encode "four people wrote this". So:
 *
 *   LABEL — 10px, bold, uppercase, tracked. Chrome: headings, buttons, pills,
 *           tabs, facet chips. Everything that names a thing.
 *   DATA  — 11px / 12px, mono where it came from a machine. The thing itself.
 *
 * There is no third size. If something needs to recede, it changes COLOUR
 * (slate-500 → slate-600), because a size step and a colour step doing the same
 * job is how you get eight of them.
 */
export const LABEL = 'text-[10px] font-bold uppercase tracking-widest';

/**
 * The wordmark. **One element in the whole app** — the `<h1>` in the header.
 *
 * This is NOT a third micro-label size, and nothing else may take it. The ///M
 * type scale has always had two chrome steps — `text-sm` for the app / section
 * title and `text-[10px]` for tab and control labels — and only the second was
 * written down here. So the header title, which had no token to reach for,
 * reached for `LABEL` and shipped at 10px: the app's own name rendered at the
 * size of a facet chip, four points under the reference app's.
 *
 * Encoded rather than remembered, for the same reason as everything else in this
 * file. `tracking-widest` at 14px is 1.4px, which is what makes the mark read as
 * a title without being large — the weight and the tracking carry the hierarchy,
 * not the point size.
 */
export const WORDMARK = 'text-sm font-bold uppercase tracking-widest';

/**
 * The verb inside the hub ring. **One element**, like WORDMARK — the other end
 * of the same scale.
 *
 * 8px is the ///M "tiny tag" step and it is what the reference tool sets on this
 * exact control. At LABEL's 10px the verb crowded a 72px circle that also
 * carries a 18px icon; the ring is read by its shape and its colour from across
 * a garage, and the word is confirmation once you are already looking at it.
 *
 * Only legible because these verbs are short and English — CONNECT, READ, RUN,
 * RECORD. Do not put a sentence here.
 */
export const HUB_LABEL = 'text-[8px] font-bold uppercase tracking-widest';

/**
 * Text a person can read, resolved for the current language.
 *
 * This is a brand, not a description. `DataRow`'s primary slot takes only a
 * `HumanName`, so an SGBD identifier cannot drift into it — putting one there
 * requires calling `humanName()` explicitly, which is a single greppable
 * assertion rather than a mistake anyone can make in passing.
 *
 * The mistake was not hypothetical: eight of the app's ten row types had the
 * identifier in the bright monospace slot that never truncates, and the
 * translated name in the dim one that truncates first.
 *
 * Minted here and by the catalogue resolvers (`label()`, `text()` in
 * `lib/ecuCatalog.ts`) — nowhere else.
 */
export type HumanName = string & { readonly __human: unique symbol };

export function humanName(s: string): HumanName {
    return s as HumanName;
}

type Tone = 'neutral' | 'primary' | 'danger' | 'destructive' | 'caution' | 'secondary' | 'ok';

const TEXT: Record<Tone, string> = {
    neutral: 'text-slate-500 hover:text-slate-300',
    primary: 'text-blue-400 hover:text-blue-300',
    // Muted until you reach for it. For incidental destructive controls
    // (disconnect, discard) that sit among ordinary ones.
    danger: 'text-slate-500 hover:text-red-400',
    // Steady red. Only for the confirm inside a gate, where being destructive is
    // the entire point of the control and hiding it would be dishonest.
    destructive: 'text-red-400 hover:text-red-300',
    caution: 'text-slate-500 hover:text-amber-400',
    secondary: 'text-indigo-400 hover:text-indigo-300',
    ok: 'text-emerald-400 hover:text-emerald-300',
};

/**
 * The default button: text, uppercase, tracked, semantic-coloured, no box.
 *
 * Destructive ones sit muted and only turn red on hover — danger should not
 * shout until you reach for it.
 */
export function TextButton({
    children,
    onClick,
    // Primary by default: a text button is a CONTROL and has to look pressable
    // at rest. At the previous slate-500 default, EXPORT CSV — the only thing
    // you can do with a finished run — was the exact colour of the inactive tab
    // labels beside it and read as a status word. `neutral` stays available for
    // genuinely secondary actions like CANCEL.
    tone = 'primary',
    Icon,
    disabled,
    title,
    className = '',
    ...rest
}: {
    children: React.ReactNode;
    onClick?: () => void;
    tone?: Tone;
    Icon?: LucideIcon;
    disabled?: boolean;
    title?: string;
    className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'title' | 'className'>) {
    return (
        <button
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={title}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap ${LABEL} transition-colors disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:text-slate-600 ${TEXT[tone]} ${className}`}
            {...rest}
        >
            {Icon && <Icon className="size-3 shrink-0" />}
            {children}
        </button>
    );
}

const FILL: Record<Tone, string> = {
    neutral: 'bg-slate-800 text-slate-400',
    primary: 'bg-blue-500/15 text-blue-400',
    danger: 'bg-red-500/15 text-red-400',
    destructive: 'bg-red-500/15 text-red-400',
    caution: 'bg-amber-500/15 text-amber-400',
    secondary: 'bg-indigo-500/15 text-indigo-400',
    ok: 'bg-emerald-500/15 text-emerald-400',
};

/** A tag. Tint fill, never an outline — outlined pills are what turn a row of
 *  metadata into a row of tiny boxes. */
export function Pill({ children, tone = 'neutral', title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
    return (
        <span
            title={title}
            className={`inline-block shrink-0 rounded px-1.5 py-0.5 ${LABEL} ${FILL[tone]}`}
        >
            {children}
        </span>
    );
}

/**
 * A filter chip: same tint language as Pill, but pressable.
 *
 * `count` is not decoration. With 323 jobs behind a default filter, the number
 * beside a facet is the only thing that tells a reader there is more here than
 * they are being shown — and it counts the WHOLE catalogue, not the filtered
 * view, or hidden things would be hidden twice.
 */
export function Chip({
    children,
    active,
    count,
    onClick,
    title,
    className = '',
}: {
    children: React.ReactNode;
    active: boolean;
    count?: number;
    onClick: () => void;
    title?: string;
    /** For callers that need a bigger hit area than a facet row wants. */
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            title={title}
            className={`shrink-0 rounded px-2 py-0.5 ${LABEL} transition-colors ${
                active ? 'bg-blue-500/15 text-blue-400' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
            } ${className}`}
        >
            {children}
            {count !== undefined && (
                <span className={`ml-1.5 font-mono tabular-nums ${active ? 'text-blue-400/60' : 'text-slate-600'}`}>
                    {count}
                </span>
            )}
        </button>
    );
}

/** Raised surface, focus ring instead of a border colour change — a border that
 *  only appears on focus is a 1px layout shift on every click. */
export function SearchInput({
    value,
    onChange,
    placeholder,
    className = '',
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    className?: string;
}) {
    return (
        <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`rounded bg-slate-800 px-2 py-1 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500/60 ${className}`}
        />
    );
}

/** The micro-label above a block. Sits on its own line; no rule under it — the
 *  size and colour step is already the separation. */
export function MicroLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`${LABEL} text-slate-500 ${className}`}>{children}</div>;
}

/**
 * Render `**bold**` in authored safety copy.
 *
 * One marker, one meaning, and deliberately not a markdown parser: a stray
 * asterisk turning into an italic run inside a caution is not a class of bug
 * worth accepting for the convenience.
 *
 * It lives here because three different places render authored text now — the
 * caution callout, a step's absence sentence, and the DSC stop's provenance
 * note — and a second copy would drift.
 */
export function emphasise(text: string): React.ReactNode {
    return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
        i % 2 === 1 ? (
            <strong key={i} className="font-bold text-amber-300">
                {part}
            </strong>
        ) : (
            part
        ),
    );
}

/** A recessed block for machine output (raw idents, planned telegrams). Surface,
 *  not outline. */
export function Well({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`rounded bg-slate-800/40 p-2 ${className}`}>{children}</div>;
}

/**
 * A titled block, with its count and its own actions.
 *
 * There were eight hand-built versions of this shape across two files, spaced
 * mb-3 / mb-4 / mb-6 / mt-6+pt-4 and titled four different ways. The spacing
 * belongs to the CONTAINER — a `flex flex-col gap-6` column — so this component
 * deliberately carries no outer margin: a block that spaces itself cannot be
 * rearranged without re-tuning every neighbour.
 */
export function Section({
    title,
    count,
    actions,
    note,
    children,
}: {
    title: React.ReactNode;
    count?: number;
    actions?: React.ReactNode;
    /** One line under the title, for a caveat about the whole block. */
    note?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section>
            <div className="flex min-h-[20px] items-baseline justify-between gap-3">
                <MicroLabel>{title}</MicroLabel>
                <div className="flex shrink-0 items-baseline gap-3">
                    {actions}
                    {count !== undefined && (
                        <span className="font-mono text-[11px] tabular-nums text-slate-600">{count}</span>
                    )}
                </div>
            </div>
            {note && <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-slate-500">{note}</p>}
            <div className="mt-1.5">{children}</div>
        </section>
    );
}

/**
 * The one file input: a dashed drop area that is also the click target.
 *
 * `components.md` -> DropZone. This app had a `CHOOSE .BIN` text button in a section header AND,
 * underneath it, a 160px empty placeholder reading `AWAITING BINARY FILE` — while the WORKSPACE
 * column one pane across showed *the same placeholder with the same words*. Two identical
 * statements on one screen, and neither of them was droppable.
 *
 * One component now: it states what it wants, accepts a drop or a click, and disappears the moment
 * there is a workspace — so the screen never says "awaiting" twice, or at all once something is
 * loaded.
 *
 * The input is a transparent overlay rather than a sibling, which is what makes the whole area a
 * click target without a `<label for>` dance.
 */
export function DropZone({
    Icon,
    label,
    hint,
    accept,
    onFile,
}: {
    Icon: LucideIcon;
    /** Instrument shorthand — what this wants. */
    label: string;
    /** One line in the reader's language. */
    hint?: string;
    accept: string;
    onFile: (file: File) => void;
}) {
    const [over, setOver] = React.useState(false);
    return (
        <div
            onDragOver={event => { event.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={event => {
                event.preventDefault();
                setOver(false);
                const file = event.dataTransfer.files?.[0];
                if (file) onFile(file);
            }}
            className={`relative flex min-h-[128px] flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors ${
                over ? 'border-blue-400 bg-slate-800' : 'border-slate-600 hover:border-blue-400 hover:bg-slate-800'
            }`}
        >
            <Icon className="mb-3 size-6 text-slate-600" />
            <p className="font-mono text-xs uppercase tracking-wider text-slate-400">{label}</p>
            {hint && <p className="mt-1 max-w-[44ch] text-[11px] leading-relaxed text-slate-600">{hint}</p>}
            <input
                type="file"
                accept={accept}
                aria-label={label}
                onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) onFile(file);
                    event.target.value = '';
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
            />
        </div>
    );
}

/**
 * The bars. The skeleton of a ///M shell.
 *
 * `layout-and-structure.md` -> The bar system: fixed height, `shrink-0`, `flex items-center px-4`,
 * a glass fill, primary items left and tools right with the right cluster fenced off by a vertical
 * rule. The hierarchy is **app header (48) -> tab/pane bar (44) -> context bar (26) -> content**,
 * and the two columns' 44px bars must be the same height so their bottom rules form ONE line
 * across the split.
 *
 * This app had none of it. Navigation was a 44px `<nav>` at the very bottom of the screen, under a
 * full-width hub band, so there was no bar under the header at all and the two columns had no rule
 * to align across — the split read as two unrelated scroll boxes rather than as one instrument.
 *
 * Height is a token, not a prop: a bar whose height is passed in is a bar that will eventually be
 * 40px in one column and 44px in the other, and the whole point is that they match.
 */
const BAR = 'flex flex-none items-center gap-3 px-4 bg-slate-900/50 backdrop-blur-sm '
    + 'border-b border-slate-900';

/**
 * The 44px bar at the top of a column.
 *
 * `children` is the left cluster and owns the space; `tools` is the right cluster and is fenced
 * off by the vertical rule the system uses for exactly this.
 */
export function PaneBar({ children, tools }: { children: React.ReactNode; tools?: React.ReactNode }) {
    return (
        <div className={`${BAR} h-[44px]`}>
            <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
            {tools && (
                <div className="ml-4 flex shrink-0 items-center gap-3 border-l border-slate-800 pl-4">
                    {tools}
                </div>
            )}
        </div>
    );
}

/**
 * The 26px bar under it: the record you are acting on, then its actions.
 *
 * Thinner and quieter than the pane bar because it is context, not navigation. It renders only
 * when there IS a record — an empty context bar is 26px of nothing claiming to describe something.
 */
export function ContextBar({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
    return (
        <div className={`${BAR} h-[26px] bg-slate-950/60`}>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">{children}</div>
            {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
        </div>
    );
}

/**
 * A selector: a raised chip wrapping a bare `<select>`.
 *
 * The ///M form for choosing one of a closed set (`components.md` → Selectors). It replaces a
 * wrapped row of chips wherever the set is long enough to wrap: seven category chips inside a
 * 280px rail took three lines and pushed the list they filter below the fold, which is the
 * opposite of what a filter is for. Chips stay where the set is short and the counts matter at a
 * glance; a selector is for "one of these, and I know which one I want".
 *
 * The value takes its colour by role — primary for the subject, indigo for a reference.
 */
export function Selector<T extends string>({
    label,
    value,
    options,
    onChange,
    tone = 'primary',
}: {
    label: string;
    value: T;
    options: readonly { value: T; label: string }[];
    onChange: (value: T) => void;
    tone?: 'primary' | 'secondary';
}) {
    return (
        <div className="flex min-w-0 items-center gap-1 rounded bg-slate-800 px-2 py-0.5">
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-slate-500">
                {label}
            </span>
            <select
                value={value}
                onChange={event => onChange(event.target.value as T)}
                aria-label={label}
                className={`min-w-0 flex-1 cursor-pointer truncate bg-transparent text-[10px] font-bold tracking-widest uppercase outline-none ${
                    tone === 'primary' ? 'text-blue-400' : 'text-indigo-400'
                }`}
            >
                {options.map(option => (
                    <option key={option.value} value={option.value} className="bg-slate-900 text-slate-300">
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
}

/**
 * The one empty state.
 *
 * ///M house form (`typography.md` → Empty & loading states): calm, centred, mono, low-opacity —
 * an instrument **awaiting input**, never an error shout, and never a sentence in body prose. The
 * dashed ring with a dimmed glyph is the canonical placeholder; this app had four different
 * hand-written versions of it ("Nothing loaded.", "nothing yet", "No image loaded.", "Pick a
 * parameter…"), each in a different size and colour, which is four claims that something is wrong
 * rather than one that nothing has happened yet.
 *
 * `label` is instrument shorthand from `chrome.ts` — uppercase, one form in both languages.
 * `hint` is prose and belongs to the reader's language.
 */
export function EmptyState({
    Icon,
    label,
    hint,
}: {
    Icon: LucideIcon;
    label: string;
    /** One line, in the reader's language, saying what would fill this. Optional. */
    hint?: string;
}) {
    return (
        <div className="flex h-full min-h-[160px] flex-col items-center justify-center px-6 text-center text-slate-700">
            <div className="mb-4 flex size-16 items-center justify-center rounded-full border-2 border-dashed border-slate-800 opacity-50">
                <Icon className="size-6 opacity-50" />
            </div>
            <p className="font-mono text-xs uppercase tracking-wider opacity-50">{label}</p>
            {hint && (
                <p className="mt-2 max-w-[36ch] text-[11px] leading-relaxed text-slate-600">{hint}</p>
            )}
        </div>
    );
}

/**
 * A pane: a column of Sections, one gap.
 *
 * Every left-hand pane is this. The gap lives HERE and not on the Sections, so
 * blocks can be reordered without re-tuning their neighbours — which is how the
 * app ended up with mb-3, mb-4, mb-6 and mt-6+pt-4 all meaning "next block".
 */
export function Pane({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-col gap-6">{children}</div>;
}

/**
 * A named row of filter chips.
 *
 * The name is not decoration: an unlabelled row of toggles is a mystery, and
 * there are three axes in the jobs pane whose chips would otherwise run together
 * into one undifferentiated wall.
 */
export function FacetRow({ label: heading, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={`w-[4.5rem] shrink-0 ${LABEL} text-slate-600`}>{heading}</span>
            {children}
        </div>
    );
}

/**
 * The controls above a list: a capped search field, the facet rows, the
 * shown/total counter, and the line that says what is hidden.
 *
 * One component because a list with a search and a list without one were drifting
 * into two different layouts — and the datalog pane, which has 213 rows, had no
 * search at all while the jobs pane next to it did.
 */
export function ListControls({
    query,
    onQuery,
    placeholder,
    shown,
    total,
    hiddenNote,
    children,
}: {
    query: string;
    onQuery: (v: string) => void;
    placeholder: string;
    shown: number;
    total: number;
    /** Stated, never implied. A filtered list that does not say so is how rows go missing. */
    hiddenNote?: string;
    /** Facet rows. */
    children?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {/* Capped, not stretched. Given a 900px column, flex-1 made the
                    field the single largest object on screen — a grey slab that
                    says nothing — while the filters it belongs with were pushed
                    half a metre from the text they filter. */}
                <SearchInput value={query} onChange={onQuery} placeholder={placeholder} className="w-full max-w-[340px]" />
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-slate-600">
                    {shown} / {total}
                </span>
            </div>
            {children}
            {hiddenNote && <p className="text-[11px] text-slate-500">{hiddenNote}</p>}
        </div>
    );
}

/**
 * The one list. Rows are separated by a hairline and by hover, never by a box
 * each — at 77 rows an outline per row plus its pills stacks four frames deep and
 * the eye stops resolving the only thing that matters, which row is under the
 * pointer.
 */
export function DataList({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <ul className={`divide-y divide-slate-800/50 border-t border-slate-800/50 ${className}`}>{children}</ul>
    );
}

const CODE_TONE = {
    neutral: 'text-slate-600',
    primary: 'text-blue-400',
    danger: 'text-red-400',
} as const;

/**
 * The one row: one dimension, one hover, one selection expression, and one
 * answer to what belongs where.
 *
 * ## The hierarchy, and why it is three named slots
 *
 * A row shows a thing. The reader is a person, so **the thing's NAME is the
 * primary text** — the Japanese or English one. The SGBD identifier is
 * provenance: useful, secondary, and the first thing that should give way when
 * the column narrows. A raw code (`0x2A`, a block number) is an index, not a
 * name; it goes in a fixed-width gutter or nowhere.
 *
 * This was exactly inverted in eight of the ten rows in the app. `title` was
 * `shrink-0 font-mono text-slate-200` — brightest, monospace, guaranteed full
 * width — and every call site put `job.id` in it, while `label(job, lang)` went
 * into `subtitle`, which is the slot that truncates first. So the identifier was
 * promoted to the name's position and the name was cut off to make room for it.
 *
 * ## Why `name` is a branded type
 *
 * Renaming the props is necessary and not sufficient: nothing stops
 * `name={job.id}`. `HumanName` is minted only by `humanName()` and by the
 * catalogue's own resolvers (`label()`, `text()`), so putting an identifier in
 * the primary slot requires an explicit, greppable assertion rather than a
 * typo. The system has only two type sizes, so the hierarchy is carried by
 * colour, font family, and — the load-bearing one — which slot is allowed to
 * shrink.
 */
export function DataRow({
    selected = false,
    onSelect,
    leading,
    name,
    ident,
    code,
    codeTone = 'neutral',
    trailing,
    detail,
}: {
    selected?: boolean;
    onSelect?: () => void;
    /** Pill or checkbox. Baseline-aligned with the name. */
    leading?: React.ReactNode;
    /**
     * The primary text: what this thing is called, in the reader's language.
     * May be empty — see the fallback below — but never an identifier.
     */
    name: HumanName;
    /** The SGBD identifier. Provenance, and the first thing to truncate. */
    ident?: string;
    /** A raw code. A fixed-width index column, not a name. */
    code?: string;
    /** Closed set, not a className: a code's colour is a verdict, never decoration. */
    codeTone?: keyof typeof CODE_TONE;
    trailing?: React.ReactNode;
    /** Extra lines under the row. */
    detail?: React.ReactNode;
}) {
    // No human name exists for this row — some SGBD results genuinely have no
    // comment. Promote the identifier, but keep it looking like what it is.
    // A blank primary slot would read as "this thing has no name", which is a
    // different claim from "nobody has written one".
    const nameless = !name;
    const body = (
        <>
            <div className="flex items-baseline gap-x-3">
                {leading}
                {code !== undefined && (
                    <span className={`w-10 shrink-0 text-right font-mono text-[11px] tabular-nums ${CODE_TONE[codeTone]}`}>
                        {code}
                    </span>
                )}
                <span
                    className={`min-w-0 flex-1 truncate text-xs ${
                        nameless ? 'font-mono text-slate-400' : selected ? 'text-blue-200' : 'text-slate-200'
                    }`}
                >
                    {nameless ? ident : name}
                </span>
                {ident !== undefined && !nameless && (
                    <span className="min-w-0 shrink truncate font-mono text-[11px] text-slate-500">{ident}</span>
                )}
                {trailing}
            </div>
            {detail && <div className="mt-1 space-y-1">{detail}</div>}
        </>
    );

    if (!onSelect) return <li className="px-2 py-2">{body}</li>;
    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-pressed={selected}
                className={`w-full px-2 py-2 text-left transition-colors ${
                    selected ? 'bg-blue-900/40' : 'hover:bg-slate-800/50'
                }`}
            >
                {body}
            </button>
        </li>
    );
}

/**
 * A label and its value — the ///M readout atom.
 *
 * `JobPlan::Stat`, `page::MixCell` and `page::Readout` were three copies of this
 * with three different label sizes and two different stack directions.
 */
export function Field({
    label,
    value,
    unit,
    tone = 'text-slate-200',
    stacked = false,
    labelKind = 'chrome',
    title,
}: {
    label: React.ReactNode;
    value: React.ReactNode;
    unit?: string;
    /** A text colour class. Semantic only — a verdict, never decoration. */
    tone?: string;
    /** Stacked for a grid of readouts; inline for a run of metadata. */
    stacked?: boolean;
    /**
     * `chrome` is a name WE chose and gets the uppercase label treatment.
     * `data` is a name the ECU supplied — a freeze-frame field, a result — and
     * must not be uppercased: the system's own rule is sans for chrome, and a
     * machine-supplied string is not chrome. Uppercasing it also turns an
     * untranslated German fallback into shouting, which is how
     * `Versorgungsspannung HR` appeared as VERSORGUNGSSPANNUNG HR.
     */
    labelKind?: 'chrome' | 'data';
    title?: string;
}) {
    const labelCls = labelKind === 'chrome' ? `${LABEL} text-slate-600` : 'text-[11px] text-slate-500';
    if (stacked) {
        return (
            <div className="flex flex-col leading-none" title={title}>
                <span className={labelCls}>{label}</span>
                <span className={`mt-1.5 font-mono text-[11px] font-bold tabular-nums ${tone}`}>
                    {value}
                    {unit && <span className="ml-1 font-normal text-slate-500">{unit}</span>}
                </span>
            </div>
        );
    }
    return (
        <span className="flex items-baseline gap-1.5" title={title}>
            <span className={labelCls}>{label}</span>
            <span className={`font-mono text-xs tabular-nums ${tone}`}>
                {value}
                {unit && <span className="ml-1 text-slate-500">{unit}</span>}
            </span>
        </span>
    );
}

/**
 * Where a statement came from, said in the statement's own margin.
 *
 * Rendered as quiet text rather than a pill: on a panel where most lines carry
 * one, a tint per line is a wall of colour. It is the ones that say `name-heuristic`
 * that need to be findable, and they are findable because everything else says
 * something better.
 */
export function Provenance({ children, title }: { children: React.ReactNode; title?: string }) {
    return (
        <span title={title} className={`shrink-0 ${LABEL} text-slate-600`}>
            {children}
        </span>
    );
}
