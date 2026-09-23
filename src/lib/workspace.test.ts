/**
 * The ZB an image states about itself.
 *
 * This is the fact the flash preflight leans on hardest — "did these bytes come off THIS ECU" —
 * and the real dump is the only place to check it, because the practice image plants its
 * identity somewhere the car does not.
 */
import { describe as suite, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { zbFromImage } from './workspace';

/**
 * The real dump is not in this repository — it is one car's ECU, and `data/` is gitignored — so
 * on a fresh clone these tests skip rather than fail.
 */
const DUMP = 'data/extractions/5c5a0c857acd.bin';
const describe = existsSync(DUMP) ? suite : suite.skip;
const full = existsSync(DUMP) ? new Uint8Array(readFileSync(DUMP)) : new Uint8Array(0);

describe('zbFromImage', () => {
    it('reads the six-fold block the analysis located at 0x2FF94', () => {
        // docs/full-image-analysis.md §4.1: the ZB appears six times at 0x2FF94.
        expect(zbFromImage(full)).toBe('7843260');
    });

    it('survives one corrupted repetition', () => {
        const damaged = new Uint8Array(full);
        damaged.fill(0x00, 0x2ff94, 0x2ff9b);
        expect(zbFromImage(damaged)).toBe('7843260');
    });

    it('refuses a single unrepeated match rather than naming a part from one copy', () => {
        const damaged = new Uint8Array(full);
        damaged.fill(0x00, 0x2ff9b, 0x2ffc0);
        expect(zbFromImage(damaged)).toBeNull();
    });

    it('says nothing about an image too short to carry the block', () => {
        expect(zbFromImage(full.slice(0, 24576))).toBeNull();
    });
});
