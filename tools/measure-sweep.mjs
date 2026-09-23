import { readFileSync } from 'node:fs';
import { sweep, EXEC_RANGES } from '@tsunagi/c166';
const image = new Uint8Array(readFileSync(process.argv[2]));
const t0 = Date.now();
const r = sweep(image);
const ms = Date.now() - t0;
let insns = 0, undef = 0, covered = 0;
for (const f of r.funcs.values()) { insns += f.insns.length; undef += f.undef; for (const i of f.insns) covered += i.len; }
const execBytes = EXEC_RANGES.reduce((n, [lo, hi]) => n + hi - lo, 0);
console.log(`functions ${r.funcs.size}  instructions ${insns}  undefined ${undef} (${(100*undef/insns).toFixed(4)}%)`);
console.log(`covered ${covered} / ${execBytes} exec bytes = ${(100*covered/execBytes).toFixed(1)}%   sweep ${ms} ms`);
const cal = [...r.funcs.values()].flatMap(f => f.reads.map(d => d.at)).filter(a => a >= 0x320e0 && a < 0x378c0);
let prog = 0; for (let a = 0x320e0; a < 0x378c0; a++) if (image[a] !== 0xff) prog++;
const base = prog / (0x378c0 - 0x320e0);
const hit = cal.filter(a => image[a] !== 0xff).length / cal.length;
console.log(`calibration reads ${cal.length}: on programmed bytes ${(100*hit).toFixed(1)}% (base rate ${(100*base).toFixed(1)}%)`);
