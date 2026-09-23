/**
 * K-line echo classification.
 *
 * On a half-duplex bus the ECU echoes back everything we transmit, so every
 * exchange reads the echo first and compares it byte-for-byte. When it does not
 * match, this decides WHICH KIND of failure it was — because the two kinds need
 * opposite advice, and getting that wrong costs the user an afternoon.
 *
 * Pure and self-contained, so it can be reasoned about and unit-tested without
 * a serial port. This is where the highest-value diagnostics in the whole stack
 * live.
 *
 * Ported from the MSS54HP CSL Convert Tuner. One change: the DS2 address is a
 * parameter rather than the hardcoded DME 0x12, so the same classifier serves
 * SMG (0x32) and DSC (0x56).
 */

import { Ds2Status } from './frame';

export interface EchoMismatchAnalysis {
    /** Byte offset at which `got` best lines up with `sent` (0 = same position, 1 = one byte lost). */
    lag: number;
    /** How many byte pairs the verdict rests on. */
    compared: number;
    /** Every compared byte of `got` is a bitwise subset of its `sent` byte (only 1→0, never 0→1). */
    allSubset: boolean;
    flips1to0: number;
    flips0to1: number;
    trailingZeroRun: number;
    /** `got` looks like a DS2 response frame — i.e. we read a reply where the echo belonged. */
    looksLikeResponse: boolean;
    /**
     * The verdict as a value rather than prose, so the UI can branch on it
     * instead of re-deriving the classification (or worse, matching on the
     * sentence below).
     */
    kind: 'electrical' | 'desync' | 'unclassified';
    verdict: string;
}

/**
 * Explains WHY a K-line echo didn't match, so an unstable-cable report can be
 * told apart from a software desync without a second forensic pass.
 *
 * The discriminator is bit direction. The K-line is open-collector: a device can
 * only pull it LOW, never drive it high. So if every received bit that changed
 * went 1→0 and none went 0→1, the request was electrically corrupted on the
 * wire — a cable, connector, ground, or ECU-reset event, and retrying will not
 * help. If instead `got` parses as the head of a DS2 response, the buffer was
 * simply out of frame and a stale reply was read in the echo's place, which IS
 * a software-recoverable desync.
 *
 * @param sent    the bytes we transmitted
 * @param got     the bytes read back where the echo should have been
 * @param address the DS2 address we are talking to, used to recognise a stale
 *                response frame. Pass the address of the module in session.
 */
export function classifyEchoMismatch(
    sent: Uint8Array,
    got: Uint8Array,
    address: number,
): EchoMismatchAnalysis {
    let trailingZeroRun = 0;
    for (let i = got.length - 1; i >= 0 && got[i] === 0; i--) trailingZeroRun++;

    const looksLikeResponse =
        got.length >= 3 &&
        got[0] === address &&
        (got[2] === Ds2Status.ACKNOWLEDGE ||
            got[2] === Ds2Status.BUSY ||
            got[2] === Ds2Status.REJECTED);

    // Try small alignments; a dropped leading byte shifts everything by one.
    // Score by how well the "only pulled low" model fits, so the winner is the
    // alignment that best explains the corruption.
    let best: EchoMismatchAnalysis | null = null;
    for (let lag = 0; lag < Math.min(4, sent.length); lag++) {
        let compared = 0,
            flips1to0 = 0,
            flips0to1 = 0,
            subset = true;
        for (let i = 0; i + lag < sent.length && i < got.length; i++) {
            const s = sent[i + lag],
                g = got[i];
            compared++;
            flips1to0 += popcount(s & ~g);
            flips0to1 += popcount(~s & g & 0xff);
            if ((g & ~s & 0xff) !== 0) subset = false;
        }
        if (compared === 0) continue;
        const candidate: EchoMismatchAnalysis = {
            lag,
            compared,
            allSubset: subset,
            flips1to0,
            flips0to1,
            // Both filled in once a winner is picked — scoring below only reads the bit counts.
            trailingZeroRun,
            looksLikeResponse,
            kind: 'unclassified',
            verdict: '',
        };
        // Prefer an alignment where nothing went 0→1 (physically impossible from
        // an interfering driver), then the one covering the most bytes, then the
        // fewest corrupted bits.
        if (
            !best ||
            (candidate.allSubset && !best.allSubset) ||
            (candidate.allSubset === best.allSubset && candidate.compared > best.compared) ||
            (candidate.allSubset === best.allSubset &&
                candidate.compared === best.compared &&
                candidate.flips1to0 < best.flips1to0)
        ) {
            best = candidate;
        }
    }

    const a = best ?? {
        lag: 0,
        compared: 0,
        allSubset: false,
        flips1to0: 0,
        flips0to1: 0,
        trailingZeroRun,
        looksLikeResponse,
        kind: 'unclassified' as const,
        verdict: '',
    };

    a.kind = looksLikeResponse
        ? 'desync'
        : // Needs enough bytes to be meaningful: one or two matching bytes prove nothing.
          (a.compared >= 3 && a.allSubset && a.flips0to1 === 0) || a.trailingZeroRun >= 2
          ? 'electrical'
          : 'unclassified';

    a.verdict = looksLikeResponse
        ? 'a stale DS2 response was read where the echo belonged — buffer out of frame (software-recoverable)'
        : a.compared >= 3 && a.allSubset && a.flips0to1 === 0
          ? 'line-level electrical event — the K-line was pulled low during our own transmission (cable, connector, ground, or ECU reset). Not a buffer desync.'
          : a.trailingZeroRun >= 2
            ? 'the line was held low (break / framing errors) — electrical, not a buffer desync'
            : 'unclassified — could be either a desync or line noise';
    return a;
}

function popcount(byte: number): number {
    let n = byte & 0xff,
        c = 0;
    while (n) {
        c += n & 1;
        n >>>= 1;
    }
    return c;
}

/**
 * What software cannot fix. Write this down in the app, not just in a commit
 * message.
 *
 * A corruption that is exclusively 1→0 with a held-low tail is something pulling
 * the line down while we transmit. No settle duration, retry count, busy
 * handling or drain policy prevents it. When the classifier says `electrical`,
 * show this instead of "check the connection and retry" — that advice cannot
 * work for an electrical fault, and mitigations must not imply they might.
 *
 * Ordered cheapest-discriminator-first.
 */
export const ELECTRICAL_FAULT_CHECKLIST: readonly string[] = [
    'Compare failure rates with the engine off vs running. If it only misbehaves while running, it is ignition/motor EMI on an unshielded cable — not the software.',
    'Reseat the OBD connector, and wiggle-test it while connected.',
    'Try a different USB port, with no hub in between.',
    "Check the port's ground and supply.",
    "Note the adapter's VID/PID — clone FTDI chips are common.",
];
