import { readFileSync } from 'node:fs';
import { sweep, decode, RESET_DPP, resolve } from '@tsunagi/c166';
const image = new Uint8Array(readFileSync(process.argv[2]));
const r = sweep(image);
let n = 0, inCal = 0, onProg = 0;
for (const f of r.funcs.values()) for (const i of f.insns) {
    if (!i.indexed || i.indexed.disp === 0) continue;
    n++;
    const a = resolve(i.indexed.disp, RESET_DPP)?.at;
    if (a === undefined || a < 0x320e0 || a >= 0x378c0) continue;
    inCal++;
    if (image[a] !== 0xff) onProg++;
}
let prog = 0; for (let a = 0x320e0; a < 0x378c0; a++) if (image[a] !== 0xff) prog++;
const base = prog / (0x378c0 - 0x320e0);
console.log(`base+disp accesses ${n}; displacement lands in calibration ${inCal}; on a programmed byte ${onProg}`);
console.log(`base rate ${(100*base).toFixed(1)}% programmed -> null hypothesis predicts ${Math.round(inCal*base)} of ${inCal}`);
