#!/usr/bin/env node
/**
 * The build, in one place, with the build id computed at the only moment it can be.
 *
 * The order is the whole point:
 *
 *   1. verify the vendored ds2-core has not drifted
 *   2. hash the SOURCE  -> `NEXT_PUBLIC_BUILD_ID`, inlined by the bundler
 *   3. `next build`
 *   4. `gen-sw.mjs`     -> hashes `out/`, names the service worker's cache
 *
 * Step 2 has to precede step 3 because the bundler inlines `process.env.NEXT_PUBLIC_*` while it
 * builds; step 4 has to follow it because it hashes what was built. Writing the page's stamp into
 * `out/` after step 4 would rewrite bytes the cache name already described, which is the failure
 * where a redeploy differing only in that stamp keeps serving the old assets from disk.
 *
 * A shell one-liner cannot do this portably — `VAR=$(cmd) next build` is POSIX and this project is
 * built on Windows — and splitting it across npm scripts would put the ordering in a place nothing
 * checks. So it lives here, and `package.json` calls this.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function run(command, args, env) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: { ...process.env, ...env },
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(command, args) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        console.error(result.stderr || `${command} failed`);
        process.exit(result.status ?? 1);
    }
    return result.stdout.trim();
}

run('node', ['scripts/verify-ds2-core-sync.mjs']);

const buildId = capture('node', ['scripts/build-id.mjs']);
// The guard the release skill asks for: a stamp that silently comes back empty is the same bug as
// no stamp at all, and it only shows up on someone else's screen.
if (!/^[0-9a-f]{12}$/.test(buildId)) {
    console.error(`[build] build-id.mjs returned ${JSON.stringify(buildId)}, expected 12 hex chars`);
    process.exit(1);
}
console.log(`[build] source build id ${buildId}`);

run('npx', ['next', 'build'], { NEXT_PUBLIC_BUILD_ID: buildId });
run('node', ['scripts/gen-sw.mjs'], { NEXT_PUBLIC_BUILD_ID: buildId });
