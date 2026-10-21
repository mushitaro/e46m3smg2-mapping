'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether both panes are on screen at once — the same 900px the layout splits at.
 *
 * Ported from the reference tuner (`E46M3CSL_TuningTool/src/hooks/useWideLayout.ts`), reasoning
 * intact. Needed in JS, not just CSS, because below 900px the two panes share one grid cell and the
 * inactive one is only `invisible`: it stays laid out, and anything mounted inside it keeps doing
 * its work where nobody can see it.
 *
 * `useSyncExternalStore` rather than an effect + state so the first client render already has the
 * right answer instead of painting the wrong branch and correcting it. The server snapshot is
 * `true` — the wide layout is the one the markup has always described, and it renders nothing that
 * a narrow viewport then has to tear down.
 */
const WIDE = '(min-width: 900px)';

/**
 * Narrow enough for one pane at a time AND too short to stack the picture above the controls.
 *
 * This, not the width alone, is what makes GRAPH a destination of its own. The split exists to
 * settle a fight over vertical pixels: on a landscape phone the value pane and the hub cannot both
 * have the height they need. Where the height is there — a portrait phone — nothing is fighting,
 * and splitting costs a tap and buys nothing.
 *
 * The same query is written out as a Tailwind variant at the places that need it in CSS
 * (`SPLIT_ONLY_*` in page.tsx). Keep them identical — a viewport that matches one and not the other
 * can reach a destination that is not there.
 */
const SPLIT = '(max-width: 899px) and (max-height: 560px)';

const subscriber = (query: string) => (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
};
const subscribeWide = subscriber(WIDE);
const subscribeSplit = subscriber(SPLIT);

export function useWideLayout(): boolean {
    return useSyncExternalStore(
        subscribeWide,
        () => window.matchMedia(WIDE).matches,
        () => true,
    );
}

/** Server snapshot `false` for the same reason `useWideLayout` is `true`: both describe the stacked
 *  layout, which is what the markup renders before anything has been measured. */
export function useSplitGraph(): boolean {
    return useSyncExternalStore(
        subscribeSplit,
        () => window.matchMedia(SPLIT).matches,
        () => false,
    );
}

/**
 * Short enough that the menu sheet cannot stack its bands, and wide enough to stand them side by side.
 *
 * Ported from the reference tuner with its reasoning. A third question rather than a
 * reinterpretation of the two above: `SPLIT` asks whether the picture and the controls can share a
 * pane; this asks whether the MENU SHEET can stack its bands. On a 1024x600 head unit — about
 * 683x400 CSS — a stacked sheet leaves VIEW a row and a half; side by side the same content fits
 * with nothing scrolling.
 *
 * 560 is not a new number: it is the short-viewport threshold `SPLIT` and the sheet's halved
 * paddings already use. `orientation: landscape` rather than a second width: the question is
 * whether there is width to spend that the height has not got. The sheet only exists below 900px
 * (`min-[900px]:hidden`), so no width bound belongs here.
 */
const SHORT_LANDSCAPE = '(max-height: 560px) and (orientation: landscape)';
const subscribeShortLandscape = subscriber(SHORT_LANDSCAPE);

/** Server snapshot `false`, for the same reason `useSplitGraph`'s is: the stacked sheet is what the
 *  markup has always described, and it is the arrangement a narrow-and-tall phone keeps. */
export function useShortLandscape(): boolean {
    return useSyncExternalStore(
        subscribeShortLandscape,
        () => window.matchMedia(SHORT_LANDSCAPE).matches,
        () => false,
    );
}
