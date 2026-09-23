#!/usr/bin/env node
/**
 * Build the owners' preview, prove it is what it says, then deploy — or refuse and say why.
 *
 *   npm run deploy              every guard, the preview build, then `wrangler pages deploy`
 *   npm run deploy -- --check   every guard and the build, and stop before anything is uploaded
 *
 * ## What it refuses, in the order it checks
 *
 * 1. **wrangler.jsonc names a project other than the preview.** The D1 binding (`RUNS_DB`) only
 *    applies when the config's name is the project being deployed, and silently does not
 *    otherwise. So the name is read from there and never passed in: the two cannot disagree.
 * 2. **No gate.** `functions/_middleware.ts` missing, or `gate:verify` failing. Without it this
 *    origin serves the app, the API and BMW's factory calibrations to anyone.
 * 3. **check-public-tree fails.** What is served has to be buildable from the public repository.
 * 4. **The working tree has changes** (untracked CLAUDE.md and .claude/ aside). A build from
 *    uncommitted files serves source nobody can read. Nor may anything ignored sit under public/
 *    or functions/ except the expected local BMW and MS4X files (REQUIRED_LOCAL, under public/):
 *    `git status` does not show ignored files, but the build copies public/ into out/ whole, so a
 *    stray dump under public/data/ or a public/.env.local would otherwise ship without a word.
 * 5. **HEAD is not origin/main.** The preview serves only source that is public on
 *    github.com/mushitaro/e46m3smg2-mapping. With no remote yet it refuses and says the repository
 *    has to be pushed first.
 * 6. **The build is not the preview, or not this source.** It must say app-variant "preview"
 *    (`check-branding.mjs` has already read the manifest and icons back), carry no `sync-token`
 *    meta — that token is retired and must never ship again — and hold the local BMW and MS4X
 *    files the app needs (THIRD-PARTY-NOTICES.md). And `out/sw.js`'s SOURCE_ID must equal the
 *    source hash, which is the guard this script was first written for:
 *
 *    `npm run build && wrangler pages deploy out` looks like it cannot deploy a failed build, and
 *    in a shell it usually cannot. What it does not survive is a pipe: `npm run build | grep …`
 *    reports GREP's status, so a build that aborted on the `ds2-core` drift gate scrolled past as
 *    "no output" and the deploy went ahead with whatever `out/` happened to hold. Measured: the
 *    site was served a build two commits old while the console showed a successful deploy. So the
 *    check is not "did the build command succeed" but "do the bytes in `out/` belong to the source
 *    on disk right now" — a fact about the artifact, which no shell subtlety can fake.
 *
 * Then wrangler runs from the repository root — Pages takes `functions/` from the working
 * directory, not from the directory being uploaded — with `--branch main`, so every deployment
 * lands on the project's own hostname and no branch alias is ever minted to serve a frozen build.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = 'e46m3smg2-mapping-preview';
const PUBLIC_BRANCH = 'main';
const REPO = 'mushitaro/e46m3smg2-mapping';
const OUT = join(ROOT, 'out');
/** Fetched from the app's own origin and not in git: the STOCK reference and the definitions. */
const REQUIRED_LOCAL = [
    'factory/Y7843256.0DA', 'factory/Y7843257.0DA', 'factory/Y7843258.0DA', 'factory/Y7843259.0DA',
    'xdf/Siemens_SMG_II_510_24K.xdf', 'xdf/Siemens_SMG_II_510_512K.xdf',
];

const CHECK_ONLY = process.argv.includes('--check');

function refuse(why) {
    console.error(`\n[deploy] REFUSED: ${why}\n[deploy] Nothing was deployed.`);
    process.exit(1);
}
const ok = message => console.log(`  ok    ${message}`);
const git = (...args) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** A child process whose output is shown and whose exit code is the answer. */
const run = (command, args) =>
    spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

function capture(command, args) {
    const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
    if (result.status !== 0) refuse(result.stderr || `${command} failed`);
    return result.stdout.trim();
}

function htmlFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) htmlFiles(path, out);
        else if (name.endsWith('.html')) out.push(path);
    }
    return out;
}

// 1. the project
const config = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const name = /"name"\s*:\s*"([^"]+)"/.exec(config)?.[1];
if (name !== PROJECT) refuse(`wrangler.jsonc names "${name}", not the preview project "${PROJECT}".`);
ok(`project ${name}`);

// 2. the gate
if (!existsSync(join(ROOT, 'functions', '_middleware.ts'))) refuse('functions/_middleware.ts is missing: nothing would be gated.');
if (!run('npm', ['run', '--silent', 'gate:verify'])) refuse('gate:verify failed.');
ok('owner gate');

// 3. the public tree
if (!run('node', ['scripts/check-public-tree.mjs'])) refuse('check-public-tree failed.');

// 4. a clean tree
const dirty = git('status', '--porcelain')
    .split('\n')
    .filter(Boolean)
    .filter(line => !/^\?\? (CLAUDE\.md|\.claude\/)/.test(line));
if (dirty.length) refuse(`the working tree has changes; commit and push them first:\n  ${dirty.join('\n  ')}`);
const expectedLocal = new Set(REQUIRED_LOCAL.map(file => `public/${file}`));
const strays = git('ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', 'public', 'functions')
    .split('\0')
    .filter(Boolean)
    .filter(path => !expectedLocal.has(path));
if (strays.length) {
    refuse('ignored files under public/ or functions/ would be uploaded with the build; only the local '
        + `factory and XDF files may sit there. Move these out of the tree:\n  ${strays.join('\n  ')}`);
}
ok(`working tree clean; nothing ignored under public/ or functions/ but the ${expectedLocal.size} local files`);

// 5. the source is public
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== PUBLIC_BRANCH) refuse(`on branch "${branch}"; the preview is built from ${PUBLIC_BRANCH} only.`);
let remote = '';
try { remote = git('remote', 'get-url', 'origin'); } catch { /* no remote */ }
if (!remote) {
    refuse(`this repository has no remote yet. It must be pushed to GitHub (${REPO}, public) before anything `
        + 'built from it is served: the preview may serve only source that is public.');
}
try {
    git('fetch', '--quiet', 'origin', PUBLIC_BRANCH);
} catch (error) {
    refuse(`could not fetch origin/${PUBLIC_BRANCH} to compare (${String(error.stderr ?? error.message).trim()}). `
        + 'Not verified is not the same as public.');
}
const head = git('rev-parse', 'HEAD');
const published = git('rev-parse', `origin/${PUBLIC_BRANCH}`);
if (head !== published) {
    refuse(`HEAD ${head.slice(0, 7)} is not origin/${PUBLIC_BRANCH} (${published.slice(0, 7)}). Push first; only public source is served.`);
}
ok(`HEAD ${head.slice(0, 7)} is origin/${PUBLIC_BRANCH}`);

// 6. the build: the preview, of this source, with what it needs and without what it must not carry
if (!run('node', ['scripts/build.mjs', '--label', 'PREVIEW'])) refuse('the preview build failed.');
for (const file of REQUIRED_LOCAL) {
    if (!existsSync(join(OUT, file))) refuse(`out/${file} is missing. Supply it locally (README.md, THIRD-PARTY-NOTICES.md).`);
}
for (const file of htmlFiles(OUT)) {
    const html = readFileSync(file, 'utf8');
    if (/<meta[^>]+name="sync-token"/i.test(html)) refuse(`out/${relative(OUT, file)} carries a sync-token meta.`);
}
const index = readFileSync(join(OUT, 'index.html'), 'utf8');
const variant = /<meta\s+name="app-variant"\s+content="([^"]*)"/.exec(index)?.[1];
if (variant !== 'preview') refuse(`out/index.html says app-variant "${variant}", not "preview".`);

const swPath = join(OUT, 'sw.js');
if (!existsSync(swPath)) refuse('out/sw.js is missing — the build did not finish.');
const stamped = readFileSync(swPath, 'utf8').match(/SOURCE_ID = '([0-9a-f]{12})'/)?.[1];
const actual = capture('node', ['scripts/build-id.mjs']);
if (stamped !== actual) {
    refuse(`out/ was built from ${stamped ?? '(no stamp)'} but the source is ${actual}. The build output is stale.`);
}
ok(`out/ is source ${actual}, app-variant preview, ${REQUIRED_LOCAL.length} local files present, no sync-token`);

if (CHECK_ONLY) {
    console.log('\n[deploy] --check: every guard passed; nothing was uploaded.');
    process.exit(0);
}

// 7. deploy. Every argument is a plain token: on Windows this goes through a shell, which would
// split anything with a space in it.
if (!run('npx', ['wrangler', 'pages', 'deploy', 'out',
    '--project-name', PROJECT,
    '--branch', PUBLIC_BRANCH,
    '--commit-hash', head,
    '--commit-dirty=false'])) {
    refuse('wrangler pages deploy failed.');
}
console.log(`\n[deploy] Deployed source ${actual} (${head.slice(0, 7)}) to https://${PROJECT}.pages.dev`);
console.log('[deploy] Read it back before saying so: "/" 302s to m3 without a session; with one, the build id, '
    + 'app-variant preview and "P SMG2 MAP" in the manifest; /api/extractions 401 without a session.');
