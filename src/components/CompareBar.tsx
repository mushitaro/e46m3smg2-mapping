'use client';

import React from 'react';

/**
 * SUBJECT vs REFERENCE — the one control for "what am I looking at, and what am I looking at it
 * against". Ported from the reference tuner so this app asks the question the same way, in the
 * same words, in the same place.
 *
 * The width rules below are measured, not decorative. A `<select>` claims its max-content width
 * unless every box in the chain carries `min-w-0` and the select itself `w-full`: without them the
 * bar came to 625px inside a 343px pane in the reference app, the grid scrolled sideways with it,
 * and the selector you were reaching for slid off the screen as you reached. `max-w-[220px]` is the
 * other end — without it `flex-1` gives each box half a desk pane to hold the word TUNED.
 *
 * COMPARE stands down below 900px: it is a heading for a row whose own tab already names it.
 */

export interface CompareOption {
    value: string;
    label: string;
    disabled?: boolean;
}

export function CompareBar({
    options,
    subject,
    onSubject,
    reference,
    onReference,
    trailing,
}: {
    options: CompareOption[];
    subject: string;
    onSubject: (value: string) => void;
    reference: string;
    onReference: (value: string) => void;
    /** Controls that belong to this bar's own question. Kept out of the shared shape. */
    trailing?: React.ReactNode;
}) {
    const select = (
        value: string,
        onChange: (v: string) => void,
        label: string,
        tone: string,
    ) => (
        <div className="flex min-w-0 max-w-[220px] flex-1 items-center gap-1 rounded bg-slate-800 px-2 py-0.5">
            <span className="shrink-0 text-[9px] uppercase text-slate-500">{label}</span>
            <select
                value={value}
                onChange={e => onChange(e.target.value)}
                className={`w-full min-w-0 cursor-pointer truncate bg-transparent text-[10px] font-bold outline-none ${tone}`}
            >
                {options.map(o => (
                    <option
                        key={o.value}
                        value={o.value}
                        disabled={o.disabled}
                        className="bg-slate-900 text-slate-300"
                    >
                        {o.label}
                    </option>
                ))}
            </select>
        </div>
    );

    return (
        <div className="flex min-w-0 items-center gap-2 border-b border-slate-800 bg-slate-900/50 px-3 py-2">
            <span className="hidden shrink-0 text-xs font-bold text-slate-400 min-[900px]:inline">COMPARE</span>

            <div className="flex min-w-0 flex-1 items-center gap-2">
                {select(subject, onSubject, 'Subject', 'text-white')}
                <span className="shrink-0 text-xs font-bold text-slate-600">vs</span>
                {/* Indigo: the reference role, the same hue the lineage badges use. */}
                {select(reference, onReference, 'Reference', 'text-indigo-400')}
            </div>

            {trailing}
        </div>
    );
}
