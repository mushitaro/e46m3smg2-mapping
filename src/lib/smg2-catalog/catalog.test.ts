/**
 * Every correction, re-checked against the vendor file and the car on every run.
 *
 * Two distinct claims are under test and they fail for different reasons:
 *
 *   - **The `was:` guards still describe the shipped XDF.** If MS4X republishes, this goes red
 *     and names the entry. That is the entire point of `was:` — a correction that cannot notice
 *     it is no longer needed would silently re-break a repaired definition.
 *   - **The corrected reading is better than the vendor one**, judged against the actual bytes:
 *     monotone where a threshold ladder must be monotone, adjacent where a record grid says
 *     adjacent, and no longer sharing a word with the table next door.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe as suite, expect, it } from 'vitest';
import {
    OverlayError, applyOverlay, parseXdf, readRun, validateXdf, type XdfDefinition,
} from '@tsunagi/xdf-engine';
import { CATALOG_VERSION, SMG2_OVERLAY } from './index';

const XDF = join(__dirname, '..', '..', '..', 'public', 'xdf', 'Siemens_SMG_II_510_512K.xdf');
const DUMP = join(__dirname, '..', '..', '..', 'data', 'extractions', '5c5a0c857acd.bin');

/**
 * The overlay corrects the MS4X Dev Team's XDF, which is not in this repository (theirs to
 * publish, not ours — see THIRD-PARTY-NOTICES.md). On a fresh clone these suites skip rather than
 * fail; with the file in `public/xdf/` they run, and they must before a correction is trusted.
 */
const HAVE_XDF = existsSync(XDF);
const describe = HAVE_XDF ? suite : suite.skip;

const vendor: XdfDefinition = HAVE_XDF ? parseXdf(readFileSync(XDF, 'utf8')) : ({ items: [] } as unknown as XdfDefinition);
const applied = HAVE_XDF ? applyOverlay(vendor, SMG2_OVERLAY) : (undefined as unknown as ReturnType<typeof applyOverlay>);
const haveDump = HAVE_XDF && existsSync(DUMP);
const image = () => new Uint8Array(readFileSync(DUMP));
const byId = (def: XdfDefinition, id: string) => def.items.find(i => i.uniqueId === id)!;

describe('the overlay applies to the definition that is actually shipped', () => {
    it('every was: matches, so no correction is stale', () => {
        // If this throws, read the message: it names the entry and both values.
        expect(() => applyOverlay(vendor, SMG2_OVERLAY)).not.toThrow();
        expect(applied.applied.length).toBe(SMG2_OVERLAY.entries.length);
        expect(SMG2_OVERLAY.version).toBe(CATALOG_VERSION);
    });

    it('refuses when the vendor value is not what the patch expects', () => {
        expect(() => applyOverlay(vendor, {
            version: 'test',
            entries: [{
                op: 'patch', uniqueId: '0x5C5C', title: 'FAULT: Upshift Speed Thresholds',
                target: 'value', was: { address: 0x9999 }, now: { address: 0x1234 },
                why: 'test', provenance: { kind: 'community' },
            }],
        })).toThrow(OverlayError);
    });

    it('refuses an id that is not in the definition', () => {
        expect(() => applyOverlay(vendor, {
            version: 'test',
            entries: [{ op: 'note', uniqueId: '0xDEAD', provenance: { kind: 'community' } }],
        })).toThrow(/not in this definition/);
    });
});

suite.skipIf(!haveDump)('the corrected reading beats the vendor one, judged on real bytes', () => {
    it('FAULT becomes a monotone seven and stops sharing a word with its neighbour', () => {
        const bytes = image();
        const before = readRun(vendor, bytes, byId(vendor, '0x5C5C'));
        const after = readRun(applied.definition, bytes, byId(applied.definition, '0x5C5C'));

        // As shipped: six values, and the last one is the neighbour's first.
        expect(before).toEqual([0, 352, 480, 608, 768, 288]);
        const neighbourBefore = readRun(vendor, bytes, byId(vendor, '0x7E29'));
        expect(before[5]).toBe(neighbourBefore[0]);

        // Corrected: seven, monotone, and no longer overlapping.
        expect(after).toEqual([0, 0, 0, 352, 480, 608, 768]);
        for (let i = 1; i < after.length; i++) expect(after[i]).toBeGreaterThanOrEqual(after[i - 1]);
    });

    it('SPORT/RACE recovers its seventh element', () => {
        const bytes = image();
        const after = readRun(applied.definition, bytes, byId(applied.definition, '0x7E29'));
        expect(after).toEqual([288, 288, 512, 736, 1024, 1248, 1440]);
        for (let i = 1; i < after.length; i++) expect(after[i]).toBeGreaterThanOrEqual(after[i - 1]);
    });

    it('the two corrected records are adjacent and do not overlap', () => {
        // 0x36ED8 + 7*2 = 0x36EE6. The 14-byte grid is the reason both corrections are right.
        const fault = byId(applied.definition, '0x5C5C');
        const sport = byId(applied.definition, '0x7E29');
        const faultZ = fault.kind === 'table' ? fault.z.data : null;
        const sportZ = sport.kind === 'table' ? sport.z.data : null;
        expect(faultZ!.address! + faultZ!.cols * 2).toBe(sportZ!.address!);
    });

    it('the alias is real: both items decode to the same number', () => {
        const bytes = image();
        expect(readRun(vendor, bytes, byId(vendor, '0x7E66'))[0]).toBe(5800);
        expect(readRun(vendor, bytes, byId(vendor, '0x6593'))[0]).toBe(5800);
        expect(applied.aliases).toContainEqual(['0x7E66', '0x6593']);
    });

    it('the up/down claim holds on every AUTO table, 880 of 880', () => {
        const bytes = image();
        // Eleven: the ten the definition declares plus the block it omits. The added one is
        // held to the same rule as its siblings — if it did not satisfy the hysteresis
        // invariant on its own cells, calling it a shift table would be a guess.
        const autos = [...applied.notes.entries()].filter(([, n]) => n.rowGroups);
        expect(autos).toHaveLength(11);
        expect(applied.added.has('smg2/auto-36240')).toBe(true);

        let checked = 0;
        for (const [id] of autos) {
            const run = readRun(applied.definition, bytes, byId(applied.definition, id));
            expect(run).toHaveLength(160);
            for (let gear = 0; gear < 5; gear++) {
                for (let throttle = 0; throttle < 16; throttle++) {
                    const up = run[gear * 16 + throttle];
                    const down = run[(gear + 5) * 16 + throttle];
                    // Equal is allowed only where both are zero — a program that does not use
                    // that gear at that throttle. Anywhere else, up must exceed down or the box
                    // would hunt between two gears at a steady speed.
                    if (!(up === 0 && down === 0)) expect(up).toBeGreaterThan(down);
                    checked++;
                }
            }
        }
        expect(checked).toBe(880);
    });

    it('the bit legends still match the text the XDF ships', () => {
        // A transcription, so a typo has to fail the build. If MS4X rewords the description this
        // goes red and the legend gets re-read against the new wording rather than drifting.
        const source = readFileSync(XDF, 'latin1');
        expect(source).toContain('0010000 - use &lt;18 kmh, Gear 1 slow moving logic');
        expect(source).toContain('0000010 - use Lateral Acceleration logic calculations');
        expect(source).toContain('000010 - use avail Torque by Clutch');

        const logic = applied.notes.get('0x3EFB')!;
        expect(logic.bits).toHaveLength(16);
        expect(logic.bits!.filter(b => b.documented)).toHaveLength(7);
        expect(logic.bits![4].label).toMatch(/18 km\/h/);
    });
});

describe('a correction leaves no new warning behind', () => {
    it('the corrected tables no longer mismatch their own axes', () => {
        // Widening z without widening the axis that labels it trades a real defect for a
        // warning. The overlay corrects both, so the findings list stays worth reading.
        const source = readFileSync(XDF, 'utf8');
        const before = validateXdf(vendor, { imageLength: 0x80000, source });
        const after = validateXdf(applied.definition, { imageLength: 0x80000, source });

        const shape = (fs: readonly { kind: string; items: readonly string[] }[]) =>
            fs.filter(f => f.kind === 'axis-shape-mismatch'
                && (f.items.includes('0x5C5C') || f.items.includes('0x7E29')));
        expect(shape(after)).toEqual(shape(before));

        // And the overlap the corrections exist to remove is gone.
        const overlap = (fs: readonly { kind: string; items: readonly string[] }[]) =>
            fs.filter(f => f.kind === 'value-overlap' && f.items.includes('0x5C5C'));
        expect(overlap(before).length).toBeGreaterThan(0);
        expect(overlap(after)).toEqual([]);
    });
});

describe('the units the vendor left blank', () => {
    const def = HAVE_XDF ? applied.definition : vendor;
    const bare = vendor;

    const unitsOf = (d: typeof def, id: string) => {
        const item = d.items.find(i => i.uniqueId === id);
        if (!item) return undefined;
        return item.kind === 'constant' ? item.units : item.z.units;
    };

    it('labels every X/16 speed table the way the vendor labels the nine it did label', () => {
        // The argument for these units, restated as an assertion: in the SHIPPED file, some
        // `X/16` items carry `kmh` and some carry nothing, and the ones carrying nothing all say
        // "Speed". If that ever stops being true, the reasoning behind the overlay has changed.
        const bySameMath = bare.items.filter(i => (i.kind === 'constant' ? i.scaling : i.z.scaling).math === 'X/16');
        const labelled = bySameMath.filter(i => (i.kind === 'constant' ? i.units : i.z.units) === 'kmh');
        const blank = bySameMath.filter(i => !(i.kind === 'constant' ? i.units : i.z.units));
        expect(labelled.length).toBe(9);
        expect(blank.length).toBe(31);
        for (const item of blank) expect(item.title).toMatch(/Speed/);
    });

    it('supplies km/h to the AUTO tables this tool exists to edit', () => {
        expect(unitsOf(def, '0x6E91')).toBe('kmh');           // AUTO: A3 Speed Thresholds
        expect(unitsOf(def, 'smg2/auto-36240')).toBe('kmh');  // the eleventh table, added here
        expect(unitsOf(bare, '0x6E91')).toBeNull();
    });

    it('supplies rpm where the title already says RPM', () => {
        expect(unitsOf(def, '0x6593')).toBe('rpm');           // RPM Thresholds
        expect(unitsOf(def, '0x53D4')).toBe('rpm');           // Braking: ... Threshold 1
    });

    it('leaves alone every quantity nothing establishes a unit for', () => {
        // The twelve Clutch Math constants and RACESTART: Target Clutch stay bare on purpose.
        // A number with a wrong unit is quotable; a number with no unit is honest.
        for (const id of ['0x1925', '0x4D7E', '0x5311', '0x75C9', '0x7E22']) {
            expect(unitsOf(def, id)).toBeNull();
        }
    });
});
