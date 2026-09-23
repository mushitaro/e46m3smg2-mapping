'use client';

import type { LucideIcon } from 'lucide-react';
import { useFitScale } from '@/hooks/useFitScale';
import { HUB_LABEL, LABEL } from './ui';

/**
 * The hub — a state-machine action ring.
 *
 * One large control whose icon, label and handler are DERIVED from the live
 * state on every render, so the UI cannot disagree with reality. This is the
 * app's single primary action: whatever the one right next step is, it is here.
 *
 * The old app had this and I dropped it in the rebuild, which left the primary
 * actions as anonymous buttons scattered through panels. That is not a styling
 * difference — it is the interaction model, and losing it is why the app read
 * as a different product.
 *
 * Contract for a view that supplies one:
 *
 *   getHubConfig(state) -> {
 *     label,           short verb, in the active language
 *     Icon,            a lucide icon
 *     onClick,
 *     tone,            drives the glow ring, NOT decoration
 *     disabled?,
 *     notice?          text for the reserved line above; layout never jumps
 *   }
 *
 * Views with many independently-runnable rows (the job tables) deliberately
 * supply none: routing dozens of named jobs through one button would be an
 * extra click and a re-derived label. They fall back to the connection action.
 */

export type HubTone = 'idle' | 'connecting' | 'busy' | 'ready' | 'armed' | 'armed-danger' | 'done' | 'fail';

export interface HubConfig {
    label: string;
    Icon: LucideIcon;
    onClick?: () => void;
    tone: HubTone;
    disabled?: boolean;
    notice?: string;
    /**
     * What kind of thing the notice is, which decides whether it is rendered at all.
     *
     * `info` is NOT drawn. The reserved line is the one surface that means "something needs your
     * attention", and a sentence that is true after every successful read — "both passes were
     * byte-identical" — spends it saying nothing. The reference tuner reached the same conclusion
     * and dropped its own measurement line for the same reason.
     */
    noticeKind?: 'error' | 'caution' | 'progress' | 'info';
    spin?: boolean;
}

/** The ring echoes the status layer, which lives inside the tricolor. */
const RING: Record<HubTone, string> = {
    idle: 'border-slate-800',
    connecting: 'border-amber-500/50 animate-pulse',
    busy: 'border-amber-500/50 animate-pulse',
    ready: 'border-blue-500/30',
    // Pulses. `armed` is the LIVE recording state, and without motion it
    // differed from a ready-to-record ring by 10% of a border alpha — from arm's
    // length under a car those are the same ring. The breathing is the one cue
    // readable from across a garage.
    armed: 'border-amber-500/50 animate-pulse',
    // The only place red appears as a steady state: a control that is armed to
    // do something irreversible.
    'armed-danger': 'border-red-500/60',
    done: 'border-emerald-500/40',
    fail: 'border-red-500/50',
};

/**
 * The face colour.
 *
 * `idle` is BLUE, not slate. It is the tone of the landing state — CONNECT —
 * which is an enabled, pressable action, and painting it slate-500 made the
 * app's single primary control look disabled on the first screen every user
 * sees, identical to the genuinely-disabled fallback. Disabled-ness is keyed off
 * the `disabled` flag below, never off a tone name.
 */
const FACE: Record<HubTone, string> = {
    idle: 'text-blue-500 hover:text-blue-400',
    connecting: 'text-amber-400',
    busy: 'text-amber-400',
    ready: 'text-blue-500 hover:text-blue-400',
    armed: 'text-amber-400',
    'armed-danger': 'text-red-400',
    done: 'text-emerald-400',
    fail: 'text-red-400',
};

/**
 * 72px, not 80.
 *
 * `layout-and-structure.md` writes the hub down as `w-20 h-20` and this used to
 * follow it literally — but the reference tool does NOT render 80. Its cluster
 * sits in a box whose height its own wings set (3 rows of 28 + 2 gaps of 18 =
 * 120), and its fit-scale then divides `clientHeight - 12` by that: 108/120 =
 * 0.9, permanently. Measured at 1280x720, 1280x800, 1280x1400 and 1920x1080 —
 * 0.9 every time. So the instrument everyone has actually looked at has a 72px
 * ring with an 18px glyph, and this app was the odd one out at 80/20.
 *
 * Declared rather than reproduced with a transform. `scale-90` would paint 72
 * while still occupying an 80px box, which would silently put 8px back into the
 * gaps below — and those gaps are measured against the same reference.
 */
const HUB_SIZE = 'size-[72px]';
const HUB_ICON = 'size-[18px]';

export function Hub({ config }: { config: HubConfig }) {
    const { label, Icon, onClick, tone, disabled, spin } = config;
    return (
        <div className="relative">
            <div className={`absolute -inset-1 rounded-full border ${RING[tone]}`} aria-hidden="true" />
            <button
                type="button"
                onClick={disabled ? undefined : onClick}
                disabled={disabled}
                className={`relative flex ${HUB_SIZE} flex-col items-center justify-center gap-1 rounded-full border border-slate-700 bg-slate-900 shadow-2xl ring-1 ring-slate-800 transition-colors hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-900 ${
                    disabled ? 'text-slate-500' : FACE[tone]
                }`}
            >
                <Icon className={`${HUB_ICON} stroke-[1.5] ${spin ? 'animate-spin' : ''}`} />
                <span className={HUB_LABEL}>{label}</span>
            </button>
        </div>
    );
}

/**
 * The hub cluster: a symmetric 3-column grid, not a flex row, so the ring stays
 * dead centre however wide the wing labels get.
 *
 * ## The gap is load-bearing, and it was missing
 *
 * The centre column is `auto` — the BUTTON's width — but the glow ring is
 * `absolute -inset-1`, so it paints 4px past the button on every side. With no
 * column gap the wings sit flush against the column edge and the ring lands
 * **on top of the labels**: measured on the deployed build, EXPORT and
 * DISCONNECT each overlapped the ring by exactly -4px.
 *
 * That overlap is symmetric, which is why a centroid check passes it — the hub
 * measured dead centre to 0.01px while visibly jammed into both labels. The
 * defect is clearance, not centring, and only a clearance measurement finds it.
 *
 * `gap-3` (12px) is the control-cluster token, and it leaves 8px of air between
 * the ring's edge and the nearest glyph.
 */
export function HubCluster({
    left,
    right,
    children,
}: {
    /** Arming — what the next operation will carry. Toggles and readouts, never actions. */
    left?: React.ReactNode;
    right?: React.ReactNode;
    children: React.ReactNode;
}) {
    // Measured against the box it is in and scaled to fit, rather than clamped by hand. `0.8` is a
    // promise about the smallest this may become: below it the label that distinguishes READ from
    // SHARE inside the ring stops being readable at arm's length, which is the one thing the ring
    // exists to say.
    const { outerRef, innerRef, scale, minH } = useFitScale(0.8);
    return (
        <div
            ref={outerRef}
            style={{ minHeight: minH }}
            className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden py-1.5"
        >
            {/* A 3-column grid, NOT a flex row: the outer columns are equal, so the ring sits at the
                exact centre however wide a wing gets. A flex row centres the cluster as a whole and
                lets the ring drift sideways every time a wing label changes width. The empty
                columns are kept for the same reason — they hold the ring in column 2. */}
            <div
                ref={innerRef}
                style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
                className="grid flex-none select-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3"
            >
                <div className="flex flex-col items-end gap-[18px] justify-self-end">{left}</div>
                <div className="justify-self-center">{children}</div>
                <div className="flex flex-col items-start gap-[18px] justify-self-start">{right}</div>
            </div>
        </div>
    );
}

/**
 * The labelled status row above the notice — 32px, and it wraps rather than overflows.
 *
 * `min-h`, not `h`: what this row carries depends on the link. Disconnected it is a label and the
 * PRACTICE toggle; connected it is the state and DISCONNECT. A fixed-height flex row with nothing
 * to give does not clip, it overflows — and the panel around it resolves `overflow-y-auto` to
 * `overflow-x: auto` as well, so the whole control panel becomes draggable sideways. The floor
 * keeps the stability the fixed height was for and lets it take a second line when it must.
 */
export function HubStatusRow({
    label,
    Icon,
    children,
}: {
    label: string;
    Icon: LucideIcon;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex min-h-[32px] flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2">
            <span className={`${LABEL} flex items-center gap-1.5 text-slate-500`}>
                <Icon className="size-3" /> {label}
            </span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
                {children}
            </div>
        </div>
    );
}

/**
 * The hub's sub-actions: a reserved 46px row BELOW the cluster.
 *
 * Deliberately outside it, for two reasons the reference tuner learned by measuring. Reserving the
 * height means showing or hiding one of these can never resize the cluster, so the ring cannot
 * move; and being outside the cluster's transform keeps the labels legible instead of scaling them
 * down with the dial.
 *
 * A ROW, not a column — stacked, two of these overflow the 46px budget. Three cells rather than one
 * centred group, for the same reason the cluster is a 3-column grid: what is here stays on the
 * centre line whatever hangs off an end.
 *
 * This app had these in the cluster's WINGS. The wings are for arming — what the next operation
 * will carry — and putting actions there made EXPORT read as a modifier of READ.
 */
export function HubSubActions({ children }: { children?: React.ReactNode }) {
    return (
        <div className="flex h-[46px] flex-none flex-row items-center">
            <div className="flex-1" />
            <div className="flex flex-row items-center justify-center gap-x-4">{children}</div>
            <div className="flex-1" />
        </div>
    );
}

/**
 * The reserved notice line.
 *
 * Fixed height whether or not there is anything in it. Transient text appearing
 * and disappearing inside a reserved slot is the difference between a dashboard
 * that reads as an instrument and one that twitches every time a status
 * changes — which, on a tool that drives a car, reads as untrustworthy.
 */
/** Ranked by CONSEQUENCE, not by source. `info` is carried so it can be recognised and dropped. */
export type NoticeKind = 'error' | 'caution' | 'progress' | 'info';

const NOTICE: Record<NoticeKind, string> = {
    error: 'text-red-400',
    caution: 'text-amber-400',
    progress: 'text-slate-400',
    info: 'text-slate-500',
};

export function HubNotice({ text, kind = 'info' }: { text?: string; kind?: NoticeKind }) {
    // `info` is not drawn at all. The reserved slot is for "something needs your attention", and a
    // line that is true after every successful read spends it saying nothing.
    const show = text && kind !== 'info';
    return (
        // TWO lines below 900px, ONE above it — and both RESERVED, never grown.
        //
        // The intent has always been "one line, truncated". On a phone that hides the instruction
        // instead of shortening it: the Japanese notices here run past a 390px line, and `title` is
        // a hover tooltip on a device with no hover. A desk keeps 14px, because at that width the
        // same message is one line and the growth this slot exists to stop was measured there.
        //
        // Leading is pinned to the row height so a font swap cannot grow the panel into the region
        // above it.
        <div className="mt-1 flex h-[28px] items-center overflow-hidden px-2 min-[900px]:h-[14px]">
            {show && (
                <p
                    className={`line-clamp-2 text-[11px] leading-[14px] min-[900px]:line-clamp-1 ${NOTICE[kind]}`}
                    title={text}
                >
                    {text}
                </p>
            )}
        </div>
    );
}

/**
 * Reserved sub-action row. Same rule: it keeps its slot when empty.
 *
 * A ROW, and deliberately no `flex-wrap`. Wrapping is what puts the content over
 * the reserved height — a second line costs ~15px more than the 36px left after
 * padding — and the overflow then scrolls the whole control panel, moving the
 * hub. `gap-x-6` because these are naked tracked-uppercase labels with no box to
 * separate them; at gap-2 two of them read as one string.
 */
export function SubActions({ children }: { children?: React.ReactNode }) {
    return <div className="flex h-[46px] flex-none items-center justify-center gap-x-4">{children}</div>;
}
