/**
 * The function that turns a service-0x07 telegram into a flash operation.
 *
 * The dispatcher chain established: `0x00E023` is the security state (locked → `0x04` seed sent →
 * `0x02`/`0x20` unlocked), the service byte is `0x00E05E`, and `-0x70` = `0x90` is the seed-key
 * service. Erase/write/finish are service `0x07`, so their handler reads `0x00E05E` and finds
 * `0x07`, then reads the address bytes the SGBD places at telegram offsets that land at
 * `0x00E061`-`0x00E063`. This looks for a function that both tests the service byte AND writes an
 * SFR outside the serial block — the flash controller is memory-mapped, so an erase is a store to
 * a control register, not another RAM flag.
 */
import { readFileSync } from 'node:fs';
import { sweep } from '@tsunagi/c166';

const image = new Uint8Array(readFileSync(process.argv[2]));
const result = sweep(image);

const rows = [];
for (const fn of result.funcs.values()) {
    let touchesService = false;
    const sfrWrites = new Set();
    const farWrites = new Set();
    for (const insn of fn.insns) {
        if (/E05Eh|E05Fh|E060h|E061h|E062h|E063h/.test(insn.text)) touchesService = true;
        const d = insn.data;
        if (!d?.write || d.at === undefined) continue;
        if (d.at >= 0xfe00 && d.at <= 0xffff) sfrWrites.add(d.at);
        // A write high in the address space that is not the known serial/RAM area.
        if (d.at >= 0xe800 && d.at < 0xfe00) farWrites.add(d.at);
    }
    if (touchesService && (sfrWrites.size > 0 || farWrites.size > 0)) {
        rows.push({ at: fn.at, insns: fn.insns.length, sfrWrites, farWrites });
    }
}
console.log(`service-touching functions that write a control register: ${rows.length}`);
for (const row of rows.slice(0, 12)) {
    const sfr = [...row.sfrWrites].map(a => '0x' + a.toString(16).toUpperCase());
    const far = [...row.farWrites].map(a => '0x' + a.toString(16).toUpperCase());
    console.log(`  0x${row.at.toString(16).toUpperCase().padStart(5, '0')}  ${String(row.insns).padStart(4)} insn  SFR:[${sfr.join(' ')}]  far:[${far.slice(0, 6).join(' ')}]`);
}

// Also: which functions read the address-byte trio the erase telegram carries?
console.log('\nfunctions reading the erase telegram address bytes (E061-E063):');
for (const fn of result.funcs.values()) {
    let n = 0;
    for (const insn of fn.insns) if (/E061h|E062h|E063h/.test(insn.text)) n++;
    if (n >= 2) console.log(`  0x${fn.at.toString(16).toUpperCase().padStart(5, '0')}  ${n} refs, ${fn.insns.length} insn`);
}
