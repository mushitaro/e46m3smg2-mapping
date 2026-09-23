import { describe, expect, it } from 'vitest';
import {
    CHECKSUM_DESCRIPTORS,
    computeChecksum,
    correctChecksum,
    crc16Reflected,
    readChecksumDescriptor,
    verifyAllChecksums,
    verifyChecksum,
} from './checksum';

/**
 * A synthetic image carrying a descriptor of the ECU's own shape.
 *
 * The real dump is not in this repository — it is a specific car's ECU and `data/` is gitignored.
 * So these fixtures pin the ALGORITHM and the DESCRIPTOR FORMAT, and the last block pins every
 * input measured on the real image.
 */
function imageWithDescriptor(
    at: number,
    blocks: readonly { start: number; end: number }[],
    stored = 0,
): Uint8Array {
    const image = new Uint8Array(0x80000);
    for (let i = 0; i < image.length; i++) image[i] = (i * 31 + (i >> 8)) & 0xff;
    const view = new DataView(image.buffer);
    view.setUint16(at, stored, true);
    view.setUint16(at + 2, blocks.length, true);
    blocks.forEach((b, i) => {
        view.setUint32(at + 4 + i * 8, b.start, true);
        view.setUint32(at + 8 + i * 8, b.end, true);
    });
    return image;
}

describe('CRC-16 reflected 0xA001', () => {
    it('matches the published CRC-16/ARC check value', () => {
        // The standard check: "123456789" with init 0 is 0xBB3D. This is the anchor that says the
        // primitive is the well-known one, not something that merely happens to fit.
        expect(crc16Reflected(new TextEncoder().encode('123456789'), 0x0000)).toBe(0xbb3d);
    });

    it('is affine in the seed, which is why one matching descriptor proves nothing', () => {
        // Fix the message and the polynomial and seed -> crc is a bijection: for ANY stored word
        // there is exactly one seed that reproduces it. Stated as a test because it is the reason
        // this algorithm is credited to the disassembly and not to the fit.
        const message = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const seen = new Set<number>();
        for (let seed = 0; seed < 4096; seed++) seen.add(crc16Reflected(message, seed));
        expect(seen.size).toBe(4096);
    });
});

describe('descriptor parsing', () => {
    it('reads the ECU layout: u16 stored, u16 count, count x (u32 start, u32 end)', () => {
        const image = imageWithDescriptor(0x32080, [{ start: 0x320e0, end: 0x378bf }], 0x1234);
        const d = readChecksumDescriptor(image, 'calibration')!;
        expect(d.stored).toBe(0x1234);
        expect(d.blocks).toEqual([{ start: 0x320e0, end: 0x378bf }]);
        // Inclusive end. Off by one here silently changes every checksum this tool computes.
        expect(d.protectedBytes).toBe(0x378bf + 1 - 0x320e0);
        expect(d.protectedBytes).toBe(22_496);
    });

    it('carries one accumulator across a multi-block descriptor', () => {
        const blocks = [{ start: 0x08000, end: 0x08fff }, { start: 0x10000, end: 0x10fff }];
        const image = imageWithDescriptor(0x0c136, blocks);
        const d = readChecksumDescriptor(image, 'program')!;

        const joined = new Uint8Array([
            ...image.subarray(0x08000, 0x09000), ...image.subarray(0x10000, 0x11000)]);
        expect(computeChecksum(image, d)).toBe(
            crc16Reflected(joined, CHECKSUM_DESCRIPTORS.program.seed));

        // Not the same as CRCing each block from the seed separately — the real nine-block program
        // descriptor does not reproduce that way.
        const perBlock = crc16Reflected(image.subarray(0x10000, 0x11000),
            CHECKSUM_DESCRIPTORS.program.seed);
        expect(computeChecksum(image, d)).not.toBe(perBlock);
    });

    it('refuses a descriptor that is not there rather than inventing ranges', () => {
        const image = new Uint8Array(0x80000).fill(0xff);
        // blockCount would read as 0xFFFF. A wild count means we are not looking at a descriptor.
        expect(readChecksumDescriptor(image, 'calibration')).toBeNull();
    });
});

describe('verification against a window-only read', () => {
    it('answers for the calibration area and declines the program area', () => {
        // A 24 KiB window read holds the calibration descriptor but none of the program blocks.
        // "I cannot check this" must not come back looking like "this is wrong".
        const full = imageWithDescriptor(0x32080, [{ start: 0x320e0, end: 0x378bf }]);
        const view = new DataView(full.buffer);
        view.setUint16(0x0c136, 0, true);
        view.setUint16(0x0c138, 1, true);
        view.setUint32(0x0c13a, 0x40000, true);
        view.setUint32(0x0c13e, 0x4ffff, true);

        const windowRead = full.slice(0x32000, 0x38000);
        expect(verifyChecksum(windowRead, 'calibration', 0x32000)).not.toBeNull();
        expect(verifyChecksum(windowRead, 'program', 0x32000)).toBeNull();
        expect(verifyAllChecksums(windowRead, 0x32000).map(r => r.area)).toEqual(['calibration']);
    });
});

describe('correction', () => {
    it('writes the computed value and leaves the input untouched', () => {
        const image = imageWithDescriptor(0x32080, [{ start: 0x320e0, end: 0x378bf }], 0xdead);
        const before = Uint8Array.from(image);

        expect(verifyChecksum(image, 'calibration')!.ok).toBe(false);
        const fixed = correctChecksum(image, 'calibration')!;

        expect(fixed.before).toBe(0xdead);
        expect(verifyChecksum(fixed.bytes, 'calibration')!.ok).toBe(true);
        // The original must survive: an edit session's provenance is the bytes the car gave us.
        expect(Array.from(image)).toEqual(Array.from(before));
    });

    it('is idempotent, and only an edit inside the protected range invalidates it', () => {
        const image = imageWithDescriptor(0x32080, [{ start: 0x320e0, end: 0x378bf }]);
        const once = correctChecksum(image, 'calibration')!.bytes;
        expect(correctChecksum(once, 'calibration')!.after).toBe(
            verifyChecksum(once, 'calibration')!.stored);

        const edited = Uint8Array.from(once);
        edited[0x33504] ^= 0x01;                      // Gear Ratios, inside 0x320E0-0x378BF
        expect(verifyChecksum(edited, 'calibration')!.ok).toBe(false);

        const outside = Uint8Array.from(once);
        outside[0x37fc0] ^= 0x01;                     // IDENT0, outside the protected range
        expect(verifyChecksum(outside, 'calibration')!.ok).toBe(true);
    });
});

describe('inputs measured on the real ECU', () => {
    it('pins the seeds, addresses and block ranges dump 5c5a0c857acd yielded', () => {
        // The image itself is not in the repository, so what is pinned here is every input the
        // computation takes. Change the polynomial, the reflection, a seed, a descriptor address
        // or the inclusive end, and one of these stops matching.
        expect(CHECKSUM_DESCRIPTORS).toEqual({
            boot: { address: 0x03c24, seed: 0x2d2d },
            program: { address: 0x0c136, seed: 0x7878 },
            calibration: { address: 0x32080, seed: 0x7878 },
        });

        const CALIBRATION_BLOCK = { start: 0x320e0, end: 0x378bf };
        expect(CALIBRATION_BLOCK.end + 1 - CALIBRATION_BLOCK.start).toBe(22_496);

        const PROGRAM_BLOCKS = [
            { start: 0x08000, end: 0x0bcbd }, { start: 0x0c000, end: 0x0c05d },
            { start: 0x0c21e, end: 0x0c32e }, { start: 0x10000, end: 0x1cc8f },
            { start: 0x2c000, end: 0x2f998 }, { start: 0x40000, end: 0x4f5dd },
            { start: 0x50000, end: 0x5fb8f }, { start: 0x6d000, end: 0x6f573 },
            { start: 0x70000, end: 0x7bfe9 },
        ];
        expect(PROGRAM_BLOCKS).toHaveLength(9);
        expect(PROGRAM_BLOCKS.reduce((n, b) => n + b.end + 1 - b.start, 0)).toBe(269_090);

        const BOOT_BLOCK = { start: 0x00000, end: 0x02c29 };
        expect(BOOT_BLOCK.end + 1 - BOOT_BLOCK.start).toBe(11_306);
    });
});
