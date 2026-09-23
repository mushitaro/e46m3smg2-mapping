#!/usr/bin/env node
/**
 * Generate the PWA icons.
 *
 * Android will not offer to install an app whose manifest has no raster icon, and SVG support for
 * manifest icons is inconsistent enough that relying on it means the install prompt silently never
 * appears on the one platform this feature exists for. So: real PNGs.
 *
 * Written by hand rather than with a dependency because the artwork is three diagonal stripes on
 * black — a rasteriser would be a large dependency for something a loop can draw exactly, and
 * `node:zlib` already supplies the only hard part of the PNG format.
 *
 * The mark is the ///M tricolour at the brand's own hues, on the app's true-black field. Two sizes
 * plus a maskable variant, which Android crops to a circle: the maskable one keeps the stripes
 * inside the safe zone so the crop does not eat them.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(REPO_ROOT, 'public', 'icons');

/** The brand anchors, not the legibility-tuned ramps: an icon is a mark, not a readout. */
const M_BLUE = [0x00, 0x8a, 0xc9];
const M_VIOLET = [0x9b, 0x84, 0xe8];
const M_RED = [0xf1, 0x1a, 0x22];
const FIELD = [0x00, 0x00, 0x00];

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(bytes) {
    let c = -1;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'latin1');
    const body = Buffer.concat([typeBytes, data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
}

/** RGBA8 -> PNG. Filter type 0 on every scanline; the artwork is flat, so a smarter filter buys
 *  nothing and a wrong one is a corrupt file. */
function encodePng(width, height, rgba) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // colour type: RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * Draw the mark.
 *
 * `inset` is the fraction of the canvas kept clear on every side. 0 for the plain icon; 0.1 for
 * the maskable one, whose outer ~10% Android is free to crop away.
 */
function drawMark(size, inset) {
    const rgba = Buffer.alloc(size * size * 4);
    const box = size * (1 - inset * 2);
    const origin = size * inset;

    // Three parallel diagonals, each 1/6 of the box wide, slanted so they read as motion. The
    // stripe a pixel belongs to is decided by its position along the slant, which is what keeps
    // the edges exact at any size without antialiasing machinery.
    const stripeWidth = box / 6;
    const slant = 0.42;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            let colour = FIELD;

            const lx = x - origin;
            const ly = y - origin;
            if (lx >= 0 && ly >= 0 && lx < box && ly < box) {
                // Distance along the axis perpendicular to the stripes, normalised into bands.
                const t = lx + (box - ly) * slant;
                const bandStart = box * 0.30;
                const band = (t - bandStart) / stripeWidth;
                if (band >= 0 && band < 3) {
                    colour = band < 1 ? M_BLUE : band < 2 ? M_VIOLET : M_RED;
                }
            }

            rgba[i] = colour[0];
            rgba[i + 1] = colour[1];
            rgba[i + 2] = colour[2];
            rgba[i + 3] = 255;
        }
    }
    return rgba;
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
    { name: 'icon-192.png', size: 192, inset: 0 },
    { name: 'icon-512.png', size: 512, inset: 0 },
    { name: 'icon-maskable-512.png', size: 512, inset: 0.1 },
];

for (const { name, size, inset } of targets) {
    const png = encodePng(size, size, drawMark(size, inset));
    writeFileSync(join(OUT_DIR, name), png);
    console.log(`[icons] ${name}  ${size}x${size}  ${png.length} bytes`);
}

// An SVG alongside, for the favicon and anywhere a vector is better. Same geometry, stated once
// more in a form a browser can scale.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#000000"/>
  <g transform="skewX(-23)">
    <rect x="42" y="0" width="12" height="100" fill="#008AC9"/>
    <rect x="54" y="0" width="12" height="100" fill="#9B84E8"/>
    <rect x="66" y="0" width="12" height="100" fill="#F11A22"/>
  </g>
</svg>
`;
writeFileSync(join(OUT_DIR, 'icon.svg'), svg, 'utf8');
console.log('[icons] icon.svg');
