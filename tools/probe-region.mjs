/**
 * Is there code between 0x08240 and 0x10000?
 *
 * §5.2's region list does not cover it, so `EXEC_RANGES` did not either — and the sweep therefore
 * never reached `0x00AD30`, the ASC0 receive handler that §2.2 identified **by name** from the
 * `S0RBUF` read at `0x00AD3A`. Two sections of one document disagreeing is not something to
 * resolve by preference; this measures the region the same way §5.1 measured the others.
 */
import { readFileSync } from 'node:fs';
import { decode, RESET_DPP } from '@tsunagi/c166';

const image = new Uint8Array(readFileSync(process.argv[2]));

function profile(lo, hi, label) {
    let ff = 0, zero = 0, f2 = 0, f6 = 0, total = 0, undef = 0, insns = 0;
    for (let a = lo; a < hi; a++) {
        if (image[a] === 0xff) ff++;
        else if (image[a] === 0x00) zero++;
        if (image[a] === 0xf2) f2++;
        if (image[a] === 0xf6) f6++;
        total++;
    }
    for (let a = lo; a < hi - 4;) {
        const i = decode(image, a, RESET_DPP);
        insns++; if (i.undef) undef++;
        a += i.len;
    }
    const pct = (n) => ((100 * n) / total).toFixed(2);
    console.log(
        `${label.padEnd(26)} ${(hi - lo).toLocaleString().padStart(8)} B  ` +
        `0xFF ${pct(ff).padStart(6)}%  MOV-reg-mem(F2) ${pct(f2).padStart(5)}%  ` +
        `MOV-mem-reg(F6) ${pct(f6).padStart(5)}%  linear-undef ${((100 * undef) / insns).toFixed(2)}%`);
}

// §5.1's own yardstick: F2/F6 run 4.0-5.6% / 1.9-4.2% in code and 0.00-0.28% in calibration.
profile(0x00400, 0x02c2a, 'known code 0x400-0x2C2A');
profile(0x08240, 0x10000, 'UNCLASSIFIED 0x8240-0x10000');
profile(0x40000, 0x4f5de, 'known code seg4');
profile(0x320e0, 0x378c0, 'calibration body');

console.log('\nthe three handlers §2.2 named, decoded cold:');
for (const at of [0x009478, 0x00acf0, 0x00ad30, 0x00b0b4]) {
    const out = [];
    let a = at;
    for (let n = 0; n < 6; n++) { const i = decode(image, a, RESET_DPP); out.push(i.text); a += i.len; }
    console.log(`  0x${at.toString(16).toUpperCase()}  ${out.join(' | ')}`);
}
