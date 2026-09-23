#!/usr/bin/env node
/**
 * Build, then prove the built output is the source in hand, then deploy.
 *
 * ## Why this exists
 *
 * `npm run build && wrangler pages deploy out` looks like it cannot deploy a failed build, and in a
 * shell it usually cannot. What it does not survive is a pipe: `npm run build | grep …` reports
 * GREP's status, so a build that aborted on the `ds2-core` drift gate scrolled past as "no output"
 * and the deploy went ahead with whatever `out/` happened to hold. Measured: the site was served a
 * build two commits old while the console showed a successful deploy.
 *
 * So the check is not "did the build command succeed". It is **"do the bytes in `out/` belong to
 * the source on disk right now"** — which is a fact about the artifact, and no shell subtlety can
 * fake it.
 *
 * ## How
 *
 * `build-id.mjs` hashes the source tree; `gen-sw.mjs` stamps that same value into `out/sw.js` as
 * `SOURCE_ID`. If they disagree, `out/` was produced by different source and MUST NOT ship.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = 'smg2-drivelogic';
/** Pinned, so a deploy can never mint a branch alias that then serves a frozen build forever. */
const BRANCH = 'main';

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        console.error(`\n[deploy] ${command} ${args.join(' ')} exited ${result.status} — nothing was deployed.`);
        process.exit(result.status ?? 1);
    }
}

function capture(command, args) {
    const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
    if (result.status !== 0) {
        console.error(result.stderr || `${command} failed`);
        process.exit(result.status ?? 1);
    }
    return result.stdout.trim();
}

run('node', ['scripts/build.mjs']);

// The gate. Not "the build said OK" — what the artifact actually is.
const swPath = join(ROOT, 'out', 'sw.js');
if (!existsSync(swPath)) {
    console.error('[deploy] out/sw.js is missing — the build did not finish. Nothing was deployed.');
    process.exit(1);
}
const stamped = readFileSync(swPath, 'utf8').match(/SOURCE_ID = '([0-9a-f]{12})'/)?.[1];
const actual = capture('node', ['scripts/build-id.mjs']);
if (stamped !== actual) {
    console.error(`[deploy] out/ was built from ${stamped ?? '(no stamp)'} but the source is ${actual}.`);
    console.error('[deploy] The build output is stale. Nothing was deployed.');
    process.exit(1);
}
console.log(`[deploy] out/ matches source ${actual}`);

run('npx', ['wrangler', 'pages', 'deploy', 'out', '--project-name', PROJECT, '--branch', BRANCH]);
