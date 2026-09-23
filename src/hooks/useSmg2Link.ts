'use client';

/**
 * Link state for the UI.
 *
 * This hook holds facts about the CABLE and nothing else. Whether a workspace is loaded, whether
 * it has been edited, what the hub should say — all of that is derived at render time from the
 * data itself. Storing it here would create a second source of truth, and the failure mode of a
 * second source of truth on a tool like this is a control that says the wrong thing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
    Ds2Address,
    Ds2Link,
    WebSerialTransport,
    type Ds2ByteTransport,
} from '@tsunagi/ds2-core';
import {
    CALIBRATION_WINDOW,
    Smg2ReadError,
    Smg2ReadLink,
    regionFor,
    type ReadScope,
    probeAddressSpace,
    readTwiceAndCompare,
    type ProbeCandidate,
    type ProbeReport,
    type ReadProgress,
    type ReadResult,
} from '@tsunagi/ds2-smg2';

import {
    TracingTransport,
    createDs2Transport,
    describeTransport,
    transportAvailability,
    type TraceSnapshot,
    type TransportAvailability,
    type TransportKind as RouteKind,
} from '@tsunagi/ds2-transport';

import { practiceRequestPort } from '@/lib/practiceEcu';

/**
 * Only states of the connection itself.
 *
 * `loaded` is deliberately absent: an image being present is a property of the workspace, and the
 * cable does not know or care. The reference DME tuner removed exactly these members for exactly
 * this reason after they produced a hub that offered to read while nothing was connected.
 */
export type LinkPhase = 'disconnected' | 'connecting' | 'connected' | 'probing' | 'reading';

/**
 * How the cable is reached.
 *
 * The ROUTE (`web-serial` / `web-usb-ftdi`) is decided in `@/lib/transport`, which follows the
 * Tuner: Android is routed to WebUSB by name, because Chrome for Android exposes Web Serial and
 * that Web Serial cannot see a USB cable. Nothing in this hook second-guesses that.
 *
 * `practice` is not a route — it is the simulated device, and it needs no hardware at all.
 */
export type ConnectMode = RouteKind | 'practice';

export type { TransportAvailability } from '@tsunagi/ds2-transport';

export interface Smg2LinkState {
    readonly phase: LinkPhase;
    readonly practice: boolean;
    /** Which route the current (or last attempted) connection used. */
    readonly transport: ConnectMode | null;
    readonly transports: TransportAvailability;
    /** One sentence naming the route, and why it is not the other one where that matters. */
    readonly transportNote: string;
    readonly supported: boolean;
    readonly error: string | null;
    /**
     * The segment and base reads will use. Null means nothing usable was found.
     *
     * Adopted from the probe's CONFIRMED result when there is one, and from its best plausible
     * candidate otherwise — because a read is read-only and harmless, and requiring confirmation
     * made this permanently null on every real vehicle (scoring caps at 0.6 without a ZB number to
     * match, against a 0.75 threshold). `addressSpaceConfidence` is what the UI must say out loud.
     */
    readonly addressSpace: ProbeCandidate | null;
    readonly addressSpaceConfidence: 'confirmed' | 'unconfirmed' | 'none';
    readonly probeReport: ProbeReport | null;
    readonly progress: ReadProgress | null;
    readonly lastRead: ReadResult | null;
    /** Set when a read was verified by reading the same range twice. */
    readonly verifiedByReread: boolean | null;
    readonly manufacturerData: string | null;
    readonly log: readonly string[];
    /**
     * The last error, kept after the phase returns to idle.
     *
     * `error` is cleared when the next operation starts; this is not. A report filed after the fact
     * has to be able to say what went wrong, and by then the UI has moved on.
     */
    readonly lastFailure: { kind: 'connect' | 'probe' | 'read'; message: string; at: number } | null;
}

export interface Smg2LinkApi extends Smg2LinkState {
    /** `auto` uses the detected route. `practice` needs no hardware. */
    connect(kind: ConnectMode | 'auto'): Promise<void>;
    disconnect(): Promise<void>;
    probe(expectedZbNumber?: string): Promise<ProbeReport | null>;
    /**
     * Read a region.
     *
     * `verify` reads the same range a second time and returns nothing unless the two passes agree.
     * It is the default for the calibration window, where it costs about a minute. For the full
     * 512 KiB image a second pass is another ~18 minutes with the ignition on, so it is offered
     * rather than imposed — and the result says which it was, because "not verified" and
     * "verified" are different claims about the same bytes.
     */
    /**
     * Stop the read in progress at the next telegram boundary.
     *
     * `read` still resolves — with whatever arrived, marked `partial` — rather than rejecting. A
     * stop is a decision, not a fault, so nothing here turns red and no diagnostic is filed.
     */
    cancelRead(): void;
    read(scope: ReadScope, verify: boolean): Promise<{
        bytes: Uint8Array;
        read: ReadResult;
        verified: boolean;
        partial: boolean;
    } | null>;
    clearError(): void;
    /** Adopt a candidate by hand, from the probe list. Marks the address space unconfirmed. */
    selectAddressSpace(candidate: ProbeCandidate): void;
    /** The telegram trace for the current session. Null before anything has been sent. */
    traceSnapshot(): TraceSnapshot | null;
}

const KEEP_ALIVE_INTERVAL_MS = 2000;

export function useSmg2Link(): Smg2LinkApi {
    const [state, setState] = useState<Smg2LinkState>({
        phase: 'disconnected',
        practice: false,
        transport: null,
        transports: { kind: 'none', android: false, hasWebSerial: false, hasWebUsb: false, forced: null },
        transportNote: '',
        supported: true,
        error: null,
        addressSpace: null,
        addressSpaceConfidence: 'none',
        probeReport: null,
        progress: null,
        lastRead: null,
        verifiedByReread: null,
        manufacturerData: null,
        log: [],
        lastFailure: null,
    });

    const linkRef = useRef<Ds2Link | null>(null);
    const smg2Ref = useRef<Smg2ReadLink | null>(null);
    const transportRef = useRef<Ds2ByteTransport | null>(null);
    /**
     * The tracing decorator, kept separately from the transport it wraps.
     *
     * Held across the whole session rather than per-operation: a fault that only shows up on the
     * third read is not visible in a trace that starts at the third read.
     */
    const traceRef = useRef<TracingTransport | null>(null);
    /**
     * A synchronous mirror of the phase.
     *
     * A handler that awaits a two-minute read would otherwise see the state frozen at the render
     * that created it. Anything a long operation has to check reads this, not `state`.
     */
    const phaseRef = useRef<LinkPhase>('disconnected');

    const setPhase = useCallback((phase: LinkPhase) => {
        phaseRef.current = phase;
        setState(s => ({ ...s, phase }));
    }, []);

    const append = useCallback((line: string) => {
        setState(s => ({ ...s, log: [...s.log.slice(-499), `${new Date().toISOString().slice(11, 23)}  ${line}`] }));
    }, []);

    // Detected after mount, never during render: `navigator` does not exist while Next prerenders
    // this page to static HTML, and a value read at module scope would be baked into the export.
    useEffect(() => {
        const transports = transportAvailability();
        setState(s => ({
            ...s,
            transports,
            transportNote: describeTransport(transports),
            supported: transports.kind !== 'none',
        }));
    }, []);

    // Keep-alive. Only while genuinely idle on a connection: the command gate would serialise it
    // anyway, but sending one behind a read just adds an exchange to a queue that is already the
    // slowest thing in the app.
    useEffect(() => {
        if (state.phase !== 'connected') return;
        const timer = setInterval(() => {
            const link = linkRef.current;
            if (!link || phaseRef.current !== 'connected') return;
            void link.keepAlive().catch(() => { /* a failed keep-alive surfaces on the next command */ });
        }, KEEP_ALIVE_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [state.phase]);

    const connect = useCallback(async (requested: ConnectMode | 'auto') => {
        if (phaseRef.current !== 'disconnected') return;

        // Detected here, not at mount: a phone that gains an OTG adapter between page load and the
        // first tap should not need a reload.
        const available = transportAvailability();
        const kind: ConnectMode | 'none' = requested === 'auto' ? available.kind : requested;
        const practice = kind === 'practice';

        setPhase('connecting');
        setState(s => ({
            ...s, error: null, practice, transports: available,
            transportNote: describeTransport(available),
            transport: kind === 'none' ? null : kind,
        }));
        try {
            if (kind === 'none') throw new Error(describeTransport(available));

            // One decision, one place. `createDs2Transport` builds Web Serial or the FTDI/WebUSB
            // backend from the same rule the UI reports — so the route the screen names is the route
            // that runs. Practice keeps ds2-core's simulated port behind the same Web Serial
            // transport, which is what makes it exercise the real buffering rather than a mock.
            const base: Ds2ByteTransport = practice
                ? new WebSerialTransport({ requestPort: practiceRequestPort().requestPort })
                : createDs2Transport();
            // Wrapped so every byte the link writes and reads is recorded. It sits between the link
            // and the backend, so a phone's trace and a laptop's trace are produced by one code path
            // and are directly comparable.
            const traced = new TracingTransport(base);
            traceRef.current = traced;
            const transport: Ds2ByteTransport = traced;

            if (practice) {
                append('PRACTICE: simulated SMG II. The bytes it returns are invented.');
            } else if (kind === 'web-usb-ftdi') {
                append('WebUSB / FTDI. Grant the cable when the chooser appears.');
            } else {
                append('Web Serial. Pick the K+DCAN cable’s COM port when the chooser opens.');
            }

            const link = new Ds2Link(transport, { address: Ds2Address.SMG });
            await link.connect();

            transportRef.current = transport;
            linkRef.current = link;
            smg2Ref.current = new Smg2ReadLink(link);
            setPhase('connected');
            append(`connected to DS2 0x${Ds2Address.SMG.toString(16)} (SMG II) at 9600 8E1 ` +
                `via ${kind === 'web-usb-ftdi' ? 'WebUSB/FTDI'
                    : kind === 'practice' ? 'the practice device' : 'Web Serial'}`);
        } catch (error) {
            setPhase('disconnected');
            const message = (error as Error).message;
            setState(s => ({
                ...s, error: message,
                lastFailure: { kind: 'connect', message, at: Date.now() },
            }));
            append(`connect failed: ${message}`);
        }
    }, [append, setPhase]);

    const disconnect = useCallback(async () => {
        const link = linkRef.current;
        linkRef.current = null;
        smg2Ref.current = null;
        transportRef.current = null;
        setPhase('disconnected');
        setState(s => ({
            ...s, addressSpace: null, addressSpaceConfidence: 'none', probeReport: null,
            progress: null, manufacturerData: null, transport: null,
        }));
        try {
            await link?.disconnect();
            append('disconnected');
        } catch (error) {
            append(`disconnect reported: ${(error as Error).message}`);
        }
    }, [append, setPhase]);

    const probe = useCallback(async (expectedZbNumber?: string) => {
        const smg2 = smg2Ref.current;
        if (!smg2 || phaseRef.current !== 'connected') return null;
        setPhase('probing');
        setState(s => ({ ...s, error: null }));
        try {
            let manufacturerData: string | null = null;
            try {
                const raw = await smg2.readManufacturerData();
                manufacturerData = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join(' ');
                append(`manufacturer data (0x53): ${manufacturerData}`);
            } catch (error) {
                // Not fatal. It is one more piece of evidence, not the probe itself.
                append(`manufacturer data unavailable: ${(error as Error).message}`);
            }

            // No practice fallback. Supplying the simulator's own ZB number here made the probe
            // confirm in practice and never confirm on a car — which is precisely how a READ face
            // that was unreachable on real hardware passed every rehearsal. Whatever the operator
            // typed is what gets matched, in both modes.
            const zb = expectedZbNumber;
            const report = await probeAddressSpace(smg2, {
                expectedZbNumber: zb,
                onCandidate: c => append(
                    `probe seg 0x${c.segment.toString(16).padStart(2, '0')} ` +
                    `base 0x${c.baseAddress.toString(16).padStart(6, '0')} -> ` +
                    `${Math.round(c.score * 100)}% (${c.reasons[0] ?? ''})`),
            });
            append(`probe result: ${report.summary}`);
            setPhase('connected');
            setState(s => ({
                ...s,
                probeReport: report,
                addressSpace: report.identified ?? report.best,
                addressSpaceConfidence: report.confidence,
                manufacturerData,
            }));
            return report;
        } catch (error) {
            setPhase('connected');
            const message = (error as Error).message;
            setState(s => ({
                ...s, error: message,
                lastFailure: { kind: 'probe', message, at: Date.now() },
            }));
            append(`probe failed: ${message}`);
            return null;
        }
    }, [append, setPhase, state.practice]);

    const read = useCallback(async (scope: ReadScope, verify: boolean) => {
        const smg2 = smg2Ref.current;
        const addressSpace = state.addressSpace;
        if (!smg2 || !addressSpace || phaseRef.current !== 'connected') return null;

        const region = regionFor(scope);
        const base = addressSpace.baseAddress + region.start;

        const startedAt = Date.now();
        setPhase('reading');
        setState(s => ({ ...s, error: null, progress: null, verifiedByReread: null }));
        try {
            append(`reading ${region.length.toLocaleString()} bytes at 0x${base.toString(16)}` +
                (verify ? ' (pass 1 of 2)' : ' (single pass, not verified)'));

            const first = await smg2.readRange(
                addressSpace.segment, base, region.length,
                p => setState(s => ({ ...s, progress: p })));

            append(`done in ${(first.elapsedMs / 1000).toFixed(1)}s ` +
                `(${first.exchanges} exchanges, ${first.retries} retries)`);

            if (!verify) {
                setPhase('connected');
                setState(s => ({ ...s, lastRead: first, verifiedByReread: null }));
                return { bytes: first.bytes, read: first, verified: false, partial: false };
            }

            // One read cannot establish that a read is correct. A second pass cannot prove it
            // either, but a mismatch disproves it — and the alternative is editing bytes nobody
            // checked.
            append('verifying with a second pass...');
            const second = await smg2.readRange(
                addressSpace.segment, base, region.length,
                p => setState(s => ({ ...s, progress: p })));

            let firstDifference: number | null = null;
            for (let i = 0; i < region.length; i++) {
                if (first.bytes[i] !== second.bytes[i]) { firstDifference = i; break; }
            }

            setPhase('connected');
            if (firstDifference !== null) {
                const message = `the two passes disagree at offset 0x${firstDifference.toString(16)}. ` +
                    `The dump is not trustworthy; check the cable and the connection before reading again.`;
                setState(s => ({
                    ...s, error: message, verifiedByReread: false, lastRead: first,
                    lastFailure: { kind: 'read', message, at: Date.now() },
                }));
                append(`VERIFY FAILED: ${message}`);
                return null;
            }

            append('both passes are byte-identical');
            setState(s => ({ ...s, lastRead: first, verifiedByReread: true }));
            return { bytes: first.bytes, read: first, verified: true, partial: false };
        } catch (error) {
            setPhase('connected');
            const message = (error as Error).message;
            const cancelled = error instanceof Smg2ReadError && error.cancelled;
            // A stop the operator asked for is not a fault: no red, and nothing filed as a failure
            // that a diagnostic upload would then report as the ECU misbehaving.
            setState(s => cancelled
                ? { ...s, error: null }
                : { ...s, error: message, lastFailure: { kind: 'read', message, at: Date.now() } });
            append(cancelled ? 'read stopped by the operator' : `read failed: ${message}`);

            /**
             * Hand back what did arrive.
             *
             * A full-image read is ~18 minutes; discarding 90% of it because the last telegram
             * failed wastes a session for nothing, and the bytes that landed are still bytes off
             * the ECU. It is returned marked `partial` so nothing downstream can mistake it for a
             * complete image — the caller decides whether a truncated dump is worth keeping.
             */
            if (error instanceof Smg2ReadError && error.partial.length > 0) {
                append(`keeping the ${error.partial.length.toLocaleString()} bytes that did arrive`);
                return {
                    bytes: error.partial,
                    read: {
                        bytes: error.partial,
                        baseAddress: base,
                        segment: addressSpace.segment,
                        chunkSize: smg2.chunkSize ?? 0,
                        exchanges: error.exchanges,
                        retries: error.retries,
                        // Measured, not zero. How long a partial took is the datum that says what
                        // rate this cable and this ECU actually sustain over a long read — which
                        // is most of what a failed full dump is worth keeping for.
                        elapsedMs: Date.now() - startedAt,
                    },
                    verified: false,
                    partial: true,
                };
            }
            return null;
        }
    }, [append, setPhase, state.addressSpace]);

    const clearError = useCallback(() => setState(s => ({ ...s, error: null })), []);
    const selectAddressSpace = useCallback((candidate: ProbeCandidate) => {
        setState(s => ({ ...s, addressSpace: candidate, addressSpaceConfidence: 'unconfirmed' }));
        append(`address space set by hand: seg 0x${candidate.segment.toString(16).padStart(2, '0')} ` +
            `base 0x${candidate.baseAddress.toString(16)}`);
    }, [append]);
    const traceSnapshot = useCallback(() => traceRef.current?.snapshot() ?? null, []);
    const cancelRead = useCallback(() => smg2Ref.current?.abort(), []);

    return {
        ...state, connect, disconnect, probe, read, cancelRead, clearError,
        selectAddressSpace, traceSnapshot,
    };
}
