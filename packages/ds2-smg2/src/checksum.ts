/**
 * The SMG II 510 flash checksum.
 *
 * Identified from the first real 512 KiB dump (`5c5a0c857acd`, E46 M3, ZB 7843260) — not fitted
 * to it. The distinction matters, because a CRC is affine in its seed: fix the message and the
 * polynomial and the map seed -> checksum is a bijection, so for ANY polynomial there is exactly
 * one seed that reproduces a given stored word. A single matching descriptor therefore carries no
 * information at all. What identifies this algorithm is:
 *
 *   1. The polynomial is in the instruction stream. `0x00E04` holds `56 F4 01 A0` = the C166
 *      encoding of `XOR R4, #0xA001`, inside a byte loop whose `SHR R4,#1` (`7C 14` at 0x00E02
 *      and 0x00E0E) and `CMP R15,#8` (`46 FF 08 00` at 0x00E16) make it a reflected bitwise CRC-16.
 *   2. The 256-entry reflected-0xA001 table is at `0x08002`, and it is the ONLY CRC table in the
 *      image — tables for 0x8408, 0x8005, 0x1021, 0xC002 and 0xA6BC are all absent.
 *   3. Three descriptors reproduce with one algorithm and two seeds, including a NINE-block,
 *      269,090-byte program descriptor whose block boundaries independently coincide with the
 *      dense code regions. Nine arbitrary ranges agreeing by chance is not a coincidence anyone
 *      needs to entertain.
 *   4. The seeds are not constants in this file: each descriptor's seed is fetched through a far
 *      pointer the code follows (`0x0C02A` -> `0x0000C0EE` and `0x0C04A` -> `0x0003201C`, both
 *      holding 0x7878; the boot seed is read from `0x03FE6` by `0x00B4C`).
 *
 * Read-only, like everything else in this package: computing a checksum tells you whether an
 * image is self-consistent. It does not put one on a car.
 */

/** Where each descriptor lives, and the seed the ECU feeds its CRC. */
export const CHECKSUM_DESCRIPTORS = {
    /** Boot block. Seed read from 0x03FE6 (ASCII "--"). */
    boot: { address: 0x03c24, seed: 0x2d2d },
    /** Program area, nine blocks. Seed via the far pointer at 0x0C02A (ASCII "xx"). */
    program: { address: 0x0c136, seed: 0x7878 },
    /** The calibration window — the one an edit invalidates. Seed via the far pointer at 0x0C04A. */
    calibration: { address: 0x32080, seed: 0x7878 },
} as const;

export type ChecksumArea = keyof typeof CHECKSUM_DESCRIPTORS;

export const CRC16_POLYNOMIAL = 0xa001;

export interface ChecksumBlock {
    /** Absolute address in the 512 KiB image. */
    readonly start: number;
    /** Absolute address of the LAST protected byte. The ECU's range is inclusive. */
    readonly end: number;
}

export interface ChecksumDescriptor {
    readonly area: ChecksumArea;
    /** Where the descriptor itself sits, absolute. */
    readonly address: number;
    /** The 16-bit value the ECU stored. */
    readonly stored: number;
    readonly blocks: readonly ChecksumBlock[];
    readonly protectedBytes: number;
}

export interface ChecksumResult extends ChecksumDescriptor {
    readonly computed: number;
    readonly ok: boolean;
}

/**
 * Reflected CRC-16, polynomial 0xA001, no final xor.
 *
 * Bitwise rather than table-driven on purpose: it is the shape the ECU's own routine has, it needs
 * no 512-byte constant to keep in sync, and 22 KiB is nothing.
 */
export function crc16Reflected(bytes: Uint8Array, init: number): number {
    let crc = init & 0xffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >>> 1) ^ CRC16_POLYNOMIAL : crc >>> 1;
        }
    }
    return crc & 0xffff;
}

/**
 * `{u16 stored, u16 blockCount, blockCount x (u32 start, u32 end)}`, all little-endian.
 *
 * `imageBase` is the address the first byte of `image` has in the ECU. Zero for a full dump;
 * 0x32000 for a calibration-window-only read, whose descriptor still carries ABSOLUTE addresses.
 */
export function readChecksumDescriptor(
    image: Uint8Array,
    area: ChecksumArea,
    imageBase = 0,
): ChecksumDescriptor | null {
    const { address } = CHECKSUM_DESCRIPTORS[area];
    const at = address - imageBase;
    if (at < 0 || at + 4 > image.length) return null;

    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const stored = view.getUint16(at, true);
    const blockCount = view.getUint16(at + 2, true);
    // A plausibility bound, not a spec: the largest real descriptor has nine blocks. A wild count
    // here means the descriptor is not where we think it is, and reading on would invent ranges.
    if (blockCount < 1 || blockCount > 32) return null;
    if (at + 4 + blockCount * 8 > image.length) return null;

    const blocks: ChecksumBlock[] = [];
    let protectedBytes = 0;
    for (let i = 0; i < blockCount; i++) {
        const start = view.getUint32(at + 4 + i * 8, true);
        const end = view.getUint32(at + 8 + i * 8, true);
        if (end < start) return null;
        blocks.push({ start, end });
        protectedBytes += end + 1 - start;
    }
    return { area, address, stored, blocks, protectedBytes };
}

/**
 * Run the descriptor's blocks through one accumulator, in table order.
 *
 * The carry-over between blocks is not an implementation detail to be tidied away: nine separate
 * CRCs would not reproduce the stored program checksum.
 *
 * Returns null when a block falls outside the bytes we hold, which is the normal case for the
 * program descriptor against a 24 KiB window read. "I cannot check this" and "this is wrong" are
 * different answers and must not share a return value.
 */
export function computeChecksum(
    image: Uint8Array,
    descriptor: ChecksumDescriptor,
    imageBase = 0,
): number | null {
    let crc: number = CHECKSUM_DESCRIPTORS[descriptor.area].seed;
    for (const { start, end } of descriptor.blocks) {
        const from = start - imageBase;
        const to = end + 1 - imageBase;
        if (from < 0 || to > image.length) return null;
        crc = crc16Reflected(image.subarray(from, to), crc);
    }
    return crc;
}

/** Descriptor plus verdict, or null if this image cannot answer for this area. */
export function verifyChecksum(
    image: Uint8Array,
    area: ChecksumArea,
    imageBase = 0,
): ChecksumResult | null {
    const descriptor = readChecksumDescriptor(image, area, imageBase);
    if (!descriptor) return null;
    const computed = computeChecksum(image, descriptor, imageBase);
    if (computed === null) return null;
    return { ...descriptor, computed, ok: computed === descriptor.stored };
}

/** Every area this image holds enough bytes to answer for. */
export function verifyAllChecksums(image: Uint8Array, imageBase = 0): ChecksumResult[] {
    const areas = Object.keys(CHECKSUM_DESCRIPTORS) as ChecksumArea[];
    return areas
        .map(area => verifyChecksum(image, area, imageBase))
        .filter((r): r is ChecksumResult => r !== null);
}

/**
 * Write the correct checksum into a copy of the image.
 *
 * Returns the new bytes and what changed. The input is never mutated: an edit session's
 * `original` has to stay the bytes the car gave us, or provenance is gone.
 *
 * Correcting the CALIBRATION area is the meaningful case — it is the one an edit invalidates, and
 * 132 of the XDF's 134 addresses live inside its protected range. The two that do not are the
 * checksum word itself and IDENT0 at 0x37FC0.
 */
export function correctChecksum(
    image: Uint8Array,
    area: ChecksumArea,
    imageBase = 0,
): { bytes: Uint8Array; before: number; after: number } | null {
    const descriptor = readChecksumDescriptor(image, area, imageBase);
    if (!descriptor) return null;
    const computed = computeChecksum(image, descriptor, imageBase);
    if (computed === null) return null;

    const bytes = Uint8Array.from(image);
    const at = descriptor.address - imageBase;
    bytes[at] = computed & 0xff;
    bytes[at + 1] = (computed >>> 8) & 0xff;
    return { bytes, before: descriptor.stored, after: computed };
}
