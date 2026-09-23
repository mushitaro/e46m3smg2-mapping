/**
 * The checksum module against the actual car, when the actual car is on this disk.
 *
 * `data/` is gitignored — it holds dumps of a specific ECU and the identity of the vehicle they
 * came from — so these files are absent in CI and on anyone else's machine. The suite skips
 * itself there rather than failing, and `checksum.test.ts` carries the parts that must hold
 * everywhere.
 *
 * This exists because `checksum.test.ts` proves the algorithm and the format; it cannot prove the
 * TypeScript is a faithful transcription of the algorithm that was identified in Python against
 * the disassembly. That is what this proves, and it is the only thing that can.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyAllChecksums, verifyChecksum } from './checksum';

const DATA = join(__dirname, '..', '..', '..', 'data', 'extractions');
const FULL = join(DATA, '5c5a0c857acd.bin');
const WINDOW = join(DATA, 'f6de6103584b.bin');

const have = existsSync(FULL) && existsSync(WINDOW);

describe.skipIf(!have)('dump 5c5a0c857acd, read from the car', () => {
    it('reproduces all three stored checksums', () => {
        const image = new Uint8Array(readFileSync(FULL));
        expect(image.length).toBe(0x80000);

        const results = verifyAllChecksums(image);
        expect(results.map(r => r.area)).toEqual(['boot', 'program', 'calibration']);

        const by = Object.fromEntries(results.map(r => [r.area, r]));
        expect(by.boot.stored).toBe(0x6858);
        expect(by.program.stored).toBe(0x2660);
        expect(by.calibration.stored).toBe(0x4c83);
        for (const r of results) expect([r.area, r.computed]).toEqual([r.area, r.stored]);

        expect(by.program.blocks).toHaveLength(9);
        expect(by.program.protectedBytes).toBe(269_090);
        expect(by.calibration.blocks).toEqual([{ start: 0x320e0, end: 0x378bf }]);
        expect(by.calibration.protectedBytes).toBe(22_496);
    });

    it('gets the same calibration answer from the window-only read taken on another day', () => {
        // Two sessions, two scopes, one stored word. If the imageBase handling were wrong this is
        // where it would show, because the descriptor's addresses are absolute either way.
        const windowRead = new Uint8Array(readFileSync(WINDOW));
        expect(windowRead.length).toBe(24_576);

        const result = verifyChecksum(windowRead, 'calibration', 0x32000)!;
        expect(result.stored).toBe(0x4c83);
        expect(result.computed).toBe(0x4c83);
        expect(result.ok).toBe(true);

        // The window holds none of the program blocks, so that area is unanswerable, not failed.
        expect(verifyChecksum(windowRead, 'program', 0x32000)).toBeNull();
    });
});
