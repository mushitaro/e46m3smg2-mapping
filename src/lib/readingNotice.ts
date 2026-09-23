import type { ReadProgress } from '@tsunagi/ds2-smg2';

/**
 * How far in, and how much longer — measured, never computed from the baud rate.
 *
 * The remaining time comes from the rate this read has actually sustained, which already contains
 * the ECU's turnaround, the retries and whatever the cable is doing today. A number derived from
 * 9600 would be a theory presented to somebody sitting in a car with the ignition on, and it would
 * be wrong in the direction that keeps them waiting.
 *
 * Nothing is estimated until 2% is in: before that the rate swings by minutes between telegrams,
 * and a finish time that jumps around is worse than no finish time.
 */
export function readingNotice(p: ReadProgress): string {
    const percent = (p.bytesDone / p.bytesTotal) * 100;
    const head = `${percent.toFixed(percent < 10 ? 1 : 0)}% · ` +
        `${p.bytesDone.toLocaleString()} / ${p.bytesTotal.toLocaleString()} B · ` +
        `${p.exchanges} exchanges · ${p.retries} retries`;
    if (p.elapsedMs < 2000 || p.bytesDone < p.bytesTotal * 0.02) return head;

    const remainingMs = (p.elapsedMs / p.bytesDone) * (p.bytesTotal - p.bytesDone);
    const minutes = Math.floor(remainingMs / 60_000);
    const seconds = Math.round((remainingMs % 60_000) / 1000);
    return `${head} · ~${minutes > 0 ? `${minutes}m ` : ''}${seconds}s left`;
}
