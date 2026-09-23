import { describe, expect, it } from 'vitest';
import { Ds2Link, DS2_DEFAULT_TIMINGS } from './link';
import { WebSerialTransport } from './transport';
import { simulatedPort, type ExchangeBehavior } from './simulator';
import { Ds2Address, Ds2Control, Ds2Status, toHex } from './frame';
import { isDs2Error } from './errors';

/**
 * Every test here drives the REAL WebSerialTransport and Ds2Link against a
 * simulated device. Nothing is mocked out of the path under test.
 */
async function connected(
    script: ExchangeBehavior[] = [],
    opts: { address?: number; timings?: Partial<typeof DS2_DEFAULT_TIMINGS> } = {},
) {
    const address = opts.address ?? Ds2Address.DME;
    const { port, requestPort } = simulatedPort({ address, script });
    const transport = new WebSerialTransport({ requestPort });
    const link = new Ds2Link(transport, {
        address,
        // Keep the failure paths quick; the real defaults are asserted separately.
        timings: { responseTimeoutMs: 120, retryDelayMs: 1, resyncSettleMs: 0, breakSettleMs: 1, ...opts.timings },
    });
    await link.connect();
    return { link, port, transport };
}

describe('connect', () => {
    it('opens 8E1 at 9600 — the parity is not negotiable', () => {
        // An 8N1 receiver samples the parity bit where the stop bit should be, so
        // every even-popcount byte raises a framing error. DS2's own address 0x12
        // and ACK 0xA0 both have popcount 2.
        return connected().then(({ port }) => {
            expect(port.opens).toHaveLength(1);
            expect(port.opens[0]).toMatchObject({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'even' });
        });
    });

    it('de-asserts DTR and RTS on open', async () => {
        const { port } = await connected();
        expect(port.signals).toContainEqual({ dataTerminalReady: false, requestToSend: false });
    });
});

describe('exchange', () => {
    it('verifies the echo and returns the parsed response', async () => {
        const { link, port } = await connected([
            { kind: 'respond', payload: new Uint8Array([0x01, 0x02]) },
        ]);
        const frame = await link.exchange(Ds2Control.READ_IO_STATUS, new Uint8Array([0x03]));

        expect(frame.controlOrStatus).toBe(Ds2Status.ACKNOWLEDGE);
        expect(Array.from(frame.payload)).toEqual([0x01, 0x02]);
        // The device saw exactly the frame we meant to send.
        // 0x12 ^ 0x05 ^ 0x0b ^ 0x03 = 0x1f
        expect(toHex(port.trace[0].bytes)).toBe('12 05 0b 03 1f');
    });

    it('classifies an electrically corrupted echo and does not retry it away', async () => {
        // Bits pulled low only — the physically honest corruption.
        const { link } = await connected([{ kind: 'corruptEcho', mask: 0xf0, trailingZeros: 2 }]);
        const err = await link.exchange(Ds2Control.KEEP_ALIVE).catch((e) => e);

        expect(isDs2Error(err)).toBe(true);
        expect(err.code).toBe('ECHO_MISMATCH');
        expect(err.kind).toBe('electrical');
        // The analysis rides as data, so a UI can branch without parsing prose.
        expect(err.detail.analysis.flips0to1).toBe(0);
    });

    it('classifies a stale reply in the echo slot as a recoverable desync', async () => {
        const { link } = await connected([{ kind: 'staleResponse' }]);
        const err = await link.exchange(Ds2Control.KEEP_ALIVE).catch((e) => e);

        expect(err.code).toBe('ECHO_MISMATCH');
        expect(err.kind).toBe('desync');
    });

    it('times out when the ECU echoes and then goes quiet', async () => {
        const { link } = await connected([{ kind: 'silent' }]);
        const err = await link.exchange(Ds2Control.KEEP_ALIVE).catch((e) => e);

        expect(err.code).toBe('READ_TIMEOUT');
        expect(err.kind).toBe('timeout');
    });

    it('rejects a response from the wrong address before trusting its length byte', async () => {
        // Out of frame, a bogus length would swallow the next response or stall a
        // whole timeout, so the address check has to come first.
        const { link, port } = await connected([{ kind: 'dead' }]);
        const pending = link.exchange(Ds2Control.KEEP_ALIVE).catch((e) => e);
        const request = new Uint8Array([0x12, 0x04, 0x9e, 0x88]);
        port.emit(request); // the echo
        port.emit(new Uint8Array([Ds2Address.SMG, 0xff, 0xa0, 0x00])); // someone else's frame
        const err = await pending;

        expect(err.code).toBe('ADDRESS_MISMATCH');
        expect(err.kind).toBe('desync');
    });
});

describe('the command gate', () => {
    it('refuses a second concurrent operation instead of interleaving frames', async () => {
        const { link } = await connected([{ kind: 'silent' }, { kind: 'respond' }]);
        const first = link.exchange(Ds2Control.KEEP_ALIVE).catch(() => 'first-failed');
        const err = await link.exchange(Ds2Control.READ_ERROR_MEMORY).catch((e) => e);

        expect(err.code).toBe('GATE_HELD');
        await first;
    });

    it('releases the gate after a failure', async () => {
        const { link } = await connected([{ kind: 'silent' }, { kind: 'respond' }]);
        await link.exchange(Ds2Control.KEEP_ALIVE).catch(() => undefined);
        expect(link.isBusy).toBe(false);
        await expect(link.exchange(Ds2Control.KEEP_ALIVE)).resolves.toBeDefined();
    });

    it('does not deadlock on its own gate — public operations compose through private inner methods', async () => {
        // login() takes the gate and internally performs two exchanges. If those
        // went through the public gated exchange() it would deadlock here.
        const { link } = await connected([
            { kind: 'respond', payload: new Uint8Array(42) }, // 46-byte seed frame
            { kind: 'respond' },
        ]);
        await expect(link.login()).resolves.toBe('unlocked');
    });
});

describe('keepAlive', () => {
    it('never throws, and skips rather than queuing when the gate is held', async () => {
        const { link } = await connected([{ kind: 'silent' }, { kind: 'respond' }]);
        const inFlight = link.exchange(Ds2Control.READ_ERROR_MEMORY).catch(() => undefined);

        // A timer has nothing to catch a rejection, so losing the race for the
        // gate must be a normal `false`, not an unhandled rejection.
        await expect(link.keepAlive()).resolves.toBe(false);
        await inFlight;
    });

    it('returns false rather than throwing when the exchange fails', async () => {
        const { link } = await connected([{ kind: 'dead' }]);
        await expect(link.keepAlive()).resolves.toBe(false);
    });

    it('reports true on a positive response', async () => {
        const { link } = await connected([{ kind: 'respond' }]);
        await expect(link.keepAlive()).resolves.toBe(true);
    });
});

describe('retry policy', () => {
    it('retries a transport failure and succeeds on a later attempt', async () => {
        const { link, port } = await connected([
            { kind: 'silent' }, // attempt 1 times out
            { kind: 'silent' }, // attempt 2 times out
            { kind: 'respond' }, // attempt 3 succeeds
        ]);
        const frame = await link.exchangeWithRetry(Ds2Control.READ_IO_STATUS, new Uint8Array([0x03]), {
            attempts: 3,
        });

        expect(frame.controlOrStatus).toBe(Ds2Status.ACKNOWLEDGE);
        expect(port.trace).toHaveLength(3);
    });

    it('gives up after the configured attempts and reports the last error', async () => {
        const { link, port } = await connected([
            { kind: 'silent' },
            { kind: 'silent' },
        ]);
        const err = await link
            .exchangeWithRetry(Ds2Control.KEEP_ALIVE, new Uint8Array(0), { attempts: 2 })
            .catch((e) => e);

        expect(err.code).toBe('READ_TIMEOUT');
        expect(port.trace).toHaveLength(2);
    });

    it('polls a BUSY status on its own budget instead of spending an attempt', async () => {
        // A slow commit must not burn the retries that exist for line faults.
        const { link, port } = await connected(
            [{ kind: 'busy', times: 3 }, { kind: 'respond' }],
            { timings: { busyPollIntervalMs: 1 } },
        );
        const frame = await link.exchangeWithRetry(Ds2Control.CLEAR_ADAPTATIONS, new Uint8Array([0x47]), {
            attempts: 1,
            tolerateBusy: true,
        });

        expect(frame.controlOrStatus).toBe(Ds2Status.ACKNOWLEDGE);
        // One attempt, but four telegrams: three BUSY plus the eventual ACK.
        expect(port.trace).toHaveLength(4);
    });
});

describe('negative responses', () => {
    it('names the numeric status rather than swallowing it', async () => {
        // "rejected (status 0xB0)" is a fact about the device; "rejected" is a
        // fact about nothing. 0xB0 is what proved 19200 baud is unimplemented.
        const { link } = await connected([{ kind: 'respond', status: Ds2Status.PARAMETER_ERROR }]);
        const frame = await link.exchange(Ds2Control.REQUEST_BAUD_SWITCH);
        const err = await Promise.resolve()
            .then(() => link.assertPositive(frame, 'Baud switch'))
            .catch((e) => e);

        expect(err.code).toBe('NEGATIVE_RESPONSE');
        expect(err.kind).toBe('refused');
        expect(err.detail.status).toBe(0xb0);
        expect(err.message).toContain('0xb0');
    });
});

describe('multi-module addressing', () => {
    it.each([
        ['DME', Ds2Address.DME],
        ['SMG', Ds2Address.SMG],
        ['DSC', Ds2Address.DSC],
    ])('talks to %s at its own address', async (_name, address) => {
        const { link, port } = await connected([{ kind: 'respond' }], { address });
        await link.exchange(Ds2Control.READ_ERROR_MEMORY);
        expect(port.trace[0].request.address).toBe(address);
    });
});

describe('defaults', () => {
    it('ships the measured timing values', () => {
        // These are evidence from a real vehicle, not taste. Changing one should
        // be a deliberate act with a measurement behind it.
        expect(DS2_DEFAULT_TIMINGS.responseTimeoutMs).toBe(2000);
        expect(DS2_DEFAULT_TIMINGS.breakSettleMs).toBe(400);
        expect(DS2_DEFAULT_TIMINGS.resyncSettleMs).toBe(30);
        expect(DS2_DEFAULT_TIMINGS.busyPollAttempts).toBe(13);
    });
});
