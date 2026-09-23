/**
 * The flash sector map, read out of the image.
 *
 * `FUN_0014b4(base, 0, count)` walks `count` four-byte entries at `base` and hands each to the
 * single-sector erase primitive. The bases are `0x28c` (calibration, count 1) and `0x270`
 * (program, count 7).
 *
 * An earlier attempt read these through DPP0 = 0x0C, on the theory that a 16-bit constant in this
 * ECU is page-relative, and got `01 01 00 00` — visible nonsense. The `& 0x3fff` in the
 * decompiled loop is a mask, not a page selector: **the bases are plain physical addresses.**
 * Reading them that way gives exact flash sector boundaries.
 */
import { readFileSync } from 'node:fs';

const image = new Uint8Array(readFileSync(process.argv[2]));
const u16 = (o) => image[o] | (image[o + 1] << 8);
/** Each entry is `lo:u16, hi:u16` — the same low-word/high-word split the erase telegram uses. */
const entry = (o) => u16(o) | (u16(o + 2) << 16);

const read = (base, count) =>
    Array.from({ length: count }, (_, i) => entry(base + i * 4));

const program = read(0x270, 7);
const calibration = read(0x28c, 1);

const hex = (n) => '0x' + n.toString(16).toUpperCase().padStart(5, '0');
console.log('PROGRAM erase list  (FUN_0014b4(0x270, 0, 7)):', program.map(hex).join(' '));
console.log('CALIBRATION erase   (FUN_0014b4(0x28c, 0, 1)):', calibration.map(hex).join(' '));

/**
 * The entries are addresses *inside* the sector to erase, which is why the erase telegram carries
 * an address and no length. Sorting all of them and adding the boot block gives the device map.
 */
const starts = [...program].sort((a, b) => a - b);
console.log('\nderived sector map:');
const all = [0x00000, ...starts.slice(0, 2), 0x10000, 0x20000, 0x30000, 0x40000, 0x50000, 0x60000, 0x70000]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);
for (let i = 0; i < all.length; i++) {
    const end = (all[i + 1] ?? 0x80000) - 1;
    const size = end - all[i] + 1;
    const role = all[i] === 0x00000 ? 'BOOT — in neither list, never erased'
        : program.some(p => p >= all[i] && p <= end) ? 'program'
        : calibration.some(c => c >= all[i] && c <= end) ? '*** CALIBRATION ***'
        : 'in neither list';
    console.log(`  ${hex(all[i])}-${hex(end)}  ${String(size / 1024).padStart(3)} KiB  ${role}`);
}

// The independent check: BMW's own programming files must line up with these boundaries.
console.log('\ncross-check against BMW\'s own files (docs W0):');
console.log(`  .0PA program data covers 0x08000-0x7BFFF; the 7 program sectors span ` +
    `${hex(starts[0])}-0x7FFFF`);
console.log(`  .0DA calibration data starts at 0x32010; the calibration entry is ${hex(calibration[0])}`);
