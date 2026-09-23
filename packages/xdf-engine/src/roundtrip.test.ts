/**
 * Can this engine write back what it read?
 *
 * Nobody has ever asked. `MapGrid` documented itself as rendering a non-invertible item read-only
 * and then defined `readOnly = !onEdit` with a caller that always passes `onEdit`, so the flag was
 * permanently false — which means every item in this definition has always LOOKED editable and no
 * test has ever checked that editing one produces the bytes it claims to.
 *
 * The property is: for every element of every item, `encode(decode(x))` reproduces the original
 * byte. Where it fails, the failure must be a REFUSAL — `scaling.inverse === 'none'` and a thrown
 * `XdfCodecError` — never a silently different byte. A definition that quietly rounds a cell on
 * save corrupts a calibration one LSB at a time, and the reader would have no way to see it.
 *
 * Runs against the vendor XDF and, when the car's dump is on this disk, against the real bytes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe as suite, expect, it } from 'vitest';
import { XdfCodecError, encodeRun, offsetsOf, readRun, runTargetOf } from './codec';
import { parseXdf } from './parse';
import type { XdfDefinition, XdfItem } from './types';

const XDF = join(__dirname, '..', '..', '..', 'public', 'xdf', 'Siemens_SMG_II_510_512K.xdf');
const DUMP = join(__dirname, '..', '..', '..', 'data', 'extractions', '5c5a0c857acd.bin');

/**
 * The MS4X Dev Team's XDF is not in this repository (it is theirs to publish, not ours — see
 * THIRD-PARTY-NOTICES.md), so on a fresh clone these tests skip rather than fail. Put the file
 * where README.md says and they run.
 */
const HAVE_XDF = existsSync(XDF);
const describe = HAVE_XDF ? suite : suite.skip;

const def: XdfDefinition = HAVE_XDF ? parseXdf(readFileSync(XDF, 'utf8')) : ({ items: [] } as unknown as XdfDefinition);

/** Bytes to run the property against: the car's, or a deterministic stand-in. */
function image(): Uint8Array {
    if (existsSync(DUMP)) return new Uint8Array(readFileSync(DUMP));
    const synthetic = new Uint8Array(0x80000);
    for (let i = 0; i < synthetic.length; i++) synthetic[i] = (i * 31 + (i >> 8)) & 0xff;
    return synthetic;
}

const addressed = def.items.filter(i => runTargetOf(i).data.address !== null);

describe('read/write round trip over the whole definition', () => {
    it('has something to test', () => {
        expect(def.items).toHaveLength(111);
        expect(addressed.length).toBeGreaterThan(100);
    });

    it('reproduces every byte it can write, and refuses the rest by name', () => {
        const bytes = image();
        const refused: string[] = [];
        const corrupted: string[] = [];
        let cells = 0;

        for (const item of addressed) {
            const { scaling } = runTargetOf(item);
            const before = readRun(def, bytes, item);
            cells += before.length;

            // Physical -> raw -> physical, the path a UI edit actually takes.
            let raw: number[];
            try {
                raw = before.map(r => scaling.toRaw(scaling.toPhysical(r)));
            } catch (error) {
                expect(error).toBeInstanceOf(XdfCodecError);
                refused.push(item.title);
                continue;
            }
            if (scaling.inverse === 'none') { refused.push(item.title); continue; }

            const copy = Uint8Array.from(bytes);
            encodeRun(def, copy, item, raw);
            const spans = offsetsOf(def, item);
            const width = runTargetOf(item).data.bits / 8;
            for (const offset of spans) {
                for (let b = 0; b < width; b++) {
                    if (copy[offset + b] !== bytes[offset + b]) {
                        corrupted.push(`${item.title} @0x${(offset + b).toString(16)}`);
                    }
                }
            }
        }

        expect(cells).toBeGreaterThan(2000);
        // The whole point. A round trip that changes a byte is corruption, not rounding.
        expect(corrupted).toEqual([]);
        // Refusals are legitimate but must be few and named, so a regression is visible as a
        // count rather than as an item quietly becoming unwritable.
        expect(refused.length).toBeLessThanOrEqual(2);
    });

    it('refuses a length mismatch instead of writing the prefix', () => {
        const bytes = image();
        const table = addressed.find(i => i.kind === 'table' && readRun(def, bytes, i).length > 4)!;
        const short = readRun(def, bytes, table).slice(0, 2);
        expect(() => encodeRun(def, Uint8Array.from(bytes), table, short))
            .toThrow(/element\(s\) and 2 were given/);
    });

    it('gives constants a run of exactly one, so they are not a special case', () => {
        const bytes = image();
        const constants = addressed.filter(i => i.kind === 'constant');
        expect(constants.length).toBeGreaterThan(50);
        for (const c of constants) expect(readRun(def, bytes, c)).toHaveLength(1);
    });

    it('offsets are strictly increasing and inside the image', () => {
        const bytes = image();
        for (const item of addressed) {
            const offsets = offsetsOf(def, item);
            const width = runTargetOf(item).data.bits / 8;
            for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
            expect(offsets[offsets.length - 1] + width).toBeLessThanOrEqual(bytes.length);
        }
    });
});

describe('what the parser now keeps', () => {
    it('carries outputtype, which marks the bitfields and the checksum', () => {
        const hex = def.items.filter(
            (i): i is Extract<XdfItem, { kind: 'constant' }> =>
                i.kind === 'constant' && i.outputType === 3);
        expect(hex.map(i => i.title).sort()).toEqual([
            'CFG: Lever Plus/Minus in A-Mode Config',
            'CFG: Logic',
            'Checksum',
            'RACESTART: Clutch Config',
        ]);
    });
});
