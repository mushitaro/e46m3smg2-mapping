'use client';

import React, { useEffect } from 'react';
import { X, Download, RefreshCw, Shield, Smartphone, Trash2, Languages } from 'lucide-react';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';

/**
 * Everything the header used to carry, for windows too narrow to carry it. Modelled on the
 * reference tuner's `MobileMenu`.
 *
 * Below 900px the header has room for the wordmark, the link LED and the build — and nothing else.
 * The identity strip, the session facts, the tab list and the header's tool links go behind one
 * control, in **three bands, ordered outward from the thumb**: VIEW is the screen and sits nearest
 * the button that opened this; SESSION is the work; VEHICLE is the car and sits furthest. The icon
 * strip at the very top is the desktop header's right-hand cluster, drawn as icons.
 *
 * Deliberately NOT in here: anything that talks to the ECU. CONNECT, PROBE, READ, SHARE and the
 * arming scope stay on the dashboard where they are one tap apart and visible together — a menu
 * that has to be opened is the wrong place for a control whose state changes what comes off the
 * car.
 */
export function MobileMenu({
    onClose,
    tabs,
    activeTab,
    onSelectTab,
    vehicle,
    session,
    onExport,
    onClear,
    onReload,
    updateAvailable,
    installable,
    onInstall,
    onToggleLang,
    privacyHref,
}: {
    onClose: () => void;
    tabs: readonly { id: string; label: string; enabled: boolean }[];
    activeTab: string;
    onSelectTab: (id: string) => void;
    vehicle: { zb: string | null; hw: string | null; space: string | null; link: string };
    session: { source: string; variant: string | null; edits: number; crc: string | null } | null;
    onExport: (() => void) | null;
    onClear: (() => void) | null;
    onReload: () => void;
    updateAvailable: boolean;
    installable: boolean;
    onInstall: () => void;
    onToggleLang: () => void;
    /** The preview's privacy section; null on production, which draws no PRIVACY link. */
    privacyHref: string | null;
}) {
    const { t } = useLang();

    // Escape closes it, like every sheet.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const band = (label: string, children: React.ReactNode, scroll = false) => (
        <div className={`flex min-h-0 flex-col ${scroll ? 'flex-1' : 'flex-none'}`}>
            <div className="flex h-[26px] flex-none items-center border-b border-slate-900 px-4 text-[9px] font-bold tracking-widest text-slate-600">
                {label}
            </div>
            <div className={`px-4 py-2 ${scroll ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>{children}</div>
        </div>
    );

    const fact = (label: string, value: string | null) => (
        <div className="flex items-baseline gap-2 font-mono text-[10px]">
            <span className="w-[64px] shrink-0 text-slate-600">{label}</span>
            <span className="truncate text-slate-300">{value ?? '-'}</span>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end min-[900px]:hidden">
            {/* The scrim: a tap anywhere outside the sheet closes it. */}
            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />

            <div className="relative flex max-h-[85vh] flex-col rounded-t-lg bg-slate-900 shadow-xl">
                {/* The icon strip at the top IS the desktop header's right-hand cluster. It is the
                    furthest thing from the thumb, which is where a reload belongs. */}
                <div className="flex h-[44px] flex-none items-center justify-end gap-6 border-b border-slate-900 px-4">
                    {privacyHref && (
                        <a
                            href={privacyHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t.privacyHint}
                            className="text-slate-500 transition hover:text-slate-300"
                        >
                            <Shield className="size-5" />
                        </a>
                    )}
                    <button onClick={onToggleLang} title={t.switchLanguage} className="text-slate-500 transition hover:text-slate-300">
                        <Languages className="size-5" />
                    </button>
                    {installable && (
                        <button onClick={onInstall} title={C.install} className="text-slate-500 transition hover:text-slate-300">
                            <Smartphone className="size-5" />
                        </button>
                    )}
                    <button
                        onClick={onReload}
                        title={updateAvailable ? t.updateAvailableHint : t.reloadHint}
                        className={`flex items-center gap-1.5 transition ${updateAvailable ? 'animate-pulse text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        {updateAvailable
                            ? <span className="text-[10px] font-bold uppercase tracking-wider">{C.update}</span>
                            : <RefreshCw className="size-5" />}
                    </button>
                </div>

                {band(C.bandVehicle, (
                    <div className="space-y-1">
                        {fact('ZB', vehicle.zb)}
                        {fact('HW', vehicle.hw)}
                        {fact(C.fAddressSpace, vehicle.space)}
                        {fact(C.fRoute, vehicle.link)}
                    </div>
                ))}

                {band(C.bandSession, session ? (
                    <div className="space-y-1">
                        {fact(C.fSource, session.source)}
                        {fact(C.fBase, session.variant)}
                        {fact(C.fEdits, String(session.edits))}
                        {session.crc && fact('CRC', session.crc)}
                        <div className="flex items-center gap-4 pt-1">
                            {onExport && (
                                <button onClick={() => { onExport(); onClose(); }} className="flex items-center gap-1.5 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300 transition hover:text-blue-400">
                                    <Download className="size-3" /> {C.bExport}
                                </button>
                            )}
                            {onClear && (
                                <button onClick={() => { onClear(); onClose(); }} className="flex items-center gap-1.5 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition hover:text-red-400">
                                    <Trash2 className="size-3" /> {C.bClear}
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="text-[10px] text-slate-600">{t.nothingLoaded}</p>
                ))}

                {/* VIEW is nearest the thumb, and its list is unrolled so the FIRST tab is the row
                    closest to the button that opened this. */}
                {band(C.bandView, (
                    <div className="flex flex-col-reverse">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                disabled={!tab.enabled}
                                onClick={() => { onSelectTab(tab.id); onClose(); }}
                                className={`flex h-[40px] items-center text-[10px] font-bold tracking-widest transition ${activeTab === tab.id ? 'text-blue-400' : tab.enabled ? 'text-slate-400 hover:text-slate-200' : 'text-slate-700'}`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                ), true)}

                {/* Close, on the spot the finger is already touching. */}
                <div className="flex h-[52px] flex-none items-center justify-center border-t border-slate-900">
                    <button onClick={onClose} aria-label={C.close} className="flex size-[52px] items-center justify-center text-slate-400 transition hover:text-slate-200">
                        <X className="size-5" />
                    </button>
                </div>
            </div>
        </div>
    );
}
