'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Download, RefreshCw, Shield, Medal, Github } from 'lucide-react';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { PROJECT_REPO_URL } from '@/lib/links';
import { useShortLandscape } from '@/hooks/useWideLayout';

/**
 * Everything the header used to carry, for windows too narrow to carry it.
 *
 * The family's sheet, copied from the reference tuner's `MobileMenu` (tsunagi-m-mobile,
 * references/mobile-chrome.md) with only the bands' contents changed to this app's. Below 900px
 * the header keeps the link LED, the wordmark and the build — what has to be glanceable — and the
 * identity strip, the session facts, the tab list and the header's links go behind one control.
 *
 * **Three bands, and only one of them gives ground.** VEHICLE is the car, SESSION is the work, VIEW
 * is the screen. The first two hold their height; VIEW is the only list that can need a scroller,
 * and it gets the space the other two do not use.
 *
 * **Everything is ordered outward from the thumb.** The sheet opens from the button at the bottom
 * centre, so VIEW is nearest it, VEHICLE furthest, and Close sits at that same bottom centre on the
 * spot the finger is already touching. Press, slide up, release: one gesture, no second aim. VIEW's
 * list is unrolled upside down and opens scrolled to its end, so STARTUP — the first tab — is the
 * row closest to the button.
 *
 * **The icon strip at the top is the desktop header.** Same destinations, same order, drawn as
 * icons. It is the furthest thing from the thumb, which is where a legal link and a reload belong.
 *
 * **SESSION is readouts only.** The tuner's band carries NEW, SAVE and SYNC because its sessions
 * are started, saved and synced by hand. Here they are not: every image is recorded the moment it
 * is adopted, and the two things you do to the open one — EXPORT and CLEAR — are the hub's
 * sub-actions on DASH, one tap away on every width. A second copy of them in here would be a
 * second entrance to the same job (tsunagi-m-ux §11), and CLEAR is not a row to release a sweep
 * near.
 *
 * Deliberately NOT in here: anything that talks to the ECU. CONNECT, PROBE, READ, SEND and the
 * read scope stay on the dashboard where they are one tap apart and visible together — a menu that
 * has to be opened is the wrong place for a control whose state changes what comes off the car.
 */
interface Props {
    onClose: () => void;
    tabs: readonly { id: string; label: string; enabled: boolean }[];
    activeTab: string;
    onSelectTab: (id: string) => void;
    /** The car as the header's identity strip states it, plus the link the hub's status row states. */
    vehicle: { zb: string | null; hw: string | null; space: string | null; spaceUnconfirmed: boolean; link: string };
    /** The open image as the session bar states it; null with nothing loaded. */
    session: { source: string; base: string; edits: number; dirty: boolean; crc: { ok: boolean; label: string } | null } | null;
    /**
     * Where the press that opened this landed, while it is still down — so this mount can be the
     * middle of a drag rather than the end of a tap. The coordinates matter, not just the fact:
     * Close sits on the same spot as the button that opens the sheet, so a press that never moves
     * would otherwise release onto Close and shut what it just opened. Only a press that has
     * travelled counts as a sweep.
     */
    dragFrom?: { x: number; y: number } | null;
    /**
     * Clears `dragFrom`. It has to be called from in here, not from the button that set it: the
     * scrim goes up on pointerdown and covers that button immediately, so the button's own pointerup
     * never fires and the drag state would stay armed after the finger had left. The next release
     * anywhere would then be read as a selection.
     */
    onDragEnd?: () => void;
    /** Reloads the document. The caller confirms first if there is a live link or unsaved work. */
    onReload: () => void;
    /** The server is serving a newer build than the one running. */
    updateAvailable: boolean;
    /** The browser has offered to install this. */
    installable: boolean;
    /** Already running as an installed app — nothing left to install to. */
    installed: boolean;
    onInstall: () => void;
    /** CREDITS — who this is built on, and the MESH colophon. Same place as in the header. */
    onOpenCredits: () => void;
    /** The WORKS build's privacy section; null on a build that draws no PRIVACY link. */
    privacyHref: string | null;
    /** Which build this page's code came from. */
    buildLabel?: string;
}

/** The icon strip's controls — the desktop header, drawn small. 40px is the target; the icons
 *  themselves are 14px. */
const STRIP_ITEM = 'w-10 h-10 [@media(max-height:560px)]:w-9 [@media(max-height:560px)]:h-9 flex items-center justify-center rounded transition-colors';

/** The breathing room inside a band. Halved on a short viewport, which is the only place the sheet
 *  is short of height — nothing here is a tap target, so nothing loses one. */
const BAND_BODY = 'px-4 pb-3 [@media(max-height:560px)]:pb-1.5';

/**
 * One column for every readout in the sheet.
 *
 * The width is stated, not fitted. `w-fit` sizes each block to its own longest line, so two blocks
 * centre at two different x and the eye has nothing to read down. A single width means one left
 * edge for everything, with the slack falling either side of it.
 */
const READOUT_COLUMN = 'w-[min(15rem,100%)] mx-auto';

/**
 * One labelled readout, and an em-dash when there is nothing to read.
 *
 * The placeholder is the point, not a nicety: both readout bands hold a fixed height, and they can
 * only do that if a field with no value still occupies a line. `truncate` rather than `break-all`,
 * for the same reason — a source path that wrapped would take the band's height with it.
 *
 * The label column is 48px where the tuner's is 40: SOURCE, at 9px with the widest tracking,
 * measures 42.5px, so in 40 it overhung its column and left 9.5px of the 12px gap to its value
 * while every other row kept 12.
 */
const Field: React.FC<{ label: string; children?: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-baseline gap-3 py-1 [@media(max-height:560px)]:py-0.5">
        <span className="w-12 shrink-0 text-[9px] uppercase tracking-widest text-slate-600">{label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">
            {children ?? <span className="text-slate-700">—</span>}
        </span>
    </div>
);

/**
 * A band and its heading.
 *
 * The heading is a plain child rather than `sticky`, because nothing scrolls past it: each band
 * holds its own height. VIEW puts its scroller in `children`, so its heading stays put for the same
 * reason.
 */
const Band: React.FC<{ title: string; className?: string; children: React.ReactNode }> = ({ title, className = 'shrink-0 border-b border-slate-800', children }) => (
    <div className={`flex flex-col ${className}`}>
        <h4 className="shrink-0 px-4 pt-3 pb-2 [@media(max-height:560px)]:pt-1.5 [@media(max-height:560px)]:pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-600 text-center">
            {title}
        </h4>
        {children}
    </div>
);

/** How wide the destination board is, from how many destinations there are — a column each up to
 *  four, as the tuner does. This app has three. */
const boardColumns = (count: number) => (count <= 4 ? Math.max(count, 1) : count <= 8 ? 4 : 5);

export const MobileMenu: React.FC<Props> = ({
    onClose, tabs, activeTab, onSelectTab, vehicle, session, dragFrom, onDragEnd, onReload,
    updateAvailable, installable, installed, onInstall, onOpenCredits, privacyHref,
    buildLabel,
}) => {
    const { t } = useLang();
    /**
     * Side by side rather than stacked — a head unit, or a phone on its side.
     *
     * Only the ARRANGEMENT changes: every band renders the same children either way, and the sweep,
     * the close row and the nothing-that-writes rule are untouched. Read through a hook rather than
     * written as a Tailwind variant because the DOM structure differs — the two readout bands become
     * one grid row and VIEW's scrolling list becomes a board — and a variant cannot restructure.
     */
    const wings = useShortLandscape();
    /** Which row the finger is currently over, keyed by the `data-menu-key` below. */
    const [hot, setHot] = useState<string | null>(null);

    // Escape closes it, like every sheet.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        if (!dragFrom) return;
        // 12px, about a millimetre of skin. Below it the press is a tap that happens to wobble.
        let moved = false;
        const travelled = (e: PointerEvent) =>
            moved || (moved = Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) > 12);
        // Hit-tested rather than tracked by listeners on each row: the press started on a different
        // element (the footer button), so it holds the implicit pointer capture and the rows never
        // see the move events at all.
        const at = (e: PointerEvent) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const row = el?.closest('[data-menu-key]') as HTMLElement | null;
            return row && row.dataset.menuDisabled !== 'true' ? row : null;
        };
        const move = (e: PointerEvent) => setHot(travelled(e) ? at(e)?.dataset.menuKey ?? null : null);
        const up = (e: PointerEvent) => {
            const row = travelled(e) ? at(e) : null;
            setHot(null);
            onDragEnd?.();
            // Clicking the row rather than looking its handler up: the row already owns the handler
            // for the ordinary tap path, and one way in means the two cannot drift apart.
            // Released without travelling, or without reaching a row, leaves the sheet up — which is
            // what makes a plain tap open it to be read and tapped in the ordinary way.
            row?.click();
        };
        // Named, so the cleanup can take it off: `{ once: true }` only fires it once, it does not
        // remove an un-fired one, and an inline function has no handle for `removeEventListener`.
        const cancel = () => { setHot(null); onDragEnd?.(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
        window.addEventListener('pointercancel', cancel, { once: true });
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }, [dragFrom, onDragEnd]);

    /** Marks a row as drag-selectable. The key is only for the highlight; the handler stays on the
     *  element, where the tap path already reads it. */
    const row = (key: string, run: () => void, disabled = false) => ({
        'data-menu-key': key,
        'data-menu-disabled': disabled ? 'true' : undefined,
        onClick: run,
        disabled,
    } as const);

    const lit = (key: string) => (hot === key ? 'bg-slate-800' : '');

    /**
     * VIEW opens at the end of its own scroll.
     *
     * Its list is unrolled upside down, so the end is STARTUP — the row nearest the button that
     * opened the sheet. Only this band scrolls, so this is the only scroll position there is to set.
     */
    const tabScroller = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = tabScroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    /**
     * Ignore the dismissals for a moment after opening.
     *
     * On touch, letting go of the button that opened this fires a compatibility `click` at the same
     * coordinates a beat after `pointerup` — and Close sits at exactly those coordinates, by design.
     * So press-and-release shut the sheet the instant it appeared. `preventDefault` on the opening
     * pointerdown does not reliably suppress that click, and the drag path does not need it: it runs
     * off pointerup and dispatches its own click on the row.
     *
     * Only Close and the scrim are gated. A row reached by sweeping is still selectable throughout,
     * because that path never waits for a browser-generated click.
     */
    const [dismissable, setDismissable] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setDismissable(true), 400);
        return () => clearTimeout(timer);
    }, []);
    const dismiss = () => { if (dismissable) onClose(); };

    /** Every cross-origin destination in here opens in a new tab, and that is a safety rule rather
     *  than a courtesy: a same-tab navigation drops the serial link and takes an unread capture with
     *  it. See lib/links.ts, which is where they are declared for this reason. */
    const away = { target: '_blank', rel: 'noopener noreferrer' } as const;

    return (
        <>
            {/* No backdrop-blur: on the screen this sheet exists for, the sheet covers almost all of
                what it would blur, and the composite costs about a second of phone paint
                (tsunagi-m-mobile §16.5). */}
            <div className="fixed inset-0 z-[90] bg-slate-950/70 min-[900px]:hidden" onClick={dismiss} />
            {/* Up from the bottom, not in from the side: it opens from a control on the footer, so it
                comes from where the finger already is. Capped short of the full height so the scrim
                above stays visible — the way out has to be on screen. */}
            <div className={`fixed inset-x-0 bottom-0 z-[95] ${wings ? 'h-[95svh]' : 'max-h-[95svh]'} flex flex-col bg-slate-900 border-t border-slate-800 rounded-t-xl min-[900px]:hidden touch-none`}>

                {/* The backstop, and only that. VEHICLE and SESSION hold their height and VIEW absorbs
                    the squeeze — until VIEW has none left to give. So the bands above Close scroll as
                    a group, and Close never can: the way out of a sheet cannot be a function of how
                    tall the phone is. On a portrait phone this never engages. */}
                <div className="no-scrollbar flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">

                {/* The desktop header, as icons. Same destinations in the same order it uses, plus
                    INSTALL, which is the header's too but sits last here as it does in every M tool.

                    Furthest from the thumb of anything in the sheet, and deliberately outside the
                    sweep: none of these carries a `data-menu-key`, so the hit test returns null over
                    the whole strip and a finger travelling up can cross it and let go without opening
                    a legal page, reloading the app, or leaving for GitHub. Do not add one. */}
                <div className="shrink-0 border-b border-slate-800 px-4 pt-1.5">
                    {/* Three columns, not one centred row. CREDITS holds the middle of the strip on
                        its own, and `1fr auto 1fr` keeps it on the sheet's centre line whatever the
                        groups either side weigh — PRIVACY and INSTALL come and go, and a flex row
                        would slide the medal sideways with them. Same reason MENU is absolutely
                        centred in the footer this sheet opens from. */}
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center">
                        <div className="flex items-center justify-end gap-1">
                            {/* On a short landscape screen the build stamp rides IN this row instead
                                of under it — height back for the board below, and there is width to
                                spare at 683px. */}
                            {wings && buildLabel && (
                                <span className="mr-auto min-w-0 truncate font-mono text-[9px] text-slate-700">{buildLabel}</span>
                            )}
                            {privacyHref && (
                                <a href={privacyHref} {...away} title={t.privacyHint}
                                    className={`${STRIP_ITEM} text-slate-600 hover:text-slate-300`}>
                                    <Shield className="w-3.5 h-3.5" />
                                </a>
                            )}
                            <a href={PROJECT_REPO_URL} {...away} title="View on GitHub"
                                className={`${STRIP_ITEM} text-slate-600 hover:text-slate-300`}>
                                <Github className="w-3.5 h-3.5" />
                            </a>
                        </div>
                        {/* A medal, and centred: the one control in the strip that is not a tool but
                            an acknowledgement — whose work this is built on. */}
                        <button type="button" onClick={onOpenCredits} title="Credits & attribution"
                            className={`${STRIP_ITEM} text-slate-500 hover:text-slate-300`}>
                            <Medal className="w-4 h-4" />
                        </button>
                        <div className="flex items-center justify-start gap-1">
                            {/* No GUIDE: this app has no published method to point at, and an empty
                                slot is not drawn for one (tsunagi-m-chrome §1). No language switch
                                either — the browser decides (i18n.ts, tsunagi-m-ux §13). */}
                            {/* Tinted and pulsing on an update, exactly as the header's twin is — the
                                one state of this control that has to be seen without being looked for. */}
                            <button type="button" onClick={onReload}
                                title={updateAvailable ? t.updateAvailableHint : t.reloadHint}
                                className={`${STRIP_ITEM} ${updateAvailable ? 'text-blue-400 animate-pulse' : 'text-slate-600 hover:text-slate-300'}`}>
                                <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            {/* The unavailable case is shown, not hidden. "I looked for install and
                                found nothing" is the report this exists to answer, and a control that
                                disappears cannot answer it — so it stays, greyed, with the reason on
                                the title. Gone only once there is genuinely nothing to install to. */}
                            {!installed && (
                                <button type="button"
                                    onClick={installable ? onInstall : undefined}
                                    disabled={!installable}
                                    title={installable ? C.install : t.installUnavailableHint}
                                    className={`${STRIP_ITEM} ${installable
                                        ? 'text-emerald-400 hover:text-emerald-300' : 'text-slate-700 cursor-default'}`}>
                                    <Download className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                    {/* Which build this phone is actually running. Never acted on, but it is the first
                        thing asked when a device behaves differently from the desk. */}
                    {!wings && buildLabel && (
                        <p className="pb-1 text-center font-mono text-[9px] leading-none text-slate-700 break-all">{buildLabel}</p>
                    )}
                </div>

                {/* VEHICLE and SESSION: one above the other on a phone, side by side when the height
                    to stack them is not there. `contents` makes the wrapper disappear in the stacked
                    case. Side by side, the divider between them lands on the sheet's centre line, the
                    same line the medal above and the ✕ below already sit on. */}
                <div className={wings ? 'grid grid-cols-2 shrink-0 border-b border-slate-800' : 'contents'}>

                {/* Laid out to fit, and never scrolled — the header's identity strip and the hub's
                    link state, read-only. `shrink-0`, so a short viewport takes its height out of
                    VIEW instead. */}
                <Band title={C.bandVehicle} className={wings ? 'min-h-0' : undefined}>
                    <div className={BAND_BODY}>
                        <div className={READOUT_COLUMN}>
                            <Field label="ZB">{vehicle.zb}</Field>
                            <Field label="HW">{vehicle.hw}</Field>
                            <Field label="SPACE">
                                {vehicle.space && <span className={vehicle.spaceUnconfirmed ? 'text-amber-400' : undefined}>{vehicle.space}</span>}
                            </Field>
                            {/* The same words, under the same name, as the hub's status row. */}
                            <Field label="SMG">{vehicle.link}</Field>
                        </div>
                    </div>
                </Band>

                {/* Fixed height too, and that is why every field is always drawn. Nothing here appears
                    or disappears with what is loaded: an empty session shows its four labels against
                    em-dashes. A band that changed height would move VIEW under the thumb between one
                    glance and the next. */}
                <Band title={C.bandSession} className={wings ? 'min-h-0 border-l border-slate-800' : undefined}>
                    <div className={BAND_BODY}>
                        <div className={READOUT_COLUMN}>
                            <Field label={C.fSource}>{session?.source}</Field>
                            <Field label={C.fBase}>{session?.base}</Field>
                            <Field label={C.fEdits}>
                                {session && <span className={session.dirty ? 'text-blue-400' : undefined}>{session.edits}</span>}
                            </Field>
                            <Field label="CRC">
                                {session?.crc && <span className={session.crc.ok ? 'text-emerald-400' : 'text-amber-400'}>{session.crc.label}</span>}
                            </Field>
                        </div>
                    </div>
                </Band>

                </div>

                {/* The only band that gives ground, and — stacked — the only one that scrolls, by
                    being the only `flex-1` in the column.

                    Side by side there is no squeeze to absorb and nothing scrolls: the board fills
                    whatever height is left. No bottom border there, because the close row underneath
                    already draws one. */}
                <Band title={C.bandView} className={wings ? 'flex-1 min-h-0' : 'flex-1 min-h-[88px] border-b border-slate-800'}>
                    {wings ? (
                        /* The destinations as a board rather than a list. On a head unit the sheet is
                           short and wide, and a list climbing away from the thumb would get a row and a
                           half. Laid across, every tab is on screen at once, read in the tab row's own
                           order with STARTUP first. Rows are `minmax(44px, 1fr)`: 44 is the floor a
                           finger needs, `1fr` spends whatever the bands above did not.

                           The same `row()` as the list, so press-slide-release still selects, and a
                           destination that does not exist yet is still listed rather than hidden. */
                        <div
                            className="grid flex-1 min-h-0 gap-1.5 px-4 pb-2 [@media(max-height:560px)]:pb-1.5"
                            style={{
                                gridTemplateColumns: `repeat(${boardColumns(tabs.length)}, minmax(0, 1fr))`,
                                gridAutoRows: 'minmax(44px, 1fr)',
                            }}
                        >
                            {tabs.map(tab => {
                                const isActive = activeTab === tab.id;
                                const isHot = hot === `tab:${tab.id}`;
                                // Each of the three is decided once. Two Tailwind classes for one
                                // property are settled by the order the compiler emitted them in,
                                // not by the order they are written here.
                                const fill = isHot ? 'bg-slate-800' : tab.enabled ? 'bg-slate-800/40' : 'bg-transparent';
                                const tone = isActive ? 'text-blue-400' : tab.enabled ? 'text-slate-400' : 'text-slate-700 cursor-default';
                                // The 2px indicator the footer's pane switch wears, on the edge a
                                // footer-born sheet reads from: the top.
                                const edge = isActive ? 'border-blue-400' : 'border-transparent';
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        {...row(`tab:${tab.id}`, () => { onSelectTab(tab.id); onClose(); }, !tab.enabled)}
                                        className={`flex items-center justify-center text-center px-1.5 rounded border-t-2 text-[11px] font-bold tracking-widest leading-tight transition-colors ${fill} ${tone} ${edge}`}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div ref={tabScroller} className="no-scrollbar flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-2">
                            {/* The tab row, unrolled and turned upside down: STARTUP — the first tab —
                                sits closest to the button that opened this, and the list climbs away
                                from the thumb. Disabled entries stay listed rather than hidden: which
                                view does not exist yet is the same information as which one does. */}
                            <div className="flex flex-col">
                                {[...tabs].reverse().map(tab => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        {...row(`tab:${tab.id}`, () => { onSelectTab(tab.id); onClose(); }, !tab.enabled)}
                                        className={`flex items-center justify-center text-center min-h-[44px] py-3 px-2 -mx-2 rounded text-[11px] font-bold tracking-widest transition-colors ${lit(`tab:${tab.id}`)} ${activeTab === tab.id ? 'text-blue-400'
                                            : tab.enabled ? 'text-slate-400' : 'text-slate-700 cursor-default'}`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </Band>

                </div>

                {/* Close, on the spot the opening press landed on. Same height and same centre as the
                    footer's menu button, so releasing without moving lands here and a second tap
                    closes what the first opened without the thumb going anywhere. */}
                <div className="h-[52px] shrink-0 flex items-center justify-center border-t border-slate-800">
                    <button
                        type="button"
                        {...row('close', dismiss)}
                        aria-label={C.close}
                        className={`h-[52px] w-[52px] flex items-center justify-center rounded text-slate-400 hover:text-slate-200 cursor-pointer ${lit('close')}`}
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
            </div>
        </>
    );
};
