/**
 * The factory data, against the car.
 *
 * This is the strongest verification available to this project. Everything else compares the tool
 * to itself: a read against a second read, a CRC against the value the same image stores. Here
 * the comparison is against BMW's own programming files, which were written in 2009 by people who
 * had never heard of this tool.
 *
 * The SP-DATEN is not in the repository (it is BMW's, and it is 600 KB), so these tests skip when
 * it is absent. What they assert when it is present:
 *
 *   - the dump matches the factory program and data byte for byte
 *   - the CRC identified from the flash reproduces the checksums BMW's files declare
 *   - the four variants differ where the analysis said they differ
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc16Reflected, readChecksumDescriptor, verifyChecksum } from '@tsunagi/ds2-smg2';
import { compareToImage, overlayFactory, parseFactoryFile } from './ihex';
import { DECLARED_CHECKSUMS, FACTORY_VARIANTS, PROGRAM_FILE, SUBJECT_VARIANT } from './catalogue';

const SP = join(__dirname, '..', '..', '..', 'E46_v74', 'data', 'GDSMG2');
const DUMP = join(__dirname, '..', '..', '..', 'data', 'extractions', '5c5a0c857acd.bin');

const have = existsSync(SP) && existsSync(join(SP, PROGRAM_FILE)) && existsSync(DUMP);
const read = (name: string) => parseFactoryFile(readFileSync(join(SP, name), 'latin1'));

describe.skipIf(!have)('BMW factory programming data vs the car', () => {
    it('the program file matches the dump byte for byte', () => {
        const image = new Uint8Array(readFileSync(DUMP));
        const program = read(PROGRAM_FILE);

        expect(program.lowAddress).toBe(0x08000);
        expect(program.highAddress).toBe(0x7bfff);
        // BMW's own record type, which a standard Intel HEX parser would drop.
        expect(program.recordTypes).toContain(0x10);

        const { same, differ } = compareToImage(image, program);
        expect(differ).toBe(0);
        expect(same).toBe(258_304);
    });

    it('the subject variant matches the dump byte for byte, so the car is calibration-stock', () => {
        const image = new Uint8Array(readFileSync(DUMP));
        const data = read(SUBJECT_VARIANT.dataFile);

        expect(data.lowAddress).toBe(0x32010);
        expect(data.highAddress).toBe(0x37fff);

        const { same, differ } = compareToImage(image, data);
        expect(differ).toBe(0);
        expect(same).toBe(12_768);
    });

    it('program and data do not overlap, which is why a calibration-only write exists', () => {
        // BMW writes the .0DA independently of the .0PA. If the two shared an address there
        // would be no such thing as a data-only update, and the erase question would be much
        // worse than it is.
        const program = read(PROGRAM_FILE);
        const data = read(SUBJECT_VARIANT.dataFile);
        const shared = [...data.bytes.keys()].filter(a => program.bytes.has(a));
        expect(shared).toEqual([]);
    });

    it('reproduces the checksums BMW declared, from the factory files alone', () => {
        // The confirmation that matters: the CRC was identified from the dump's own instruction
        // stream, and here it reproduces two values written by BMW in 2009. A fit to one image
        // could not do this.
        const program = read(PROGRAM_FILE);
        const data = read(SUBJECT_VARIANT.dataFile);

        const built = overlayFactory(
            overlayFactory(new Uint8Array(0x80000).fill(0xff), program).bytes, data).bytes;

        const calibration = verifyChecksum(built, 'calibration');
        expect(calibration).not.toBeNull();
        expect(calibration!.computed).toBe(DECLARED_CHECKSUMS.calibrationSubject);
        expect(data.declaredChecksum).toBe(DECLARED_CHECKSUMS.calibrationSubject);

        const descriptor = readChecksumDescriptor(built, 'program')!;
        expect(descriptor.blocks).toHaveLength(9);
        let crc = 0x7878;
        for (const { start, end } of descriptor.blocks) crc = crc16Reflected(built.subarray(start, end + 1), crc);
        expect(crc).toBe(DECLARED_CHECKSUMS.program);
        expect(program.declaredChecksum).toBe(DECLARED_CHECKSUMS.program);
    });

    it('carries the identity string the flash holds', () => {
        const data = read(SUBJECT_VARIANT.dataFile);
        // $REFERENZ is the IDENT0 string at 0x37FC0; the program file carries the 0x2FF70 one.
        expect(data.reference).toBe('0549T05105100570');
        expect(read(PROGRAM_FILE).reference).toBe('0549T0510510');

        // The identity string decomposes: 0549T051 + program level 0510 + data level 0570.
        // The program file's own reference stops at the program level, and the subject data file
        // declares 0570 — which is why IDENT0 in the flash is the concatenation of the two.
        expect(data.header.get('Z_Stand')).toBe('0570');
        expect(read(PROGRAM_FILE).header.get('Z_Stand')).toBe('0510');
        expect(data.header.get('ZL_REFERENZ')).toBe('0549T0510570');
    });

    it('the four variants differ where the shift tables are', () => {
        const files = FACTORY_VARIANTS.map(v => read(v.dataFile));
        const addresses = [...files[0].bytes.keys()];
        for (const f of files) expect(f.bytes.size).toBe(files[0].bytes.size);

        const differing = addresses.filter(a => new Set(files.map(f => f.bytes.get(a))).size > 1);
        expect(differing.length).toBeGreaterThan(500);

        // Concentrated in the AUTO family. 0x35A00 + n*0x160 for n = 0..10.
        const inAuto = differing.filter(a => a >= 0x35a00 && a < 0x36920);
        expect(inAuto.length / differing.length).toBeGreaterThan(0.6);
    });

    it('refuses a record it does not model rather than dropping bytes', () => {
        expect(() => parseFactoryFile(':02000003AABB96\n')).toThrow(/not modelled/);
    });

    it('refuses a record whose checksum is wrong', () => {
        expect(() => parseFactoryFile(':0400000012345678FF\n')).toThrow(/checksum is wrong/);
    });
});

describe('the Intel HEX parser, without the SP-DATEN', () => {
    it('reads type 0x00 and type 0x10 the same way', () => {
        // :02 0100 00 ABCD  and  :02 0200 10 EF01, with correct checksums.
        const hex = [':02010000ABCD8D', ':0202001*EF01*', ':00000001FF'];
        void hex;
        const build = (addr: number, type: number, data: number[]) => {
            const raw = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
            const sum = raw.reduce((a, b) => a + b, 0);
            return ':' + [...raw, (-sum) & 0xff].map(b => b.toString(16).padStart(2, '0')).join('');
        };
        const text = [build(0x0100, 0x00, [0xab, 0xcd]), build(0x0200, 0x10, [0xef, 0x01]), ':00000001FF'].join('\n');
        const file = parseFactoryFile(text);
        expect(file.bytes.get(0x0100)).toBe(0xab);
        expect(file.bytes.get(0x0201)).toBe(0x01);
        expect(file.recordTypes).toEqual([0x00, 0x01, 0x10]);
    });
});
