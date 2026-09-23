/**
 * Who reads the telegram the receive interrupt assembled.
 *
 * `FUN_00ad30` decompiled to the DS2 frame receiver: it checks the address byte against 0x32,
 * accumulates a running XOR at `0x00E15D`, counts bytes at `0x00E15E` against the length byte at
 * `0x00E05D`, and on a zero checksum sets bit 1 of `0x00FD00`. So the service byte — the one the
 * SGBD's telegrams put at offset 2, and the one that is `0x07` for erase/write/finish — lands at
 * `0x00E05E`, and whatever acts on a telegram must read it.
 */
import { readFileSync } from 'node:fs';
import { sweep } from '@tsunagi/c166';

const image = new Uint8Array(readFileSync(process.argv[2]));
const result = sweep(image);
const WANTED = new Map([
    [0x00e05c, 'ECU address byte'],
    [0x00e05d, 'length byte'],
    [0x00e05e, 'SERVICE byte'],
    [0x00e15d, 'running XOR'],
    [0x00fd00, 'receiver flags'],
]);

const rows = [];
for (const fn of result.funcs.values()) {
    const hits = new Map();
    for (const ref of [...fn.reads, ...fn.writes]) {
        const label = WANTED.get(ref.at ?? -1);
        if (label) hits.set(label, (hits.get(label) ?? 0) + 1);
    }
    if (hits.size > 0) rows.push({ at: fn.at, insns: fn.insns.length, hits });
}
rows.sort((a, b) => b.hits.size - a.hits.size || b.insns - a.insns);
console.log(`functions touching the DS2 telegram buffer: ${rows.length}`);
for (const row of rows.slice(0, 14)) {
    console.log(`  0x${row.at.toString(16).toUpperCase().padStart(5, '0')}  ${String(row.insns).padStart(4)} insn  ` +
        [...row.hits].map(([k, n]) => `${k}x${n}`).join(', '));
}
