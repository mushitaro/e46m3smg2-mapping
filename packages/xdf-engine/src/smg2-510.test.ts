/**
 * The Siemens SMG2 510 definition, pinned.
 *
 * These numbers were measured off the two files, not copied from anywhere. They exist so that a
 * change to the parser has to explain itself against a real definition rather than against a
 * fixture someone wrote to match the parser.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe as suite, expect, it } from 'vitest';

import { coverageOf } from './coverage';
import { decodeItem, encodeCell, readRaw, spansOf, writeRaw } from './codec';
import { compileScaling } from './math';
import { parseXdf } from './parse';
import { validateXdf } from './validate';
import { parseXml } from './xml';

const fixturePath = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/**
 * The two fixtures are the MS4X Dev Team's files, not ours to publish (see fixtures/README.md and
 * THIRD-PARTY-NOTICES.md), so on a fresh clone this suite skips rather than fails. Copy them into
 * `fixtures/` and it runs — and it must, before a change to the parser is trusted.
 */
const HAVE_FIXTURES = existsSync(fixturePath('Siemens_SMG_II_510_512K.xdf'))
    && existsSync(fixturePath('Siemens_SMG_II_510_24K.xdf'));
const describe = HAVE_FIXTURES ? suite : suite.skip;
const fixture = (name: string) => (HAVE_FIXTURES ? readFileSync(fixturePath(name), 'utf8') : '');

const SRC_512K = fixture('Siemens_SMG_II_510_512K.xdf');
const SRC_24K = fixture('Siemens_SMG_II_510_24K.xdf');

const DEF_512K = HAVE_FIXTURES ? parseXdf(SRC_512K) : (undefined as unknown as ReturnType<typeof parseXdf>);
const DEF_24K = HAVE_FIXTURES ? parseXdf(SRC_24K) : (undefined as unknown as ReturnType<typeof parseXdf>);

/** The partial dump the 24K definition is written for: 0x32000 for 0x6000 bytes. */
const PARTIAL_BASE = 0x32000;
const PARTIAL_LENGTH = 0x6000;

describe('header', () => {
    it('reads the two BASEOFFSET variants', () => {
        expect(DEF_512K.header.title).toBe('Siemens SMG2 510 Partial');
        expect(DEF_512K.header.baseOffset).toEqual({ offset: 0, subtract: false });
        expect(DEF_24K.header.baseOffset).toEqual({ offset: 204800, subtract: true });
        expect(204800).toBe(PARTIAL_BASE);
    });

    it('declares seven categories in file order', () => {
        expect(DEF_512K.header.categories).toEqual([
            'Pressure', 'Clutch', 'System Parameters', 'Gear Logic', 'File Data', 'RPM Limits', 'Speed Limits',
        ]);
    });

    it('defaults are 8-bit unsigned MSB-first', () => {
        expect(DEF_512K.header.defaults).toEqual({ bits: 8, signed: false, lsbFirst: false });
    });
});

describe('items', () => {
    it('has 56 constants and 55 tables', () => {
        expect(DEF_512K.items.filter(i => i.kind === 'constant')).toHaveLength(56);
        expect(DEF_512K.items.filter(i => i.kind === 'table')).toHaveLength(55);
        expect(DEF_512K.items).toHaveLength(111);
    });

    it('spans 0x32080..0x37FF0 in the 512 KiB image', () => {
        const spans = DEF_512K.items.flatMap(i => spansOf(DEF_512K, i));
        expect(Math.min(...spans.map(s => s.start))).toBe(0x32080);
        expect(Math.max(...spans.map(s => s.end))).toBe(0x37ff0);
    });

    it('resolves the same logical items from both variants, shifted by the partial base', () => {
        expect(DEF_24K.items).toHaveLength(DEF_512K.items.length);
        for (let i = 0; i < DEF_512K.items.length; i++) {
            const a = DEF_512K.items[i];
            const b = DEF_24K.items[i];
            expect(b.title).toBe(a.title);
            expect(b.uniqueId).toBe(a.uniqueId);
            const sa = spansOf(DEF_512K, a);
            const sb = spansOf(DEF_24K, b);
            expect(sb.map(s => s.start)).toEqual(sa.map(s => s.start - PARTIAL_BASE));
        }
    });

    it('puts the checksum in File Data, which is what proves CATEGORYMEM is 1-based', () => {
        const checksum = DEF_512K.items.find(i => i.title === 'Checksum');
        expect(checksum).toBeDefined();
        // The attribute in the file is category="5". Read 0-based that would be RPM Limits.
        expect(checksum!.categories).toEqual(['File Data']);
        expect(checksum!.kind).toBe('constant');
        if (checksum!.kind === 'constant') {
            expect(checksum!.data.address).toBe(0x32080);
            expect(checksum!.data.bits).toBe(16);
        }
    });
});

describe('byte order and sign, taken from the definition', () => {
    it('flags 16-bit items little-endian and never flags 8-bit ones', () => {
        let lsbFirst16 = 0;
        let signed16 = 0;
        let flagged8 = 0;
        for (const item of DEF_512K.items) {
            const runs = item.kind === 'constant'
                ? [item.data]
                : [item.z.data, item.x?.data, item.y?.data].filter(Boolean);
            for (const run of runs as { bits: number; lsbFirst: boolean; signed: boolean; typeFlagsRaw: number }[]) {
                if (run.bits === 8 && run.typeFlagsRaw !== 0) flagged8++;
                if (run.bits === 16 && run.lsbFirst) lsbFirst16++;
                if (run.bits === 16 && run.signed) signed16++;
            }
        }
        // Endianness is meaningless for a byte, so a definition that never flags 8-bit items and
        // always flags 16-bit ones is telling us 0x02 is the byte-order bit. Every 16-bit run in
        // this definition carries it: the SMG2 calibration is little-endian.
        expect(flagged8).toBe(0);
        expect(lsbFirst16).toBe(120);
        expect(signed16).toBe(32);
    });

    it('signs exactly the differences and lateral accelerations', () => {
        const signedTitles = new Set<string>();
        for (const item of DEF_512K.items) {
            const runs = item.kind === 'constant' ? [item.data] : [item.z.data];
            if (runs.some(r => r.signed)) signedTitles.add(item.title);
        }
        // Independent check on reading 0x01 as "signed": every item it marks is one whose
        // physical quantity can legitimately go negative. Nothing else in the definition is signed.
        expect([...signedTitles].sort()).toEqual([
            'Downshift Suppress: Lateral Accel Thresholds for PROG1',
            'Downshift Suppress: Lateral Accel Thresholds for PROG2-3-7-9',
            'Downshift Suppress: Lateral Accel Thresholds for PROG4-5-6-8',
            'Front Wheel Speed Decreasing',
            'KICKDOWN: Throttle Difference Max',
            'KICKDOWN: Throttle Difference Min',
            'SPORT: Downshift Low Load Speed Offsets',
            'SPORT: Downshift Part Load Speed Offsets',
        ]);
    });
});

describe('layout', () => {
    it('lays an axis immediately before its grid (A1 speed thresholds)', () => {
        const a1 = DEF_512K.items.find(i => i.title === 'AUTO: A1 Speed Thresholds');
        expect(a1?.kind).toBe('table');
        if (a1?.kind !== 'table') return;
        expect(a1.x?.data.address).toBe(0x35a00);
        expect(a1.x?.indexCount).toBe(16);
        expect(a1.z.data.address).toBe(0x35a20);
        expect(a1.z.data.rows).toBe(10);
        expect(a1.z.data.cols).toBe(16);
        // 16 x u16 = 32 bytes, so the axis ends exactly where the grid begins. That the file
        // is self-consistent here is the check that the stride rules are right.
        const spans = spansOf(DEF_512K, a1);
        const axis = spans.find(s => s.role === 'axis-x')!;
        expect(axis.end).toBe(0x35a20);
        const grid = spans.find(s => s.role === 'value')!;
        expect(grid.end - grid.start).toBe(10 * 16 * 2);
    });

    it('keeps a label-only axis out of the byte spans', () => {
        const ratios = DEF_512K.items.find(i => i.title === 'Gear Ratios');
        expect(ratios?.kind).toBe('table');
        if (ratios?.kind !== 'table') return;
        expect(ratios.x?.data.address).toBeNull();
        expect(ratios.x?.labels).toEqual(['Neutral', '1', '2', '3', '4', '5', '6', 'Rear']);
        expect(spansOf(DEF_512K, ratios).filter(s => s.role === 'axis-x')).toHaveLength(0);
    });
});

describe('validation', () => {
    const findings = validateXdf(DEF_512K, { source: SRC_512K });

    it('catches the two real collisions in this definition', () => {
        const overlaps = findings.filter(f => f.kind === 'value-overlap');
        const messages = overlaps.map(f => f.message).join('\n');
        expect(messages).toMatch(/FAULT: Upshift Speed Thresholds/);
        expect(messages).toMatch(/SPORT\/RACE: Upshift Speed Low Thresholds/);
        expect(messages).toMatch(/Rear, Neutral or 1st Gear/);
        expect(messages).toMatch(/RPM Thresholds/);
        expect(overlaps).toHaveLength(2);
    });

    it('does not call a shared axis a collision, including when one table takes a prefix', () => {
        // Twelve tables point their x axis at 0x36D40 or 0x36E00, and they do NOT all read the
        // same length: ten seven-column tables take seven points of an eight-point run that two
        // other tables read in full. Reporting that would train the reader to ignore this list,
        // and then it protects nothing.
        expect(findings.filter(f => f.kind === 'misaligned-axis-overlap')).toHaveLength(0);

        const shared = DEF_512K.items.filter(
            i => i.kind === 'table' && (i.x?.data.address === 0x36d40 || i.x?.data.address === 0x36e00));
        expect(shared).toHaveLength(12);

        const lengths = new Set(shared.map(i => (i.kind === 'table' ? i.x!.indexCount : 0)));
        expect([...lengths].sort()).toEqual([7, 8]);
    });

    it('does not call a deliberately blank row heading a missing label', () => {
        // Ten single-row tables carry `<LABEL index="0" value="" />` — an intentionally empty row
        // heading, not a hole in the index sequence. Treating the two as one produced seven
        // warnings about perfectly good tables.
        expect(findings.filter(f => f.kind === 'label-hole')).toHaveLength(0);

        const blank = DEF_512K.items.find(
            i => i.title === 'SPORT: Downshift Low Temperature Speed Offsets');
        expect(blank?.kind).toBe('table');
        if (blank?.kind !== 'table') return;
        expect(blank.y?.labels).toEqual(['']);
        expect(blank.y?.labelHoles).toEqual([]);
    });

    it('reports nothing sitting on the stored checksum', () => {
        expect(findings.filter(f => f.kind === 'overlaps-checksum')).toHaveLength(0);
    });

    it('rejects the 512K definition against a 24 KiB image', () => {
        const wrongVariant = validateXdf(DEF_512K, { imageLength: PARTIAL_LENGTH });
        expect(wrongVariant.some(f => f.kind === 'outside-image')).toBe(true);
        // ...and accepts the variant that was written for it.
        const rightVariant = validateXdf(DEF_24K, { imageLength: PARTIAL_LENGTH });
        expect(rightVariant.some(f => f.kind === 'outside-image')).toBe(false);
    });
});

describe('coverage', () => {
    const report = coverageOf(DEF_24K, { windowStart: 0, windowEnd: PARTIAL_LENGTH });

    it('accounts for 5,477 of the 24,576 bytes', () => {
        expect(report.definedBytes).toBe(5477);
        expect(report.windowBytes).toBe(24576);
        expect(report.fraction).toBeCloseTo(0.2229, 4);
    });

    it('names Pressure as the one declared-but-empty category', () => {
        expect(report.emptyCategories).toEqual(['Pressure']);
        expect(report.itemsPerCategory).toEqual({
            'Pressure': 0,
            'Clutch': 12,
            'System Parameters': 32,
            'Gear Logic': 48,
            'File Data': 3,
            'RPM Limits': 13,
            'Speed Limits': 3,
        });
    });

    it('puts every "Clutch Math" constant in Clutch — the second proof that CATEGORYMEM is 1-based', () => {
        // Read 0-based, these twelve land in "System Parameters" and Clutch comes out empty.
        // Read 1-based, a set of constants literally named "... Clutch Math n" lands in "Clutch".
        // A definition does not line up that way by accident.
        const clutch = DEF_24K.items.filter(i => i.categories.includes('Clutch')).map(i => i.title);
        expect(clutch).toHaveLength(12);
        expect(clutch.every(t => /Clutch Math [123]$/.test(t))).toBe(true);
        expect(new Set(clutch.map(t => t.split(':')[0]))).toEqual(
            new Set(['HILLCLIMB', 'RACESTART', 'PRERACESTART', 'KICKDOWN']));
    });

    it('finds the five large unmapped runs', () => {
        const gaps = report.gaps.map(g => [g.xdfStart, g.xdfEnd, g.bytes]);
        expect(gaps).toEqual(expect.arrayContaining([
            [0x32082, 0x33502, 5248],
            [0x335ea, 0x344ae, 3780],
            [0x345ae, 0x35a00, 5202],
            [0x3732e, 0x37715, 999],
            [0x37751, 0x37fc0, 2159],
        ]));
    });
});

describe('codec round trip', () => {
    /** A synthetic partial image. There is no real SMG2 dump yet; this exercises the mechanics. */
    const image = new Uint8Array(PARTIAL_LENGTH);

    it('reads and writes little-endian 16-bit values through the definition', () => {
        const ratios = DEF_24K.items.find(i => i.title === 'Gear Ratios')!;
        expect(ratios.kind).toBe('table');

        // 1st gear on an E46 M3 six-speed is 4.23; the equation is X/1024.
        encodeCell(DEF_24K, image, ratios, 4.23, 0, 1);
        const decoded = decodeItem(DEF_24K, image, ratios);
        expect(decoded.kind).toBe('table');
        if (decoded.kind !== 'table') return;
        expect(decoded.values[0][1]).toBeCloseTo(4.23, 3);

        // And the bytes really are little-endian: 4.23 * 1024 = 4331.52 -> 4332 = 0x10EC.
        const offset = DEF_24K.fileOffsetOf(0x33504) + 2;
        expect(image[offset]).toBe(0xec);
        expect(image[offset + 1]).toBe(0x10);
    });

    it('refuses a value that does not fit the field', () => {
        expect(() => writeRaw(image, 0, 8, false, false, 256)).toThrow(/does not fit/);
        expect(() => writeRaw(image, 0, 8, true, false, -129)).toThrow(/does not fit/);
        expect(() => readRaw(image, PARTIAL_LENGTH - 1, 16, false, true)).toThrow(/outside the/);
    });

    it('round-trips every signed 16-bit value at both byte orders', () => {
        const buf = new Uint8Array(2);
        for (const raw of [-32768, -1, 0, 1, 32767, 1234, -1234]) {
            for (const lsbFirst of [true, false]) {
                writeRaw(buf, 0, 16, true, lsbFirst, raw);
                expect(readRaw(buf, 0, 16, true, lsbFirst)).toBe(raw);
            }
        }
    });
});

describe('MATH', () => {
    it('derives an exact inverse for every equation this definition uses', () => {
        const equations = new Set<string>();
        for (const item of DEF_512K.items) {
            equations.add(item.kind === 'constant' ? item.scaling.math : item.z.scaling.math);
            if (item.kind === 'table') {
                if (item.x) equations.add(item.x.scaling.math);
                if (item.y) equations.add(item.y.scaling.math);
            }
        }
        expect(equations.size).toBe(15);
        for (const equation of equations) {
            const scaling = compileScaling(equation, -32768, 32767);
            expect(scaling.inverse, `${equation} should be affine`).toBe('affine');
            for (const raw of [-1000, 0, 1, 17, 4321]) {
                expect(scaling.toRaw(scaling.toPhysical(raw))).toBeCloseTo(raw, 6);
            }
        }
    });

    it('handles the leading-dot form the file actually uses', () => {
        const scaling = compileScaling('X*.4', 0, 255);
        expect(scaling.toPhysical(100)).toBeCloseTo(40, 9);
        expect(scaling.toRaw(40)).toBeCloseTo(100, 9);
    });

    it('inverts a non-affine but monotone equation by bisection', () => {
        const scaling = compileScaling('25.6/X', 1, 255);
        expect(scaling.inverse).toBe('bisection');
        expect(scaling.toRaw(scaling.toPhysical(64))).toBeCloseTo(64, 6);
    });

    it('refuses to invert what it cannot invert, rather than guessing', () => {
        const scaling = compileScaling('X*X', -100, 100);
        expect(scaling.inverse).toBe('none');
        expect(() => scaling.toRaw(4)).toThrow(/neither affine nor monotone/);
    });

    it('never evaluates the equation as code', () => {
        expect(() => compileScaling('globalThis', 0, 1)).toThrow(/unsupported identifier/);
        expect(() => compileScaling('X;process.exit(1)', 0, 1)).toThrow();
    });
});

describe('xml reader', () => {
    it('decodes the CRLF entities TunerPro writes into descriptions', () => {
        const description = DEF_512K.header.description!;
        expect(description).toContain('USE AT YOUR OWN RISK');
        expect(description).toContain('ms4x.net');
        expect(description).not.toContain('&#013;');
        expect(description).toContain('\r\n');
    });

    it('rejects malformed documents instead of half-reading them', () => {
        expect(() => parseXml('<a><b></a>')).toThrow(/closes/);
        expect(() => parseXml('<a x="1" x="2"/>')).toThrow(/duplicate attribute/);
        expect(() => parseXml('<a>&nope;</a>')).toThrow(/unknown entity/);
        expect(() => parseXml('<a/><b/>')).toThrow(/trailing content/);
    });
});
