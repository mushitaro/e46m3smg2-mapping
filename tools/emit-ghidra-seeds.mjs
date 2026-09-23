/**
 * Hand Ghidra the entry points this project's own sweep already found.
 *
 * ## Why the two tools are not rivals
 *
 * Ghidra with the C166 module disassembles correctly — checked against the five encodings this
 * project established by hand — but left to itself it found **64 functions and 3,373
 * instructions** in this image. It has no way to know that segment 0's vector table forwards to a
 * second one at 0x10000, that `0x2DC28` holds 46 code pointers, or that the bulk of the program
 * is reached only through those tables. That knowledge is in `@tsunagi/c166`, which found 896
 * functions and 54,314 instructions from exactly those facts.
 *
 * So: this repo supplies **where the code is**, and Ghidra supplies **what it means** — the
 * decompiler, which no amount of work here will ever produce.
 *
 *   node --experimental-strip-types --import ./tools/ts-resolve-hooks.mjs \
 *        tools/emit-ghidra-seeds.mjs data/extractions/5c5a0c857acd.bin > build/seeds.json
 */
import { readFileSync } from 'node:fs';
import { sweep, vectorSeeds, pointerSeeds, callSiteSeeds } from '@tsunagi/c166';

const path = process.argv[2];
if (!path) {
    console.error('usage: emit-ghidra-seeds.mjs <image.bin>');
    process.exit(2);
}
const image = new Uint8Array(readFileSync(path));
const result = sweep(image);

/** Why each entry point is an entry point, kept so a Ghidra comment can say it. */
const why = new Map();
for (const seed of [...vectorSeeds(image), ...pointerSeeds(image), ...callSiteSeeds(image)]) {
    if (!why.has(seed.at)) why.set(seed.at, seed.why);
}

const entries = [...result.funcs.values()]
    .sort((a, b) => a.at - b.at)
    .map(fn => ({
        at: fn.at,
        insns: fn.insns.length,
        returns: fn.returns,
        why: why.get(fn.at) ?? 'reached by a call from another function',
    }));

process.stdout.write(JSON.stringify({
    image: path,
    bytes: image.length,
    functions: entries.length,
    instructions: entries.reduce((n, e) => n + e.insns, 0),
    entries,
}, null, 1));
