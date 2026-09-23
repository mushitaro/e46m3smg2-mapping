import { describe, expect, it } from 'vitest';
import { classifyEchoMismatch } from './echo';
import { Ds2Address, Ds2Status } from './frame';

// The request the tuner's captures were taken against: read I/O status block 6
// from the DME.
const SENT = new Uint8Array([0x12, 0x05, 0x0b, 0x06, 0x1a]);

describe('classifyEchoMismatch', () => {
    it('reproduces the real vehicle capture that motivated the classifier', () => {
        // sent 12 05 0b 06 1a, got 05 08 00 00 00 — recorded on a car, on the
        // one code path that already had drain + resync + three retries. It
        // failed anyway, which is the point: this is not something a retry can
        // fix. At lag +1 every changed bit goes 1→0 and none go 0→1.
        const got = new Uint8Array([0x05, 0x08, 0x00, 0x00, 0x00]);
        const a = classifyEchoMismatch(SENT, got, Ds2Address.DME);

        expect(a.lag).toBe(1);
        expect(a.allSubset).toBe(true);
        expect(a.flips0to1).toBe(0);
        expect(a.flips1to0).toBe(7); // as measured and written up at the time
        expect(a.kind).toBe('electrical');
        expect(a.verdict).toContain('electrical');
    });

    it('calls it electrical when every changed bit was pulled low', () => {
        // The K-line is open-collector: a device can only pull it LOW. A pure
        // 1→0 corruption is therefore something on the wire, not a desync.
        const got = new Uint8Array([0x12, 0x04, 0x0a, 0x02, 0x0a]);
        const a = classifyEchoMismatch(SENT, got, Ds2Address.DME);

        expect(a.allSubset).toBe(true);
        expect(a.flips0to1).toBe(0);
        expect(a.kind).toBe('electrical');
    });

    it('calls it desync when a stale response was read where the echo belonged', () => {
        const got = new Uint8Array([Ds2Address.DME, 0x05, Ds2Status.ACKNOWLEDGE, 0x00, 0x00]);
        const a = classifyEchoMismatch(SENT, got, Ds2Address.DME);

        expect(a.looksLikeResponse).toBe(true);
        expect(a.kind).toBe('desync');
        expect(a.verdict).toContain('software-recoverable');
    });

    it('recognises a stale response on SMG and DSC, not only the DME address', () => {
        // The tuner hardcoded 0x12 here. With the address a parameter, a stale
        // SMG reply is a desync on the SMG link — and NOT mistaken for one on
        // the DME link.
        const smgReply = new Uint8Array([Ds2Address.SMG, 0x05, Ds2Status.ACKNOWLEDGE, 0x00, 0x00]);
        expect(classifyEchoMismatch(SENT, smgReply, Ds2Address.SMG).kind).toBe('desync');
        expect(classifyEchoMismatch(SENT, smgReply, Ds2Address.DME).looksLikeResponse).toBe(false);

        const dscReply = new Uint8Array([Ds2Address.DSC, 0x05, Ds2Status.BUSY, 0x00, 0x00]);
        expect(classifyEchoMismatch(SENT, dscReply, Ds2Address.DSC).kind).toBe('desync');
    });

    it('treats a held-low tail as electrical even without a clean subset match', () => {
        const got = new Uint8Array([0xff, 0x00, 0x00]);
        const a = classifyEchoMismatch(SENT, got, Ds2Address.DME);
        expect(a.trailingZeroRun).toBeGreaterThanOrEqual(2);
        expect(a.kind).toBe('electrical');
    });

    it('refuses to call two matching bytes evidence of anything', () => {
        // "Needs enough bytes to be meaningful" — a subset match over 1-2 bytes
        // is noise, and claiming 'electrical' from it would send the user to the
        // physical checklist for no reason.
        const sentShort = new Uint8Array([0xff, 0xff]);
        const got = new Uint8Array([0xfe, 0xfd]);
        const a = classifyEchoMismatch(sentShort, got, Ds2Address.DME);
        expect(a.compared).toBeLessThan(3);
        expect(a.kind).toBe('unclassified');
    });

    it('prefers a desync verdict over an electrical one when the bytes parse as a response', () => {
        // A frame that is BOTH a bitwise subset and a valid-looking response
        // must be reported as recoverable — advising the physical checklist here
        // would send the user chasing a cable that is fine.
        const sent = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]);
        const got = new Uint8Array([Ds2Address.DME, 0x05, Ds2Status.ACKNOWLEDGE, 0x00, 0x00]);
        const a = classifyEchoMismatch(sent, got, Ds2Address.DME);
        expect(a.allSubset).toBe(true); // every bit is a subset of 0xFF
        expect(a.kind).toBe('desync');
    });

    it('never reports a lag beyond the alignments it searches', () => {
        const got = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
        const a = classifyEchoMismatch(SENT, got, Ds2Address.DME);
        expect(a.lag).toBeGreaterThanOrEqual(0);
        expect(a.lag).toBeLessThan(4);
    });

    it('handles an empty echo without throwing', () => {
        // The read timed out with nothing buffered. There is no alignment to
        // score, and the honest answer is "unclassified", not a crash.
        const a = classifyEchoMismatch(SENT, new Uint8Array(0), Ds2Address.DME);
        expect(a.compared).toBe(0);
        expect(a.kind).toBe('unclassified');
    });
});
