#!/usr/bin/env node
/**
 * Renames an exported build so a preview install cannot be mistaken for production.
 *
 *   node scripts/brand-preview.mjs <out-dir> <LABEL>
 *
 * The source is the PRODUCTION identity — `public/manifest.webmanifest` and `layout.tsx` name
 * E46M3SMG2 /// MAPPING with the M ICON production set, and carry no `app-variant`. This patches
 * the bytes one export produced, and nothing else, so the production build stays exactly what the
 * source says (tsunagi-m-release §4.2).
 *
 * ## What it changes
 *
 *     name          E46M3SMG2 /// MAPPING — <LABEL>          install prompt, splash, switcher
 *     short_name    <L> SMG2 MAP                             the home screen
 *     description   … — <LABEL> BUILD, not the production tool.
 *     icons         the M ICON dev set (white on black); maskable entries to the dev maskable files
 *     every .html   app-variant (removed, then inserted once), apple-mobile-web-app-title if
 *                   present, and every icon / apple-touch-icon link
 *     every .txt    the same icon paths — the RSC payload carries the head too, and a hydrating
 *                   page that read the production path back out of it would undo this
 *
 * `theme_color` and `background_color` stay: they are the app's ground, not the icon's. `<title>`
 * stays: it is the browser tab, where the URL already says which build this is.
 *
 * ## The label decides `app-variant`
 *
 * `preview` is the one value that turns SYNC on (`isPreviewBuild()` in `src/lib/owner-sync.ts`).
 * Production has no tag at all, and makes no SYNC request.
 *
 * ## Both arguments are required, neither has a default
 *
 * A default is the value one caller forgot to pass, and the symptom would be a build labelled as
 * something it is not.
 *
 * ## Why it runs BEFORE gen-sw.mjs
 *
 * gen-sw names the worker's cache from a hash of the built bytes. Patch after it and the hash
 * describes bytes that no longer exist: two deploys differing only in branding would share a cache
 * name, and the second would be served the first's assets from disk. `build.mjs` runs this between
 * `next build` and gen-sw, and `check-branding.mjs` reads the result back afterwards.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const [OUT, LABEL] = process.argv.slice(2);
if (!OUT || !LABEL) {
    console.error('usage: node scripts/brand-preview.mjs <out-dir> <LABEL>');
    process.exit(1);
}
if (LABEL.length > 12 || !/^[A-Z][A-Z0-9 ]*$/.test(LABEL)) {
    console.error(`[brand-preview] LABEL "${LABEL}" must be upper-case and at most 12 characters.`);
    process.exit(1);
}
const VARIANT = LABEL.toLowerCase();

const fail = message => {
    console.error(`[brand-preview] ${message}`);
    process.exit(1);
};

/**
 * The dev twin of a production icon, by the names tsunagi-m3's `m-icons.mjs` writes:
 * `mapping-192.png` → `mapping-dev-192.png`, `mapping-maskable-512.png` → `mapping-dev-maskable-512.png`.
 */
function devIcon(src) {
    const m = /^(\/icons\/[a-z0-9-]+?)(-maskable)?-(\d+)\.png$/.exec(src);
    if (!m || m[1].endsWith('-dev')) return null;
    return `${m[1]}-dev${m[2] ?? ''}-${m[3]}.png`;
}

// ── The manifest ──────────────────────────────────────────────────────────────────────────────
const manifestPath = join(OUT, 'manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.name.includes(' — ')) {
    // A second pass would stack a second suffix. `out/` must be a fresh export here.
    fail(`${manifestPath} is already branded ("${manifest.name}"). Rebuild before branding.`);
}
/** The production short name is the product's; the environment letter goes in front of it. */
const shortName = `${LABEL[0]} ${manifest.short_name}`;
if (shortName.length > 12) {
    // Past this Android truncates, and a label that truncates may collide with another build's.
    fail(`short_name "${shortName}" is ${shortName.length} characters; Android keeps ~12.`);
}
manifest.name = `${manifest.name} — ${LABEL}`;
manifest.short_name = shortName;
manifest.description = `${manifest.description} — ${LABEL} BUILD, not the production tool.`;

/** Every production path this rewrite moves, and where to. */
const moved = new Map();
for (const icon of manifest.icons ?? []) {
    const dev = devIcon(icon.src);
    if (!dev) fail(`manifest icon ${icon.src} has no dev twin by name.`);
    moved.set(icon.src, dev);
    icon.src = dev;
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// ── Every exported document ───────────────────────────────────────────────────────────────────
function files(dir, exts) {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? files(full, exts)
            : exts.includes(extname(full)) ? [full] : [];
    });
}

// The head's own icon links (favicon, apple-touch-icon) are whatever layout.tsx named; found here
// rather than listed, so a new one cannot be left on the production file.
const ICON_PATH = /\/icons\/[a-z0-9-]+\.png/g;
const documents = files(OUT, ['.html']);
for (const file of documents) {
    for (const [src] of readFileSync(file, 'utf8').matchAll(ICON_PATH)) {
        if (moved.has(src)) continue;
        const dev = devIcon(src);
        if (dev) moved.set(src, dev);
    }
}
for (const [src, dev] of moved) {
    if (!existsSync(join(OUT, dev))) fail(`${dev} (for ${src}) is not in ${OUT}. Is public/icons complete?`);
}

const swapIcons = text => text.replace(ICON_PATH, src => moved.get(src) ?? src);

let patched = 0;
for (const file of documents) {
    const before = readFileSync(file, 'utf8');
    const after = swapIcons(before)
        .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/g, `$1${shortName}$2`)
        // Stripped before it is written: `out/` is not guaranteed to be a fresh export, and an
        // insert-only stamp leaves two tags with the stale one first, where every reader looks.
        .replace(/<meta name="app-variant" content="[^"]*"\s*\/?>/g, '')
        .replace(/<\/head>/, `<meta name="app-variant" content="${VARIANT}"/></head>`);
    if (after !== before) { writeFileSync(file, after); patched++; }
}
let payloads = 0;
for (const file of files(OUT, ['.txt'])) {
    const before = readFileSync(file, 'utf8');
    const after = swapIcons(before);
    if (after !== before) { writeFileSync(file, after); payloads++; }
}

console.log(`[brand-preview] ${OUT}: "${manifest.name}" / ${shortName} / variant ${VARIANT}, `
    + `${moved.size} icon(s) to the dev set, manifest + ${patched} document(s) + ${payloads} payload(s)`);
