/**
 * Walk out from the serial interrupt to whatever decides what a DS2 telegram means.
 *
 * §2.2 identified `0x00AD30` as the ASC0 receive interrupt by the register it reads (`S0RBUF` at
 * `0x00AD3A`). Everything the ECU does about a telegram is downstream of that, so the dispatcher
 * for service `0x07` — erase, write, finish — is reachable from it. This prints the reachable set
 * with the constants each function compares against, because a dispatcher is exactly a function
 * that compares one byte against many values.
 */
import { readFileSync } from 'node:fs';
import { sweep } from '@tsunagi/c166';

const image = new Uint8Array(readFileSync(process.argv[2]));
const result = sweep(image);
const ROOTS = [0x00ad30, 0x00acf0, 0x00b0b4];

const reach = new Set();
const queue = [...ROOTS];
while (queue.length) {
    const at = queue.shift();
    if (reach.has(at)) continue;
    const fn = result.funcs.get(at);
    if (!fn) continue;
    reach.add(at);
    for (const callee of [...fn.calls, ...fn.tails]) queue.push(callee);
}
console.log(`reachable from the ASC0 handlers: ${reach.size} functions`);

/** How many distinct small constants a function compares against — a dispatcher's fingerprint. */
const rows = [];
for (const at of reach) {
    const fn = result.funcs.get(at);
    const values = new Set();
    for (const insn of fn.insns) {
        if (!/^CMPB?\s/.test(insn.text)) continue;
        const m = /#(?:0x)?0*([0-9A-F]{1,4})h?$/.exec(insn.text.trim());
        if (m) values.add(parseInt(m[1], 16));
    }
    rows.push({ at, insns: fn.insns.length, values });
}
rows.sort((a, b) => b.values.size - a.values.size);
console.log('\nmost dispatcher-shaped functions reachable from the serial interrupt:');
for (const row of rows.slice(0, 10)) {
    const list = [...row.values].sort((a, b) => a - b).map(v => '0x' + v.toString(16).toUpperCase());
    console.log(`  0x${row.at.toString(16).toUpperCase().padStart(5, '0')}  ${String(row.insns).padStart(4)} insn  compares ${row.values.size}: ${list.slice(0, 18).join(' ')}`);
}
const withSeven = rows.filter(r => r.values.has(7));
console.log(`\nof those, ${withSeven.length} compare against 0x07:`,
    withSeven.map(r => '0x' + r.at.toString(16).toUpperCase()).join(' '));
