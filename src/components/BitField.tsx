'use client';

/**
 * A logic register, as switches.
 *
 * Three items in this definition are bitfields whose every documented bit is spelled out in the
 * XDF's own `<description>` — and all three render as a decimal integer, because `mmedtypeflags`
 * says "unsigned 16-bit" and nothing says "this is a bit pattern". `CFG: Logic` reads 65535.
 *
 * ## All sixteen bits, including the ones nobody documented
 *
 * `CFG: Logic` documents seven. The other nine read 1 in the car. Rendering only the documented
 * seven would say, by omission, that the rest are zero. Each undocumented bit is shown with its
 * stock value and the honest sentence: there is no predicted effect and no way to tell whether
 * changing it worked. That is a reason not to touch it, stated once, where the switch is.
 *
 * ## The legend is transcribed, not parsed
 *
 * The description writes a sixteen-bit field in seven-character notation (`0010000`), as prose,
 * with HTML entities in it. A regex that mis-read it would put a label on the wrong bit of a live
 * logic register — the one failure mode here that could not be noticed by looking. So the legend
 * lives in the catalog, and a test asserts the XDF still contains the sentence it was taken from.
 */

import type { OverlayNote } from '@tsunagi/xdf-engine';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { LABEL, Well } from './ui';

export interface BitFieldProps {
    /** The value currently in force. */
    raw: number;
    /** What the loaded image holds, so a changed bit can be marked. */
    baseRaw: number;
    bits: number;
    legend: NonNullable<OverlayNote['bits']>;
    onToggle: (bit: number) => void;
    disabled: boolean;
}

/** hex, binary grouped in fours, decimal — three different questions, one line. */
function readout(raw: number, width: number): string {
    const binary = (raw >>> 0).toString(2).padStart(width, '0');
    const grouped = binary.replace(/(.{4})(?=.)/g, '$1 ');
    return `0x${(raw >>> 0).toString(16).toUpperCase().padStart(width / 4, '0')}  ${grouped}  ${raw}`;
}

export function BitField({ raw, baseRaw, bits, legend, onToggle, disabled }: BitFieldProps) {
    const { t, lang } = useLang();
    const width = bits;

    return (
        <div>
            <p className="font-mono text-[11px] tabular-nums text-slate-300">{readout(raw, width)}</p>

            <div className="mt-2 flex flex-col">
                {legend.map(entry => {
                    const mask = 1 << entry.bit;
                    const on = (raw & mask) !== 0;
                    const wasOn = (baseRaw & mask) !== 0;
                    const changed = on !== wasOn;
                    return (
                        <div
                            key={entry.bit}
                            className="flex items-start gap-3 border-t border-slate-800/50 py-1.5 first:border-t-0"
                        >
                            <button
                                type="button"
                                role="switch"
                                aria-checked={on}
                                disabled={disabled}
                                onClick={() => onToggle(entry.bit)}
                                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                                    on ? 'bg-blue-500/40' : 'bg-slate-800'
                                } disabled:opacity-40`}
                            >
                                <span
                                    className={`size-3 rounded-full transition-transform ${
                                        on ? 'translate-x-3 bg-blue-400' : 'bg-slate-600'
                                    }`}
                                />
                            </button>
                            <span className="min-w-0 flex-1">
                                <span className={`font-mono text-[10px] tabular-nums ${
                                    changed ? 'text-blue-300' : 'text-slate-600'
                                }`}>
                                    bit {entry.bit}
                                </span>
                                <span className={`ml-2 text-[11px] leading-relaxed ${
                                    entry.documented ? 'text-slate-300' : 'text-slate-500'
                                }`}>
                                    {lang === 'ja' ? entry.labelJa : entry.label}
                                </span>
                            </span>
                        </div>
                    );
                })}
            </div>

            {legend.some(e => !e.documented) && (
                <Well className="mt-2">
                    <p className={`${LABEL} text-slate-600`}>{C.undocumentedBits}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        {t.undocumentedBitsNote}
                    </p>
                </Well>
            )}
        </div>
    );
}
