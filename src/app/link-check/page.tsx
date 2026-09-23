'use client';

/**
 * Link diagnostics — "what does this browser actually see?"
 *
 * Written in response to a "the K+DCAN cable is not recognised" report that could have had four
 * different causes, each producing the identical symptom. Rather than guess, this page reports the
 * facts that separate them:
 *
 *   1. Wrong route. Chrome for Android exposes Web Serial that lists ONLY Bluetooth serial ports,
 *      so a USB cable never appears. The app now routes Android to WebUSB by name; this page shows
 *      which route was chosen and why.
 *   2. Not an FTDI cable. The WebUSB chooser is filtered to vendor 0x0403, so a CH340 or Prolific
 *      clone produces an EMPTY chooser — indistinguishable from "not plugged in". The unfiltered
 *      probe below is what tells those apart.
 *   3. Not granted. WebUSB permission on Android is per-visit; `getDevices()` shows what is already
 *      granted without prompting.
 *   4. No OTG / no power. Then nothing enumerates at all, on either API.
 *
 * Everything here is read-only and none of it touches the ECU.
 */

import { useCallback, useEffect, useState } from 'react';
import { Usb, Cable, RefreshCw } from 'lucide-react';

import { FTDI_VENDOR_ID } from '@tsunagi/ds2-transport';
import { Field, LABEL, MicroLabel, Pane, Pill, Section, TextButton, Well } from '@/components/ui';
import { MMark } from '@/components/MMark';
import { describeTransport, transportAvailability, type TransportAvailability } from '@tsunagi/ds2-transport';

interface DeviceRow {
    vendorId: number;
    productId: number;
    vendorHex: string;
    productHex: string;
    name: string;
    /** Whether this app's filtered chooser would have offered it. */
    wouldMatchFilter: boolean;
}

/**
 * USB vendors that turn up on K+DCAN cables.
 *
 * Naming them is the point: a reader who sees `0x1A86 — WCH CH340` immediately knows why an
 * FTDI-filtered chooser was empty, which "unknown vendor 0x1a86" would not tell them.
 */
const KNOWN_VENDORS: Record<number, string> = {
    0x0403: 'FTDI — supported',
    0x1a86: 'WCH CH340/CH341 — NOT supported by this driver',
    0x067b: 'Prolific PL2303 — NOT supported by this driver',
    0x10c4: 'Silicon Labs CP210x — NOT supported by this driver',
    0x1a61: 'Abbott',
    0x2341: 'Arduino',
};

function describeVendor(vendorId: number): string {
    return KNOWN_VENDORS[vendorId] ?? 'unknown vendor';
}

export default function LinkCheckPage() {
    const [availability, setAvailability] = useState<TransportAvailability | null>(null);
    /**
     * Read after mount, not during render.
     *
     * `window.isSecureContext` differs between the prerendered HTML and the browser, and reading it
     * inline produced a hydration mismatch (React #418) on the deployed page — the same trap the
     * transport detection is careful about, walked into two files later.
     */
    const [secureContext, setSecureContext] = useState<boolean | null>(null);
    const [granted, setGranted] = useState<DeviceRow[] | null>(null);
    const [chosen, setChosen] = useState<DeviceRow | null>(null);
    const [serialPorts, setSerialPorts] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setAvailability(transportAvailability());
        setSecureContext(window.isSecureContext);
    }, []);

    const toRow = (d: { vendorId: number; productId: number }): DeviceRow => ({
        vendorId: d.vendorId,
        productId: d.productId,
        vendorHex: `0x${d.vendorId.toString(16).padStart(4, '0')}`,
        productHex: `0x${d.productId.toString(16).padStart(4, '0')}`,
        name: describeVendor(d.vendorId),
        wouldMatchFilter: d.vendorId === FTDI_VENDOR_ID,
    });

    const listGranted = useCallback(async () => {
        setError(null);
        const usb = (navigator as Navigator & { usb?: { getDevices(): Promise<{ vendorId: number; productId: number }[]> } }).usb;
        if (!usb) { setError('This browser has no WebUSB.'); return; }
        try {
            setGranted((await usb.getDevices()).map(toRow));
        } catch (e) {
            setError(`getDevices failed: ${(e as Error).message}`);
        }
    }, []);

    useEffect(() => { void listGranted(); }, [listGranted]);

    /**
     * The decisive probe: open the chooser with NO vendor filter.
     *
     * The app's own chooser filters to FTDI. If the cable shows up here and not there, the cable is
     * not an FTDI part and this driver cannot drive it — which is a different problem from a broken
     * cable, a missing OTG adapter, or a wrong route, and needs a different answer.
     */
    const probeAnyUsb = useCallback(async () => {
        setError(null);
        setBusy(true);
        try {
            const usb = (navigator as Navigator & {
                usb?: { requestDevice(o: { filters: unknown[] }): Promise<{ vendorId: number; productId: number }> };
            }).usb;
            if (!usb) throw new Error('This browser has no WebUSB.');
            const device = await usb.requestDevice({ filters: [] });
            setChosen(toRow(device));
            await listGranted();
        } catch (e) {
            const err = e as Error;
            setError(err.name === 'NotFoundError'
                ? 'The chooser was dismissed, or it listed nothing at all. Nothing listed means the ' +
                  'cable is not enumerating: check the OTG adapter and that the cable has power.'
                : `${err.name}: ${err.message}`);
        } finally {
            setBusy(false);
        }
    }, [listGranted]);

    const probeSerial = useCallback(async () => {
        setError(null);
        setBusy(true);
        try {
            const serial = (navigator as Navigator & {
                serial?: {
                    getPorts(): Promise<{ getInfo(): { usbVendorId?: number; usbProductId?: number } }[]>;
                    requestPort(): Promise<{ getInfo(): { usbVendorId?: number; usbProductId?: number } }>;
                };
            }).serial;
            if (!serial) throw new Error('This browser has no Web Serial.');
            await serial.requestPort();
            const ports = await serial.getPorts();
            setSerialPorts(ports.map(p => {
                const info = p.getInfo();
                return info.usbVendorId === undefined
                    ? 'a port with no USB identity (Bluetooth SPP or a built-in port)'
                    : `0x${info.usbVendorId.toString(16).padStart(4, '0')}:` +
                      `0x${(info.usbProductId ?? 0).toString(16).padStart(4, '0')} — ${describeVendor(info.usbVendorId)}`;
            }));
        } catch (e) {
            const err = e as Error;
            setError(err.name === 'NotFoundError'
                ? 'The port chooser was dismissed, or it was empty. On Android an empty chooser is ' +
                  'expected: Chrome there lists only Bluetooth serial ports. Use the WebUSB probe.'
                : `${err.name}: ${err.message}`);
        } finally {
            setBusy(false);
        }
    }, []);

    return (
        <main className="min-h-[100svh] bg-slate-950 font-sans text-slate-300">
            <header className="relative flex h-[48px] items-center gap-2 px-4">
                <MMark className="size-4 shrink-0" />
                <h1 className={`${LABEL} text-slate-200`}>Link check</h1>
                <a href="/" className={`${LABEL} ml-auto text-blue-400`}>Back</a>
                <div
                    className="absolute inset-x-0 bottom-0 h-px"
                    style={{
                        background:
                            'linear-gradient(to right, #0A9BDB 0 33.333%, #9B84E8 33.333% 66.667%, #F11A22 66.667% 100%)',
                    }}
                    aria-hidden="true"
                />
            </header>

            <div className="mx-auto max-w-[70ch] p-4">
                <Pane>
                    <Section
                        title="This browser"
                        note={availability ? describeTransport(availability) : 'detecting…'}
                    >
                        <div className="flex flex-wrap gap-x-6 gap-y-3">
                            <Field label="Route" value={availability?.kind ?? '…'}
                                tone={availability?.kind === 'none' ? 'text-amber-400' : 'text-emerald-400'} stacked />
                            <Field label="Android" value={availability?.android ? 'yes' : 'no'} stacked />
                            <Field label="Web Serial" value={availability?.hasWebSerial ? 'present' : 'absent'} stacked />
                            <Field label="WebUSB" value={availability?.hasWebUsb ? 'present' : 'absent'} stacked />
                            <Field label="Secure context"
                                value={secureContext === null ? '…' : String(secureContext)}
                                tone={secureContext === false ? 'text-red-400' : 'text-slate-200'}
                                stacked />
                        </div>
                        {availability?.forced && (
                            <Well className="mt-3">
                                <p className="text-[11px] text-amber-400">
                                    Route forced by <span className="font-mono">?transport={availability.forced}</span>.
                                    Remove it from the URL for the normal choice.
                                </p>
                            </Well>
                        )}
                    </Section>

                    <Section
                        title="USB devices this page may already use"
                        count={granted?.length}
                        actions={<TextButton Icon={RefreshCw} onClick={() => void listGranted()}>Refresh</TextButton>}
                        note="Already-granted devices. No prompt is shown for these."
                    >
                        <DeviceList rows={granted} empty="Nothing granted yet." />
                    </Section>

                    <Section
                        title="Probe: any USB device"
                        actions={
                            <TextButton Icon={Usb} disabled={busy} onClick={() => void probeAnyUsb()}>
                                Open unfiltered chooser
                            </TextButton>
                        }
                        note={
                            'The app’s own chooser only offers FTDI (vendor 0x0403). This one offers everything, ' +
                            'so it separates “the cable is not FTDI” from “the cable is not there”.'
                        }
                    >
                        {chosen ? <DeviceList rows={[chosen]} empty="" /> : (
                            <p className="text-[11px] text-slate-600">Not run yet.</p>
                        )}
                    </Section>

                    <Section
                        title="Probe: Web Serial ports"
                        actions={
                            <TextButton Icon={Cable} disabled={busy} onClick={() => void probeSerial()}>
                                Open port chooser
                            </TextButton>
                        }
                        note="On desktop the K+DCAN appears here as a COM port. On Android this list is Bluetooth only."
                    >
                        {serialPorts ? (
                            <div className="flex flex-col gap-1">
                                {serialPorts.length === 0
                                    ? <p className="text-[11px] text-slate-600">No ports granted.</p>
                                    : serialPorts.map((p, i) => (
                                        <div key={i} className="rounded bg-slate-800/40 px-2 py-1 font-mono text-[11px] text-slate-300">
                                            {p}
                                        </div>
                                    ))}
                            </div>
                        ) : <p className="text-[11px] text-slate-600">Not run yet.</p>}
                    </Section>

                    {/* A reserved slot so the page does not jump when a probe fails. */}
                    <div className="min-h-[52px]">
                        {error && (
                            <Well>
                                <p className="text-[11px] leading-relaxed text-red-400">{error}</p>
                            </Well>
                        )}
                    </div>
                </Pane>
            </div>
        </main>
    );
}

function DeviceList({ rows, empty }: { rows: DeviceRow[] | null; empty: string }) {
    if (rows === null) return <p className="text-[11px] text-slate-600">…</p>;
    if (rows.length === 0) return <p className="text-[11px] text-slate-600">{empty}</p>;
    return (
        <div className="flex flex-col gap-1">
            {rows.map((d, i) => (
                <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded bg-slate-800/40 px-2 py-1">
                    <span className="font-mono text-[11px] tabular-nums text-slate-200">
                        {d.vendorHex}:{d.productHex}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{d.name}</span>
                    <Pill tone={d.wouldMatchFilter ? 'ok' : 'danger'}>
                        {d.wouldMatchFilter ? 'driveable' : 'not FTDI'}
                    </Pill>
                </div>
            ))}
        </div>
    );
}
