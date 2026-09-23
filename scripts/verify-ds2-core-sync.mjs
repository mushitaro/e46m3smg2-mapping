#!/usr/bin/env node
/**
 * ds2-core is VENDORED here, not forked.
 *
 * The single source of truth is E46M3-Diagnosis/packages/ds2-core. Its comments record
 * measurements taken on a real vehicle and the specific incident behind each guard; a
 * silent divergence in this copy would strip protections that were paid for once already.
 *
 * A `file:` dependency breaks across machines and a fork doubles the maintenance. Turning
 * drift into a BUILD FAILURE is cheaper than either. When these repos are eventually
 * consolidated into one monorepo, delete this script along with the copy.
 *
 * Set DS2_CORE_UPSTREAM to point elsewhere. If the upstream is simply absent (a clone on a
 * machine with no checkout of the other repo), that is reported and tolerated: it is
 * "cannot compare", which is different from "compared and differs".
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const LOCAL = join(HERE, 'packages', 'ds2-core');
const UPSTREAM = process.env.DS2_CORE_UPSTREAM
    ?? 'C:/Users/kazuh/E46M3-Diagnosis/packages/ds2-core';

/** Only source and manifest. node_modules and build output are not part of the identity. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo']);

/**
 * The TRANSPORT layer, which this repository owns and `ds2-core` does not get a vote on.
 *
 * Upstream absorbed a WebUSB/FTDI backend, a Web Serial backend and their shared buffering base.
 * This app already has that layer, as `@tsunagi/ds2-transport`, and it is not a copy of upstream's:
 * they are two independent implementations of the same FTDI vendor protocol. Compared feature by
 * feature they are equivalent — the SIO command set, `FTDI_DATA_8E1`, the DTR/RTS-low modem word,
 * the 16 ms latency timer, all four LSR line-status bits and `FtdiLineError`, the AM/BM/R chip-family
 * gate, the baud divisor table, `reopen`/`reopenIsInPlace`/`purge`/`recoverRead`. The one thing
 * upstream has and this does not is `setLatencyTimer('log'|'idle')`, which a datalog arms; this app
 * has no datalog yet.
 *
 * What is NOT equivalent is the provenance. **The bytes of this project's only real SMG II
 * extractions came off the cable through `ds2-transport`** — 24,576 B in 205 telegrams with zero
 * retries, and the 512 KiB image in 4,370 telegrams, both over WebUSB/FTDI on Android
 * (`docs/first-real-extraction.md`). Adopting upstream's copy would swap a proven path for an
 * unproven one to remove a duplication the compiler cannot even see, since nothing here imports it.
 *
 * So these five are declared out of scope rather than vendored. Named individually and asserted
 * below, NOT globbed: the whole value of this gate is that everything it does not name still fails
 * the build, and a pattern would quietly widen as upstream grows.
 *
 * The other half of this decision — replacing `ds2-core/transport.ts`, which is the pre-refactor
 * Web Serial backend with its buffering still inline, with upstream's 200-line version on top of
 * the shared base — is deliberately NOT done here. That path is what a desktop read goes through,
 * and its provenance cannot be inherited by reading a diff; it needs one 24 KiB read whose SHA-256
 * matches the one on record. Until then the old one stays, and this comment is the record of why.
 */
const TRANSPORT_OWNED_HERE = [
    'src/webUsbFtdiTransport.ts',
    'src/webUsbTypes.ts',
    'src/bufferedByteTransport.ts',
    'src/transportSelect.ts',
    'src/ftdiSimulator.ts',
    /** The contract the backends implement. Upstream narrowed it when it grew a second backend;
     *  the Web Serial implementation still in this copy is written against the wider one. */
    'src/byteTransport.ts',
    /** The Web Serial backend — this copy is the PRE-REFACTOR one, with its buffering still inline.
     *  Replacing it is part B, and it is gated on a real desktop read, not on a diff. */
    'src/transport.ts',
];

/**
 * Files upstream changed only in order to wire the second backend in.
 *
 * These are not transport code, and exempting them has a cost worth writing down: **upstream
 * changes to the DS2 simulator and to the link test suite will not be noticed here** until part B
 * lands and this list shrinks. They are here because each one now names a module this package does
 * not have — `index.ts` re-exports it, `simulator.ts` imports `ftdiSimulator`, and `link.test.ts`
 * runs the whole protocol suite over both backends — so none of the three can be taken without
 * taking the transport with it.
 */
const COUPLED_TO_THE_SPLIT = [
    'src/index.ts',
    'src/simulator.ts',
    'src/link.test.ts',
];

/**
 * The subset that must be ABSENT here, not merely uncompared.
 *
 * `byteTransport.ts` and `transport.ts` are exempt from COMPARISON but are still vendored — they
 * exist locally on purpose. These five are the modules upstream ADDED, and a copy of any of them
 * appearing inside `ds2-core` would be the second implementation this exemption exists to prevent.
 *
 * Listed literally. The first cut of this test sniffed substrings — `rel.includes('Buffered')`
 * against `src/bufferedByteTransport.ts`, which is lowercase and never matched — so the guard
 * passed by never firing. A guard that cannot fail is not a guard.
 */
const MUST_NOT_EXIST_LOCALLY = [
    'src/webUsbFtdiTransport.ts',
    'src/webUsbTypes.ts',
    'src/bufferedByteTransport.ts',
    'src/transportSelect.ts',
    'src/ftdiSimulator.ts',
];

/** Their tests go with them; a test for code that is not vendored is not vendored either. */
const OUT_OF_SCOPE = new Set([
    ...TRANSPORT_OWNED_HERE,
    ...COUPLED_TO_THE_SPLIT,
    'src/webUsbFtdi.test.ts',
    'src/transportSelect.test.ts',
]);

function walk(root) {
    const out = new Map();
    const rec = (dir) => {
        for (const name of readdirSync(dir).sort()) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) {
                if (!SKIP_DIRS.has(name)) rec(full);
                continue;
            }
            if (!/\.(ts|tsx|json|md)$/.test(name)) continue;
            const rel = relative(root, full).split(sep).join('/');
            out.set(rel, createHash('sha256').update(readFileSync(full)).digest('hex'));
        }
    };
    rec(root);
    return out;
}

if (!existsSync(UPSTREAM)) {
    console.log(`[ds2-core-sync] upstream not present at ${UPSTREAM} - cannot compare, not asserting.`);
    process.exit(0);
}

const local = walk(LOCAL);
const upstream = walk(UPSTREAM);
const problems = [];

/**
 * An out-of-scope entry that upstream no longer has is a stale exemption, and a stale exemption is
 * a hole nobody is looking through. Checked in the same pass rather than trusted.
 */
for (const rel of OUT_OF_SCOPE) {
    if (!upstream.has(rel)) problems.push(`out-of-scope entry no longer exists upstream: ${rel}`);
}
/**
 * And one that appears LOCALLY is the fork this file exists to prevent: it would mean a second
 * copy of the transport inside `ds2-core`, beside the one in `ds2-transport`.
 */
for (const rel of MUST_NOT_EXIST_LOCALLY) {
    if (local.has(rel)) problems.push(`out-of-scope file is present locally (fork risk): ${rel}`);
}

for (const [rel, hash] of upstream) {
    if (OUT_OF_SCOPE.has(rel)) continue;
    if (!local.has(rel)) problems.push(`missing locally: ${rel}`);
    else if (local.get(rel) !== hash) problems.push(`differs: ${rel}`);
}
for (const rel of local.keys()) {
    if (OUT_OF_SCOPE.has(rel)) continue;
    if (!upstream.has(rel)) problems.push(`extra locally (not upstream): ${rel}`);
}

if (problems.length) {
    console.error('[ds2-core-sync] the vendored copy has drifted from upstream:\n  ' + problems.join('\n  '));
    console.error(`\nupstream: ${UPSTREAM}\nlocal:    ${LOCAL}`);
    console.error('\nFix the upstream first, then re-copy. Do not edit the vendored copy.');
    process.exit(1);
}

// Stated, never implied. An exemption nobody is reminded of is an exemption nobody re-examines.
console.log(`[ds2-core-sync] ${local.size} files identical to upstream; `
    + `${OUT_OF_SCOPE.size} transport files out of scope (owned by @tsunagi/ds2-transport).`);
