'use client';

import React, { useEffect, useRef } from 'react';
import { Check, ExternalLink, Languages, Shield } from 'lucide-react';

import { FillButton, LABEL } from '@/components/ui';
import { useLang } from '@/lib/i18n';
import { privacyUrl } from '@/lib/links';
import { NOTICE_TITLE, PREVIEW_NOTICE } from '@/lib/previewNotice';

/**
 * What the preview sends, and why — in front of the owner before it sends anything.
 *
 * A gate, like TUNER's disclaimer: no ×, no scrim click, no Escape. The one way on is
 * 確認して続ける, and while this is up the page behind it is `inert` (page.tsx), so nothing there
 * can be pressed or reached with Tab either. What the confirmation unlocks, and where it is kept,
 * is `previewNotice.ts`; this is the words and the button.
 *
 * ## The shape
 *
 * 560 wide, as TUNER's gate is; the height is the text's, not φ. This is a list that has to be read
 * whole, and a φ 346 would scroll it on every screen there is — so the text decides, and the
 * viewport clamps it 16px clear of every edge. The title and the button are the frame and only the
 * words between them scroll, so on a head unit (≈683×400 CSS px) the button is on screen before a
 * line has been scrolled.
 *
 * The language control is the header's, repeated here because this covers the header. An explicit
 * choice is the first thing this app's language rule honours (`i18n.ts`), and a notice that cannot
 * be switched into the owner's language is a notice confirmed unread.
 */
export function PreviewNoticeDialog({ onConfirm }: { onConfirm: () => void }) {
    const { t, lang, setLang } = useLang();
    const n = PREVIEW_NOTICE[lang];
    const words = useRef<HTMLDivElement>(null);

    // Focus starts on the words: a screen reader begins inside the dialog, and the arrow keys scroll
    // what has to be read. The page behind is inert, so Tab cannot leave.
    useEffect(() => {
        words.current?.focus();
    }, []);

    return (
        <>
            {/* No onClick: the scrim is not a way out. Blur only where it is cheap (tsunagi-m-design). */}
            <div aria-hidden="true" className="fixed inset-0 z-[100] bg-slate-950/70 min-[900px]:backdrop-blur-sm" />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="preview-notice-title"
                    aria-describedby="preview-notice-lead"
                    lang={lang}
                    className="flex max-h-full w-full max-w-[560px] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
                >
                    <div className="flex min-h-[44px] flex-none items-center gap-3 border-b border-slate-800 px-4">
                        <Shield className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                        <h2 id="preview-notice-title" className={`${LABEL} min-w-0 flex-1 py-2 text-slate-300`}>
                            {NOTICE_TITLE}
                        </h2>
                        <button
                            type="button"
                            onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}
                            title={t.switchLanguage}
                            aria-label={t.switchLanguage}
                            className="-mr-2.5 shrink-0 p-2.5 text-slate-500 transition-colors hover:text-slate-300"
                        >
                            <Languages className="size-5" />
                        </button>
                    </div>

                    <div
                        ref={words}
                        tabIndex={-1}
                        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs leading-relaxed outline-none"
                    >
                        <p id="preview-notice-lead" className="text-slate-300">{n.lead}</p>
                        <Sent title={n.sessionsTitle} what={n.sessions} when={n.sessionsWhen} />
                        <Sent title={n.recordsTitle} what={n.records} when={n.recordsWhen} />
                        <p className="text-slate-400">{n.alsoSent}</p>
                        <Point title={n.purposeTitle} body={n.purpose} />
                        <Point title={n.whereTitle} body={n.where} />
                        <Point title={n.deleteTitle} body={n.deleteBody} />
                        {/* A new tab, so a read already in hand is never navigated away from. */}
                        <p>
                            <a
                                href={privacyUrl(lang)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="-my-2 inline-flex items-center gap-1.5 py-2 text-blue-400 underline underline-offset-2 transition-colors hover:text-blue-300"
                            >
                                {n.policy}
                                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                            </a>
                        </p>
                    </div>

                    <div className="flex h-[52px] flex-none items-center justify-end border-t border-slate-800 px-4">
                        <FillButton Icon={Check} onClick={onConfirm}>{n.confirm}</FillButton>
                    </div>
                </div>
            </div>
        </>
    );
}

/**
 * One thing that leaves the device: what it is, then when it goes. The "when" is a step quieter
 * than the "what" but not the app's usual slate-500 note: it is half of what is being confirmed,
 * and at 12px on this card slate-500 is about 4:1.
 */
function Sent({ title, what, when }: { title: string; what: string; when: string }) {
    return (
        <section className="border-l-2 border-slate-700 pl-3">
            <h3 className="font-bold text-slate-200">{title}</h3>
            <p className="text-slate-300">{what}</p>
            <p className="text-slate-400">{when}</p>
        </section>
    );
}

/** What is done with it, where it is, how it goes. */
function Point({ title, body }: { title: string; body: string }) {
    return (
        <section>
            <h3 className="font-bold text-slate-200">{title}</h3>
            <p className="text-slate-300">{body}</p>
        </section>
    );
}
