'use client';

import React, { useEffect, useState } from 'react';
import { Medal, X } from 'lucide-react';

import { LABEL } from '@/components/ui';
import { CREDITS_COPY } from '@/lib/credits-copy';
import { useLang } from '@/lib/i18n';
import { meshUrl } from '@/lib/links';
import { readSupporters } from '@/lib/supporters';
import { APP_VERSION, BUILD_ID } from '@/lib/version';

/**
 * Who this tool is built on — reachable from the header at any time, as in TUNER and MONITORING.
 *
 * Named sources, not a thank-you (tsunagi-m-chrome §4): each entry says what the work was and what
 * in this app rests on it, taken from THIRD-PARTY-NOTICES.md §2. Then the build, for the person
 * about to write to the author. Then the colophon, last and dim: where the work continues (MESH,
 * linked from here and nowhere else) and the people who carry it — those who bought MILE for this
 * tool on MESH and agreed to be named, most MILE first, names only. That list is written into the
 * page at build time (scripts/inject-supporters.mjs), so reading it is no request: the README's
 * "production sends nothing anywhere" stays true.
 *
 * Unlike the preview notice this is not a gate: × , Escape and the scrim all close it.
 */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
    const { lang } = useLang();
    const t = CREDITS_COPY[lang];
    // Read once, when the dialog opens: the list is in the page, not the bundle.
    const [supporters] = useState(readSupporters);
    const named = supporters && (supporters.names.length > 0 || supporters.others);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <>
            <div aria-hidden="true" className="fixed inset-0 z-[100] bg-slate-950/70 min-[900px]:backdrop-blur-sm" onClick={onClose} />
            <div className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4">
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="credits-title"
                    lang={lang}
                    className="pointer-events-auto flex max-h-full w-full max-w-[560px] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
                >
                    <div className="flex min-h-[44px] flex-none items-center gap-3 border-b border-slate-800 px-4">
                        <Medal className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                        <h2 id="credits-title" className={`${LABEL} min-w-0 flex-1 py-2 text-slate-300`}>
                            {t.title}
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            title={t.close}
                            aria-label={t.close}
                            className="-mr-2.5 shrink-0 p-2.5 text-slate-500 transition-colors hover:text-slate-300"
                        >
                            <X className="size-5" />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs leading-relaxed text-slate-300">
                        <p>{t.intro}</p>

                        {t.entries.map((e) => (
                            <div key={e.who} className="flex gap-2">
                                <span className="shrink-0 text-slate-600">—</span>
                                <p>
                                    <span className="font-bold text-slate-100">{e.who}</span>
                                    {' — '}
                                    {e.what}
                                </p>
                            </div>
                        ))}

                        <p className="pt-1 text-[11px] text-slate-500">{t.notices}</p>

                        <p className="border-t border-slate-800 pt-2 font-mono text-[10px] text-slate-600">
                            {t.build} V{APP_VERSION} · {BUILD_ID}
                        </p>

                        {/* The colophon, under the build line's rule — a second rule on the same
                            edge would draw a box. Neutral: it states no machine state. */}
                        <div className="text-[10px] leading-relaxed text-slate-600">
                            <span className="font-mono uppercase tracking-widest">integrated by tsunagi</span>
                            {supporters && named && (
                                <div className="mt-2">
                                    <p className="text-slate-500">{t.supportersLead}</p>
                                    {supporters.names.length > 0 && (
                                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                                            {supporters.names.map((n, i) => (
                                                <span key={`${i}:${n}`}>{n}</span>
                                            ))}
                                        </p>
                                    )}
                                    {supporters.others && <p className="mt-1">{t.supportersOthers}</p>}
                                    <p className="mt-1 font-mono text-[9px] tracking-wider">{t.supportersAsOf(supporters.asOf)}</p>
                                </div>
                            )}
                            <p className="mt-2">
                                {t.meshLead}{' '}
                                <a
                                    href={meshUrl(lang)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-500 underline underline-offset-2 transition-colors hover:text-slate-300"
                                >
                                    MESH
                                </a>
                                {t.meshTail}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
