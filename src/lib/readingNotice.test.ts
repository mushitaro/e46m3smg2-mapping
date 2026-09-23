import { describe, expect, it } from 'vitest';
import { readingNotice } from './readingNotice';

const at = (bytesDone: number, elapsedMs: number) => readingNotice({
    bytesDone, bytesTotal: 524_288, exchanges: Math.ceil(bytesDone / 120), retries: 0, elapsedMs,
});

describe('the reading notice', () => {
    it('says nothing about the finish time until the rate means something', () => {
        // 1% in, two seconds of samples. The rate here swings by minutes between telegrams, and a
        // number that jumps around is worse than no number at all.
        expect(at(5_242, 1_500)).not.toMatch(/left/);
        expect(at(5_242, 10_000)).not.toMatch(/left/);
        expect(at(5_242, 1_500)).toMatch(/^1.0%/);
    });

    it('estimates from the rate this read has actually sustained', () => {
        // 1.98 ms/byte is the rate a real car gave: 24,576 bytes in 48.6 s. At that rate the
        // remaining 472 KiB is about 15m 34s — a figure derived from the read, not from 9600 baud.
        const notice = at(52_429, 103_809);
        expect(notice).toMatch(/10% ·/);
        expect(notice).toMatch(/~15m 34s left/);
    });

    it('drops the minutes rather than printing a zero for them', () => {
        expect(at(500_000, 990_000)).toMatch(/~48s left$/);
        expect(at(500_000, 990_000)).not.toMatch(/0m/);
    });

    it('keeps a decimal place while the percentage is small', () => {
        // "0%" for the first four minutes of an eighteen-minute read reads as "nothing is
        // happening". One decimal moves every few seconds, which is what says it is alive.
        expect(at(15_728, 31_000)).toMatch(/^3.0%/);
        expect(at(367_001, 700_000)).toMatch(/^70%/);
    });
});
