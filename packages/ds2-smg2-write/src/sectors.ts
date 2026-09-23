/**
 * The flash sector map, read out of the ECU's own erase tables.
 *
 * ## What this replaces
 *
 * `docs/smg2-write-protocol.md` established that BMW's erase telegram carries a start address and
 * no length, so the erase unit is the ECU's choice. `docs/smg2-flash-driver.md` then found where
 * that choice is made: `FUN_0014b4(base, 0, count)` walks `count` four-byte entries and hands each
 * to the single-sector erase primitive, with `base` = `0x28c` / `count` = 1 for the calibration
 * and `0x270` / 7 for the program.
 *
 * Those bases are **plain physical addresses in the image**. An earlier attempt read them through
 * `DPP0 = 0x0C` — because a bare 16-bit constant in this ECU usually is page-relative — and got
 * `01 01 00 00`, visible nonsense. The `& 0x3fff` in the decompiled loop is a mask, not a page
 * selector.
 *
 * ## Why the derived map can be believed
 *
 * It is cross-checked twice, against files BMW wrote and this project did not:
 *
 *   - the seven program entries are `0x08000 0x10000 0x20000 0x40000 0x50000 0x60000 0x70000`,
 *     and `7843260K.0PA` — BMW's programming data — covers `0x08000-0x7BFFF`. **Same lower bound.**
 *   - the single calibration entry is `0x32010`, and `Y7843259.0DA` — BMW's calibration data —
 *     **starts at `0x32010`.** Not near it; at it.
 *
 * And the map closes: 32 + 32 + 64x7 KiB = exactly 512 KiB, with `0x00000-0x07FFF` in neither
 * list. That is the boot block, which must survive a failed programming attempt — and which is
 * where the flash driver itself lives, at `0x017F0`.
 */

/** One flash sector, as the device is divided. */
export interface Sector {
    readonly start: number;
    /** One past the last byte. */
    readonly end: number;
    readonly role: 'boot' | 'program' | 'calibration';
}

/** Where `FUN_0014b4` is called with each table. From the decompiled `FUN_000ffe`. */
export const ERASE_TABLES = {
    /** `FUN_0014b4(0x270, 0, 7)` — reached when the address validator returns region 1. */
    program: { at: 0x270, count: 7 },
    /** `FUN_0014b4(0x28c, 0, 1)` — region 2, the branch that probes `seg3:0x2000` = `0x32000`. */
    calibration: { at: 0x28c, count: 1 },
} as const;

export const FLASH_LENGTH = 0x80000;

/**
 * Read one erase table.
 *
 * Each entry is `lo:u16, hi:u16` — the same low-word / high-word split the erase telegram uses,
 * and the same split `FUN_002212` uses to assemble an address out of the received bytes.
 */
export function readEraseTable(image: Uint8Array, table: { at: number; count: number }): number[] {
    const u16 = (o: number) => image[o] | (image[o + 1] << 8);
    return Array.from({ length: table.count }, (_, i) => u16(table.at + i * 4) | (u16(table.at + i * 4 + 2) << 16));
}

/**
 * The sector map, derived from both tables.
 *
 * The entries are addresses **inside** the sector to erase — which is exactly why the telegram
 * needs no length — so the boundaries come from where the entries sit relative to each other, plus
 * the one sector that appears in neither list.
 *
 * `boundaries` is the device's own division and is not derived from the entries: a flash part is
 * divided by its silicon, not by which sectors a particular routine happens to erase. What the
 * entries settle is **which** of those sectors each operation clears. The division below is the
 * one that makes both tables land on boundaries, closes to 512 KiB exactly, and leaves precisely
 * one sector unlisted.
 */
export function sectorMap(image: Uint8Array): Sector[] {
    const program = readEraseTable(image, ERASE_TABLES.program);
    const calibration = readEraseTable(image, ERASE_TABLES.calibration);
    const boundaries = [0x00000, 0x08000, 0x10000, 0x20000, 0x30000, 0x40000, 0x50000, 0x60000, 0x70000];

    return boundaries.map((start, i) => {
        const end = boundaries[i + 1] ?? FLASH_LENGTH;
        const inSector = (a: number) => a >= start && a < end;
        const role: Sector['role'] = program.some(inSector) ? 'program'
            : calibration.some(inSector) ? 'calibration'
            : 'boot';
        return { start, end, role };
    });
}

/** The one sector a calibration write clears. */
export function calibrationSector(image: Uint8Array): Sector | null {
    return sectorMap(image).find(s => s.role === 'calibration') ?? null;
}

/**
 * What an erase would take with it beyond the bytes anyone meant to change.
 *
 * This is the number a confirmation dialog has to be able to state. The calibration body is
 * `0x320E0-0x378BF`; the sector holding it is larger, and everything else inside that sector is
 * cleared too whether or not it was edited.
 */
export function collateralOf(sector: Sector, calibrationLo: number, calibrationHi: number): {
    readonly below: number;
    readonly above: number;
} {
    return {
        below: Math.max(0, calibrationLo - sector.start),
        above: Math.max(0, sector.end - calibrationHi),
    };
}
