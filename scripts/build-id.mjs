#!/usr/bin/env node
/**
 * The build id the PAGE reports, printed for the build to inline.
 *
 * Two ids exist in this app and they answer different questions:
 *
 * - **`gen-sw.mjs`** hashes `out/` AFTER the build. It names the bytes the service worker
 *   precached, which is exactly what a cache should be keyed on — an unchanged build keeps its
 *   cache and nobody re-downloads the app on a phone tether.
 * - **this one** hashes the SOURCE, BEFORE the build, so it can be inlined into the bundle. It
 *   names the code that is running.
 *
 * The page must show the second. Showing the worker's id looked equivalent and is not: the worker
 * is fetched and activated asynchronously, so after a deploy a tab can be executing build N+1's
 * JavaScript while the worker still answers N — the stamp then contradicts the code beside it, and
 * the one question it exists to settle ("am I looking at the new build?") gets the wrong answer.
 * Measured on the deployed site: the screen read `f2df783a179b` while running `08414e53de0a`.
 *
 * Writing it into `out/` after the build was the other option and it is trap 5 in the release
 * skill: anything that rewrites bytes has to run before the step that hashes them.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Everything whose contents can change what the built page does. */
const ROOTS = ['src', 'packages', 'public/xdf', 'next.config.ts', 'package.json'];
const SKIP = /(^|[\\/])(node_modules|\.next|dist|__pycache__)([\\/]|$)|\.test\.tsx?$/;

function walk(path, out = []) {
    let stat;
    try {
        stat = statSync(path);
    } catch {
        return out; // an optional root that this checkout does not have
    }
    if (SKIP.test(path)) return out;
    if (stat.isDirectory()) {
        for (const name of readdirSync(path).sort()) walk(join(path, name), out);
        return out;
    }
    out.push(path);
    return out;
}

const hash = createHash('sha256');
for (const root of ROOTS) {
    for (const file of walk(join(ROOT, root))) {
        hash.update(relative(ROOT, file).split(sep).join('/'));
        hash.update(readFileSync(file));
    }
}

// stdout only: the build script captures this, so anything else printed here would end up in the
// environment variable.
process.stdout.write(hash.digest('hex').slice(0, 12));
