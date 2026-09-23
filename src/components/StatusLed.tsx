'use client';

import type { LinkPhase } from '@/hooks/useSmg2Link';
import { C } from '@/lib/chrome';
import { LABEL } from './ui';

/**
 * The link indicator: an 8px dot in a 40px hit box.
 *
 * Colour is the role, never the hue for its own sake — ice blue is "connected / verified",
 * violet is "busy / armed", red is "fault", grey is "nothing there". Every non-steady state
 * also carries motion, because on a screen full of small coloured dots the reader should not
 * have to compare two shades of the same family to know whether something is happening.
 */

const DOT: Record<LinkPhase, string> = {
    disconnected: 'bg-slate-600',
    connecting: 'bg-amber-500 animate-pulse',
    connected: 'bg-emerald-500',
    probing: 'bg-amber-500 animate-pulse',
    reading: 'bg-amber-500 animate-pulse',
};

const TEXT: Record<LinkPhase, string> = {
    disconnected: 'text-slate-600',
    connecting: 'text-amber-400',
    connected: 'text-emerald-400',
    probing: 'text-amber-400',
    reading: 'text-amber-400',
};

/**
 * The state word.
 *
 * These stay uppercase Latin in both languages — they are instrument shorthand, read by shape at a
 * glance, and the catalog keeps them identical on purpose. What gets translated is prose.
 */
const WORD: Record<LinkPhase, string> = {
    disconnected: C.stateOffline,
    connecting: C.stateLinking,
    connected: C.stateLinked,
    probing: C.stateProbing,
    reading: C.stateReading,
};

export function StatusLed({
    phase,
    practice,
    onClick,
    title,
}: {
    phase: LinkPhase;
    practice: boolean;
    onClick?: () => void;
    title?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className="-m-4 flex items-center gap-2 p-4 transition-colors"
        >
            <span className={`block size-2 rounded-full ${DOT[phase]}`} aria-hidden="true" />
            <span className={`${LABEL} ${TEXT[phase]}`}>
                {practice && phase !== 'disconnected' ? C.statePractice : WORD[phase]}
            </span>
        </button>
    );
}
