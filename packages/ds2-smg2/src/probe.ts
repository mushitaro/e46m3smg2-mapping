/**
 * Finding the SMG II's calibration in its own address space.
 *
 * Two things are unknown and the files disagree about one of them: which segment byte DS2 control
 * 0x06 wants, and what base address the 512 KiB image sits at from the diagnostic side. Rather
 * than pick the more convenient reading of `SMG2.prg`, this probes — and the probe is worth
 * running because the definition hands us an unambiguous answer key.
 *
 * The MS4X definition places `IDENT1` (60 bytes at 0x37715) and `IDENT0` (48 bytes at 0x37FC0)
 * inside the calibration window. Those are the ECU's own part-number strings. A candidate that is
 * pointing at the right place shows them; one that is not shows 0x00, 0xFF, or noise. So each
 * candidate gets a yes/no, not a judgement call.
 *
 * Every exchange here is a read of at most 48 bytes. Nothing in this file can change the ECU.
 */

import { CANDIDATE_BASES, CANDIDATE_SEGMENTS, IDENTITY_ANCHORS } from './layout';
import type { Smg2ReadLink } from './link';

export interface ProbeCandidate {
    readonly segment: number;
    readonly baseAddress: number;
}

export interface ProbeSample {
    readonly anchor: keyof typeof IDENTITY_ANCHORS;
    readonly address: number;
    readonly bytes: Uint8Array | null;
    readonly error: string | null;
}

export interface ProbeCandidateResult extends ProbeCandidate {
    readonly samples: readonly ProbeSample[];
    /** 0..1. Above `STRONG_MATCH` the candidate is claimed; below `WEAK_MATCH` it is dismissed. */
    readonly score: number;
    readonly reasons: readonly string[];
}

export interface ProbeReport {
    readonly candidates: readonly ProbeCandidateResult[];
    /** Set only when exactly one candidate scored strongly. Ambiguity is reported, not resolved. */
    readonly identified: ProbeCandidate | null;
    /**
     * The best candidate that returned structured data, whether or not it was confirmed.
     *
     * This exists because a read is READ-ONLY and therefore harmless, and an earlier version made
     * it unreachable: without a ZB number to match, scoring caps at 0.6 against a 0.75 threshold, so
     *  was permanently null on every real vehicle and the app could never leave the
     * probe step. Certainty is worth reporting; it is not worth blocking a harmless operation for.
     *
     * A caller that reads from  must say the address space is UNCONFIRMED.
     */
    readonly best: ProbeCandidate | null;
    readonly confidence: 'confirmed' | 'unconfirmed' | 'none';
    readonly summary: string;
}

export const STRONG_MATCH = 0.75;
export const WEAK_MATCH = 0.25;

function printableRatio(bytes: Uint8Array): number {
    if (bytes.length === 0) return 0;
    let printable = 0;
    for (const b of bytes) if (b >= 0x20 && b < 0x7f) printable++;
    return printable / bytes.length;
}

function isUniform(bytes: Uint8Array, value: number): boolean {
    return bytes.length > 0 && bytes.every(b => b === value);
}

function asAscii(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
    return out;
}

/** Digits only, so "7843260" is found whether the ECU stores it padded, spaced or bare. */
function digitsOf(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) if (b >= 0x30 && b <= 0x39) out += String.fromCharCode(b);
    return out;
}

export interface ProbeOptions {
    /**
     * The ZB number this car's SMG II is known to report, if you have it. With it the probe is
     * decisive; without it, it can only distinguish "structured data" from "empty or noise".
     *
     * The recorded capture for the reference car gives 7843260 (HW 2F, SW 10).
     */
    readonly expectedZbNumber?: string;
    readonly segments?: readonly number[];
    readonly bases?: readonly number[];
    readonly onCandidate?: (result: ProbeCandidateResult) => void;
    /**
     * Which identity anchors to read. Defaults to all of them.
     *
     * Present so a test can remove `zbBlock` and show that the confirmation genuinely comes from
     * it — a passing test that would also pass without the fix proves nothing.
     */
    readonly anchors?: readonly (keyof typeof IDENTITY_ANCHORS)[];
}

export async function probeAddressSpace(
    link: Smg2ReadLink,
    options: ProbeOptions = {},
): Promise<ProbeReport> {
    const segments = options.segments ?? CANDIDATE_SEGMENTS;
    const bases = options.bases ?? CANDIDATE_BASES;
    // zbBlock first: it is the only anchor that can make a candidate DECISIVE, so reading it
    // first means the strongest evidence is in hand before the weaker two are even scored.
    const anchors = options.anchors ?? (['zbBlock', 'ident0', 'ident1'] as const);

    const candidates: ProbeCandidateResult[] = [];

    for (const segment of segments) {
        for (const baseAddress of bases) {
            const samples: ProbeSample[] = [];
            for (const anchor of anchors) {
                const { address, length } = IDENTITY_ANCHORS[anchor];
                const dsAddress = baseAddress + address;
                try {
                    samples.push({
                        anchor,
                        address: dsAddress,
                        bytes: await link.readBlock(segment, dsAddress, length),
                        error: null,
                    });
                } catch (error) {
                    samples.push({ anchor, address: dsAddress, bytes: null, error: (error as Error).message });
                }
            }
            const result: ProbeCandidateResult = {
                segment, baseAddress, samples,
                ...scoreCandidate(samples, options.expectedZbNumber),
            };
            candidates.push(result);
            options.onCandidate?.(result);
        }
    }

    candidates.sort((a, b) => b.score - a.score);
    const strong = candidates.filter(c => c.score >= STRONG_MATCH);

    const plausible = candidates.filter(c => c.score > WEAK_MATCH);
    const best: ProbeCandidate | null = plausible.length
        ? { segment: plausible[0].segment, baseAddress: plausible[0].baseAddress }
        : null;

    let summary: string;
    let identified: ProbeCandidate | null = null;
    if (strong.length === 1) {
        identified = { segment: strong[0].segment, baseAddress: strong[0].baseAddress };
        summary = `segment 0x${strong[0].segment.toString(16).padStart(2, '0')}, ` +
            `base 0x${strong[0].baseAddress.toString(16)} — ${strong[0].reasons.join('; ')}`;
    } else if (strong.length > 1) {
        // Two candidates cannot both be right. Aliasing in the ECU's decode is the likely cause;
        // either way, picking one here would launder a coin flip into a stored fact.
        summary = `${strong.length} candidates scored strongly (` +
            strong.map(c => `seg 0x${c.segment.toString(16)}/base 0x${c.baseAddress.toString(16)}`).join(', ') +
            `). Ambiguous — widen the anchors before trusting either.`;
    } else {
        summary = candidates.length === 0
            ? 'no candidates were tried'
            : best
                ? `Nothing could be confirmed without a ZB number to match. Best is seg ` +
                  `0x${candidates[0].segment.toString(16).padStart(2, '0')}/base ` +
                  `0x${candidates[0].baseAddress.toString(16)} at ${(candidates[0].score * 100) | 0}% — ` +
                  `${candidates[0].reasons[candidates[0].reasons.length - 1]}. Reading from it is safe; ` +
                  `check the decoded values look physically possible.`
                : `Nothing answered with data. Every candidate read as all-0x00 or all-0xFF.`;
    }

    const confidence: ProbeReport['confidence'] =
        identified ? 'confirmed' : best ? 'unconfirmed' : 'none';

    return { candidates, identified, best, confidence, summary };
}

function scoreCandidate(
    samples: readonly ProbeSample[],
    expectedZbNumber: string | undefined,
): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    const read = samples.filter(s => s.bytes !== null);

    if (read.length === 0) {
        reasons.push('no anchor could be read');
        return { score: 0, reasons };
    }
    if (read.length < samples.length) {
        reasons.push(`${samples.length - read.length} of ${samples.length} anchors failed to read`);
    }

    const all = read.map(s => s.bytes!);
    if (all.every(b => isUniform(b, 0x00))) {
        reasons.push('every anchor read as all-zero — unmapped or wrong base');
        return { score: 0, reasons };
    }
    if (all.every(b => isUniform(b, 0xff))) {
        reasons.push('every anchor read as all-0xFF — erased or unmapped');
        return { score: 0, reasons };
    }

    let score = 0.2;
    reasons.push('anchors returned data that is neither all-0x00 nor all-0xFF');

    const joinedDigits = all.map(digitsOf).join('');
    if (expectedZbNumber) {
        if (joinedDigits.includes(expectedZbNumber)) {
            // This is the decisive one: the ECU's own part number, at the address the definition
            // says it lives at. No other candidate can produce it by chance.
            score = 1;
            reasons.push(`found the expected ZB number ${expectedZbNumber} at an identity anchor`);
            return { score, reasons };
        }
        reasons.push(`the expected ZB number ${expectedZbNumber} is not present`);
    }

    const ratio = Math.max(...all.map(printableRatio));
    if (ratio >= 0.6) {
        score = Math.max(score, 0.6);
        reasons.push(`${Math.round(ratio * 100)}% of an anchor is printable ASCII (` +
            `"${asAscii(all[0]).slice(0, 24)}")`);
    } else if (ratio >= 0.3) {
        score = Math.max(score, 0.4);
        reasons.push(`${Math.round(ratio * 100)}% printable ASCII — structured, but not obviously identity`);
    } else {
        reasons.push('anchors do not look like text');
    }

    return { score, reasons };
}

/**
 * Read the same range twice and compare.
 *
 * One read cannot establish that a read is correct. A K-line that drops a byte, an off-by-one in
 * chunking, an ECU that answers a stale buffer — all produce a file that opens. Two identical
 * reads do not prove correctness either, but a mismatch disproves it immediately and cheaply, and
 * that is worth one extra minute before anyone edits the bytes.
 */
export async function readTwiceAndCompare(
    link: Smg2ReadLink,
    segment: number,
    baseAddress: number,
    length: number,
): Promise<{ bytes: Uint8Array; identical: boolean; firstDifference: number | null }> {
    const first = await link.readRange(segment, baseAddress, length);
    const second = await link.readRange(segment, baseAddress, length);

    let firstDifference: number | null = null;
    for (let i = 0; i < length; i++) {
        if (first.bytes[i] !== second.bytes[i]) { firstDifference = i; break; }
    }
    return { bytes: first.bytes, identical: firstDifference === null, firstDifference };
}
