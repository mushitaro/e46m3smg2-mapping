/**
 * Where the flash erase actually happens.
 *
 * `docs/smg2-write-protocol.md` established that BMW's erase telegram carries a start address and
 * no length, so the unit that gets cleared is the ECU's choice. That choice lives in the flash
 * driver, and this looks for it by its unmistakable signature rather than by reading 894
 * functions in the hope of recognising one.
 *
 * Parallel NOR flash of this era takes commands as writes of specific values to specific offsets
 * — the JEDEC/AMD sequence `AA` to `x555`, `55` to `x2AA`, then a command byte: `80,AA,55,30` is
 * sector erase, `10` is chip erase, `A0` is program. Those five constants appearing as immediates
 * inside one function is not something ordinary control code does.
 *
 * ## What it found, and why that was still useful
 *
 * **Zero functions.** Not because the driver is absent but because it is never *called*: it lives
 * at `0x017F0` as data, gets copied to `0x306B2` and executed there (`docs/smg2-flash-driver.md`
 * §3), so no recursive sweep will ever decode it as a function. A correct search over the wrong
 * set. `tools/dump-range.mjs` reads it directly, which is how it was eventually found.
 *
 * Kept, because the negative result is the thing worth remembering: **a routine that is copied
 * before it runs is invisible to call-graph analysis**, and this file is where that lesson is
 * attached to the search that failed to learn it.
 */
import { readFileSync } from 'node:fs';
import { sweep } from '@tsunagi/c166';

const image = new Uint8Array(readFileSync(process.argv[2]));
const result = sweep(image);

/** Immediates that matter, and what each one means in the JEDEC command set. */
const MEANING = new Map([
    [0xaa, 'unlock 1'], [0x55, 'unlock 2'], [0x80, 'erase setup'],
    [0x30, 'sector erase'], [0x10, 'chip erase'], [0xa0, 'program'], [0xf0, 'reset'],
]);

const rows = [];
for (const fn of result.funcs.values()) {
    const seen = new Map();
    for (const insn of fn.insns) {
        const match = /#(?:00)?([0-9A-F]{2})h$/.exec(insn.text);
        if (!match) continue;
        const value = parseInt(match[1], 16);
        if (!MEANING.has(value)) continue;
        seen.set(value, (seen.get(value) ?? 0) + 1);
    }
    // Both unlock values plus at least one command byte. Either unlock alone is a common constant.
    const hasUnlock = seen.has(0xaa) && seen.has(0x55);
    const commands = [...seen.keys()].filter(v => v !== 0xaa && v !== 0x55);
    if (hasUnlock && commands.length > 0) {
        rows.push({ at: fn.at, insns: fn.insns.length, seen, score: seen.size });
    }
}

rows.sort((a, b) => b.score - a.score || b.insns - a.insns);
console.log(`functions carrying a JEDEC flash command sequence: ${rows.length}\n`);
for (const row of rows.slice(0, 12)) {
    const parts = [...row.seen].sort((a, b) => a[0] - b[0])
        .map(([v, n]) => `${MEANING.get(v)}(0x${v.toString(16).toUpperCase()})x${n}`);
    console.log(`  0x${row.at.toString(16).toUpperCase().padStart(5, '0')}  ${String(row.insns).padStart(4)} insn   ${parts.join('  ')}`);
}
