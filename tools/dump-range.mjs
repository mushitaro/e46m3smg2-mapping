/**
 * Disassemble a byte range that nothing calls.
 *
 * The flash algorithm at 0x017F0 is never *called* — it is copied elsewhere and executed there —
 * so a recursive sweep will never reach it. `find-flash-driver.mjs` looked for JEDEC constants
 * among swept functions and found none: a correct search over the wrong set, and the reason this
 * exists.
 */
import { readFileSync } from 'node:fs';
import { decode, RESET_DPP } from '@tsunagi/c166';

const image = new Uint8Array(readFileSync(process.argv[2]));
const from = parseInt(process.argv[3], 16);
const to = parseInt(process.argv[4], 16);
for (let a = from; a < to;) {
    const i = decode(image, a, RESET_DPP);
    const bytes = [...image.slice(a, a + i.len)].map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`${a.toString(16).toUpperCase().padStart(5, '0')}  ${bytes.padEnd(12)}  ${i.text}`);
    a += i.len;
}
