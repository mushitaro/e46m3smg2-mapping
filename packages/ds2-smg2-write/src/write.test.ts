/**
 * The telegrams are checked against the constants in BMW's SGBD, byte for byte.
 *
 * `docs/smg2-write-protocol.md` records where each came from: `SMG2.prg` disassembled with
 * BESTDIS, the `move S1,{...}` literal that EDIABAS pushes into its send buffer. The expected
 * values here are those literals, not this module's own output — which is the only way a test of
 * a protocol means anything.
 */
import { describe, expect, it } from 'vitest';
import {
    baudTelegram, eraseTelegram, finishTelegram, maxBlockLengthTelegram,
    resetTelegram, seedTelegram, writeTelegram, FAST_BAUD,
} from './telegrams';
import { preflight, type FlashPlan } from './preflight';
import {
    ERASE_TABLES, FLASH_LENGTH, calibrationSector, collateralOf, readEraseTable, sectorMap,
} from './sectors';
import { parseXdf } from '@tsunagi/xdf-engine';
import { existsSync, readFileSync } from 'node:fs';

const XDF = 'public/xdf/Siemens_SMG_II_510_512K.xdf';
const DUMP = 'data/extractions/5c5a0c857acd.bin';
/**
 * The gate and the sector map are checked against the MS4X XDF and the real dump, neither of which
 * is in this repository (third-party, and one car's ECU). On a fresh clone those two suites skip;
 * the telegram suite needs neither and always runs.
 */
const LOCAL = existsSync(XDF) && existsSync(DUMP);

const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
/** The SGBD templates carry a zero where the transport puts the checksum. */
const withoutChecksum = (b: Uint8Array) => hex(b.slice(0, -1));

describe('the telegrams BMW actually sends', () => {
    it('builds the erase telegram', () => {
        // SGBD: move S1,{$32,$09,$07,$06,$00,$00,$00,$00}
        expect(withoutChecksum(eraseTelegram(0))).toBe('32 09 07 06 00 00 00 00');
        expect(withoutChecksum(eraseTelegram(0x320e0))).toBe('32 09 07 06 03 20 E0 00');
    });

    it('builds the write and finish telegrams', () => {
        // SGBD: {$32,$09,$07,$02,...} and {$32,$09,$07,$0F,...}
        expect(hex(writeTelegram(0x320e0, Uint8Array.of(0xaa, 0xbb))).slice(0, 23))
            .toBe('32 0B 07 02 03 20 E0 00');
        expect(withoutChecksum(finishTelegram(0x320e0))).toBe('32 09 07 0F 03 20 E0 00');
    });

    it('builds the single-byte services', () => {
        expect(withoutChecksum(resetTelegram())).toBe('32 04 12');          // SGBD: {$32,$04,$12}
        expect(withoutChecksum(maxBlockLengthTelegram())).toBe('32 04 0D'); // SGBD: {$32,$04,$0D}
    });

    it('sends the three letters the seed request carries', () => {
        // SGBD: move S1,{$32,$08,$90,$42,$4D,$57,$05} — 42 4D 57 is "BMW".
        expect(withoutChecksum(seedTelegram())).toBe('32 08 90 42 4D 57 05');
    });

    it('builds the baud telegram the way the SGBD spells 9600', () => {
        // SGBD: move S1,{$32,$08,$91,$00,$25,$80,$03} — 0x002580 = 9600, MSB first.
        expect(withoutChecksum(baudTelegram(9600, 0x03))).toBe('32 08 91 00 25 80 03');
        expect(FAST_BAUD).toBe(125000);
    });

    it('closes the frame with the XOR the read path already verifies', () => {
        const t = eraseTelegram(0x320e0);
        expect(t[t.length - 1]).toBe(t.slice(0, -1).reduce((a, b) => a ^ b, 0));
    });

    it('refuses an empty write rather than emitting a frame that means nothing', () => {
        expect(() => writeTelegram(0x320e0, new Uint8Array())).toThrow();
        expect(() => eraseTelegram(0x1000000)).toThrow();
    });
});

describe.skipIf(!LOCAL)('the gate', () => {
    const def = LOCAL ? parseXdf(readFileSync(XDF, 'utf8')) : (undefined as unknown as ReturnType<typeof parseXdf>);
    const original = LOCAL ? new Uint8Array(readFileSync(DUMP)) : new Uint8Array(0);

    /** A plan that is perfect except for whatever the test changes. */
    const goodPlan = (over: Partial<FlashPlan> = {}): FlashPlan => ({
        bytes: original,
        original,
        originalSha256: 'x'.repeat(64),
        declaredZb: '7843255',
        imageZb: '7843255',
        checksumOk: true,
        editedRanges: [],
        backupVerified: true,
        batteryVolts: 13.8,
        eraseGranularity: null,
        ...over,
    });

    it('refuses today, and names the one fact that is missing', () => {
        const result = preflight(goodPlan(), def);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        // Everything else passes. This is the whole reason the write path does not ship armed.
        expect(result.findings.filter(f => f.severity === 'blocking').map(f => f.id))
            .toEqual(['erase-granularity']);
    });

    it('authorises once the erase unit is known', () => {
        const result = preflight(goodPlan({ eraseGranularity: 0x8000 }), def);
        expect(result.ok).toBe(true);
    });

    it.each([
        ['zb-mismatch', { imageZb: '7843252' }],
        ['zb-not-declared', { declaredZb: '  ' }],
        ['checksum', { checksumOk: false }],
        ['backup', { backupVerified: false }],
        ['battery-low', { batteryVolts: 11.9 }],
        ['battery-unknown', { batteryVolts: null }],
    ] as const)('blocks on %s', (id, over) => {
        const result = preflight(goodPlan({ eraseGranularity: 0x8000, ...over }), def);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.findings.map(f => f.id)).toContain(id);
    });

    it('blocks a byte that changed without an edit to account for it', () => {
        const tampered = new Uint8Array(original);
        tampered[0x33333] ^= 0xff;
        const result = preflight(goodPlan({ bytes: tampered, eraseGranularity: 0x8000 }), def);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.findings.map(f => f.id)).toContain('unclaimed-bytes');
    });

    it('blocks an edit outside everything the definition names', () => {
        // The trap: recomputing the CRC makes an edit to an unnamed byte verify cleanly.
        const tampered = new Uint8Array(original);
        tampered[0x35000] ^= 0xff;
        const result = preflight(
            goodPlan({ bytes: tampered, editedRanges: [[0x35000, 0x35001]], eraseGranularity: 0x8000 }),
            def,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.findings.map(f => f.id)).toContain('unnamed-edit');
    });
});

describe.skipIf(!LOCAL)('the flash sector map, read from the ECU’s own erase tables', () => {
    const image = LOCAL ? new Uint8Array(readFileSync(DUMP)) : new Uint8Array(0);

    it('reads the seven program entries the driver erases', () => {
        // FUN_0014b4(0x270, 0, 7) in the decompiled FUN_000ffe.
        expect(readEraseTable(image, ERASE_TABLES.program))
            .toEqual([0x08000, 0x10000, 0x20000, 0x40000, 0x50000, 0x60000, 0x70000]);
    });

    it('reads the single calibration entry, and it is where BMW’s own data file starts', () => {
        // FUN_0014b4(0x28c, 0, 1). `Y7843259.0DA` covers 0x32010-0x37FFF — the same 0x32010.
        // Two files written by BMW, agreeing on an address this project did not choose.
        expect(readEraseTable(image, ERASE_TABLES.calibration)).toEqual([0x32010]);
    });

    it('closes to exactly 512 KiB with one sector in neither list', () => {
        const map = sectorMap(image);
        expect(map.reduce((n, s) => n + (s.end - s.start), 0)).toBe(FLASH_LENGTH);
        // The boot block. It holds the vector table, the reset path, and the flash driver source
        // at 0x017F0 — the code that performs the erase cannot be in a sector the erase clears.
        const boot = map.filter(s => s.role === 'boot');
        expect(boot).toHaveLength(1);
        expect(boot[0]).toMatchObject({ start: 0x00000, end: 0x08000 });
    });

    it('puts the calibration in one 64 KiB sector', () => {
        const sector = calibrationSector(image);
        expect(sector).toMatchObject({ start: 0x30000, end: 0x40000, role: 'calibration' });
        expect(sector!.end - sector!.start).toBe(64 * 1024);
    });

    it('says what an erase takes beyond the calibration body', () => {
        // The number a confirmation has to be able to state. 0x320E0-0x378BF is the CRC-protected
        // body; the sector is larger at both ends, and all of it goes.
        const sector = calibrationSector(image)!;
        const { below, above } = collateralOf(sector, 0x320e0, 0x378c0);
        expect(below).toBe(0x320e0 - 0x30000);   // 8,416 bytes under the body
        expect(above).toBe(0x40000 - 0x378c0);   // 34,880 bytes over it
    });

    it('authorises a write once the sector is known', () => {
        const def = parseXdf(readFileSync('public/xdf/Siemens_SMG_II_510_512K.xdf', 'utf8'));
        const original = new Uint8Array(readFileSync('data/extractions/5c5a0c857acd.bin'));
        const sector = calibrationSector(image)!;
        const result = preflight({
            bytes: original, original, originalSha256: 'x'.repeat(64),
            declaredZb: '7843260', imageZb: '7843260', checksumOk: true, editedRanges: [],
            backupVerified: true, batteryVolts: 13.8,
            eraseGranularity: sector.end - sector.start,
        }, def);
        expect(result.ok).toBe(true);
    });
});
