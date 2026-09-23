#!/usr/bin/env node
/**
 * Reads an export back, and fails when it would not pass for what it claims to be.
 *
 *   node scripts/check-branding.mjs <out-dir> <LABEL>    a branded build (PREVIEW)
 *   node scripts/check-branding.mjs <out-dir> --production
 *
 * brand-preview.mjs WRITES the branding; this reads what landed, from the bytes, the way a phone
 * will. Separate on purpose: the loop that rewrites can be wrong in ways it cannot see — a path it
 * did not know about, a file it skipped — and only a reading of the result catches those. Every
 * failure below ships quietly otherwise:
 *
 *   - a manifest icon on the wrong set: a white icon beside a black one for one install;
 *   - a maskable entry pointing at an `any` file: the full-size mark cropped by the launcher's
 *     circle (tsunagi-m-release §4.1 — the reason the maskable files exist at all);
 *   - an icon the manifest or a page names that is not in the export: a blank tile;
 *   - a page with no, or two, `app-variant` tags: SYNC silently off, or the stale tag read first —
 *     and on production, any tag at all: a production build that would sync;
 *   - a `sync-token` meta: the shared upload token of the old store, which must never ship again;
 *   - a service worker older than the pages: something rewrote the output after gen-sw hashed it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const [OUT, LABEL_ARG] = process.argv.slice(2);
if (!OUT || !LABEL_ARG) {
    console.error('usage: node scripts/check-branding.mjs <out-dir> <LABEL | --production>');
    process.exit(1);
}
const production = LABEL_ARG === '--production';
const LABEL = production ? null : LABEL_ARG;

let failures = 0;
const fail = m => { failures++; console.log(`  FAIL  ${m}`); };
const ok = m => console.log(`  ok    ${m}`);

const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.webmanifest'), 'utf8'));
const short = manifest.short_name ?? '';
if (short.length > 12) fail(`short_name "${short}" is longer than 12 characters`);
if (production) {
    if (manifest.name?.includes(' — ')) fail(`name "${manifest.name}" carries an environment suffix`);
    else ok(`name ${manifest.name} / short_name ${short}`);
} else {
    if (!manifest.name?.endsWith(` — ${LABEL}`)) fail(`name "${manifest.name}" does not end in " — ${LABEL}"`);
    else ok(`name ${manifest.name}`);
    if (!short.startsWith(`${LABEL[0]} `)) fail(`short_name "${short}" does not start with "${LABEL[0]} "`);
    else ok(`short_name ${short}`);
    if (!manifest.description?.endsWith(` — ${LABEL} BUILD, not the production tool.`)) fail('description carries no build suffix');
}

/** The icon set a path belongs to must be the one this build claims. */
const rightSet = src => (production ? !/-dev-/.test(src) : /-dev-/.test(src));
const setName = production ? 'production' : 'dev';

const icons = manifest.icons ?? [];
const purposes = i => (i.purpose ?? 'any').split(/\s+/);
const anySrc = new Set(icons.filter(i => purposes(i).includes('any')).map(i => i.src));
const maskable = icons.filter(i => purposes(i).includes('maskable'));
if (!maskable.length) fail('no maskable icon');
for (const icon of icons) {
    if (!rightSet(icon.src)) fail(`manifest icon ${icon.src} is not from the ${setName} set`);
    if (!existsSync(join(OUT, icon.src))) fail(`manifest icon ${icon.src} is not in ${OUT}`);
}
for (const icon of maskable) {
    if (anySrc.has(icon.src) || !/-maskable-/.test(icon.src)) fail(`maskable entry ${icon.src} reuses an "any" file`);
}
if (icons.every(i => rightSet(i.src) && existsSync(join(OUT, i.src)))) {
    ok(`${icons.length} manifest icon(s), all ${setName}, all present; maskable entries use -maskable- files`);
}

function htmlFiles(dir) {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? htmlFiles(full) : extname(full) === '.html' ? [full] : [];
    });
}
const variant = LABEL?.toLowerCase();
let docs = 0;
let newestPage = 0;
for (const file of htmlFiles(OUT)) {
    const html = readFileSync(file, 'utf8');
    docs++;
    newestPage = Math.max(newestPage, statSync(file).mtimeMs);
    const variants = [...html.matchAll(/<meta name="app-variant" content="([^"]*)"/g)].map(m => m[1]);
    if (production ? variants.length !== 0 : variants.length !== 1 || variants[0] !== variant) {
        fail(`${file}: app-variant ${JSON.stringify(variants)}, want ${production ? 'none' : `["${variant}"]`}`);
    }
    if (html.includes('name="sync-token"')) fail(`${file}: carries a sync-token meta`);
    for (const [src] of html.matchAll(/\/icons\/[a-z0-9-]+\.png/g)) {
        if (!rightSet(src)) fail(`${file}: names ${src}, not from the ${setName} set`);
        else if (!existsSync(join(OUT, src))) fail(`${file}: names ${src}, which is not in ${OUT}`);
    }
    const title = /<meta name="apple-mobile-web-app-title" content="([^"]*)"/.exec(html)?.[1];
    if (title !== undefined && title !== short) fail(`${file}: apple-mobile-web-app-title "${title}", want "${short}"`);
}
if (!docs) fail(`no .html in ${OUT}`);
else if (!failures) {
    ok(`${docs} document(s): ${production ? 'no app-variant' : `one app-variant "${variant}"`}, ${setName} icons only, no sync-token`);
}

const sw = join(OUT, 'sw.js');
if (!existsSync(sw)) fail('out/sw.js is missing — gen-sw did not run');
else if (statSync(sw).mtimeMs < newestPage) fail('out/sw.js is older than a page — something rewrote the output after gen-sw');
else ok('sw.js was generated after every page');

const label = production ? 'production' : LABEL;
console.log(failures ? `\n${failures} failure(s) in the ${label} build.` : `\n${label} branding: ok`);
process.exit(failures ? 1 : 0);
