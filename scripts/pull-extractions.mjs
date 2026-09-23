#!/usr/bin/env node
/**
 * Pull extractions out of D1 and onto disk.
 *
 * This is the actual sharing mechanism. The phone uploads; this brings the rows down as real files
 * so they can be opened, diffed, checksum-fitted and disassembled with ordinary tools — no browser,
 * no dashboard, no copy-paste of a hex dump.
 *
 * It shells out to `wrangler d1 execute --json` rather than talking to the HTTP API, for two
 * reasons: it works whether or not the app has been deployed, and it needs no token beyond the
 * wrangler login that is already there. The HTTP API shows each owner only their own rows; this
 * is the operator's view of the table, so every row is printed with the account it belongs to.
 *
 *   node scripts/pull-extractions.mjs                   # real extractions, newest 50
 *   node scripts/pull-extractions.mjs --practice        # include simulated ones
 *   node scripts/pull-extractions.mjs --limit 5
 *   node scripts/pull-extractions.mjs --list            # metadata only, download nothing
 *   node scripts/pull-extractions.mjs --sha <sha256>    # one image (a prefix will do), every owner's copy
 *   node scripts/pull-extractions.mjs --owner <uuid>    # one account's rows
 *   node scripts/pull-extractions.mjs --id <id>         # one row
 *   node scripts/pull-extractions.mjs --local           # the `wrangler pages dev` database
 *
 * An image is found by its SHA-256, not by its id. The id used to be the hash; since rows became
 * per-owner (`migrations/0003_owner.sql`) it is an opaque session key, and the same stock
 * calibration read by two owners is two rows with one hash.
 *
 * Output lands in `data/extractions/`, which is gitignored: these are dumps of somebody's ECU.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'data', 'extractions');
const DB = 'smg2-tuner-runs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const value = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
};

const includePractice = flag('--practice');
const listOnly = flag('--list');
const onlyId = value('--id', null);
const onlySha = value('--sha', null)?.toLowerCase() ?? null;
const onlyOwner = value('--owner', null);
const limit = Number(value('--limit', '50'));
/** The local miniflare database that `npm run preview` writes to. Remote is the default because
 *  that is where a phone's uploads land; local exists so this script can be exercised without
 *  putting test rows in the real table. */
const local = flag('--local');

/** Columns worth seeing without pulling an image down. Kept in one place so --list and the
 *  download path cannot disagree about what a row is. */
const META_COLUMNS = [
    'id', 'owner', 'created_at', 'synced_at', 'label', 'transport', 'practice', 'app_build',
    'variant', 'byte_length', 'sha256', 'segment', 'base_address', 'zb_number',
    'manufacturer_data', 'checksum_stored', 'chunk_size', 'exchanges', 'retries',
    'elapsed_ms', 'verified_reread',
].join(', ');

/**
 * wrangler's own entry script, run under this Node.
 *
 * Not `npx`, and not a shell. Node 20 stopped letting `execFile` launch a `.cmd` directly (the
 * Windows argument-injection fix), so `npx.cmd` fails outright here; going through a shell instead
 * would put this SQL — which contains quotes and commas — through Windows command-line quoting,
 * which is a worse problem than the one it solves.
 */
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function d1(sql) {
    // --json keeps the output parseable; wrangler prints a banner to stderr, which is left alone.
    const stdout = execFileSync(
        process.execPath,
        [WRANGLER, 'd1', 'execute', DB, local ? '--local' : '--remote', '--json', '--command', sql],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    // wrangler emits `[ { results: [...], success: true, meta: {...} } ]`.
    const start = stdout.indexOf('[');
    if (start === -1) throw new Error(`unexpected wrangler output:\n${stdout.slice(0, 400)}`);
    const parsed = JSON.parse(stdout.slice(start));
    return parsed[0]?.results ?? [];
}

const quote = text => `'${text.replace(/'/g, "''")}'`;
if (onlySha !== null && !/^[0-9a-f]{4,64}$/.test(onlySha)) {
    console.error('--sha takes hex digits (a prefix of the SHA-256 will do).');
    process.exit(1);
}
const clauses = [];
if (onlyId) clauses.push(`id = ${quote(onlyId)}`);
if (onlySha) clauses.push(`sha256 LIKE '${onlySha}%'`);
if (onlyOwner) clauses.push(`owner = ${quote(onlyOwner)}`);
// Asking for one row or one image is asking for it whatever it is; practice is hidden otherwise.
if (!includePractice && !onlyId && !onlySha) clauses.push('practice = 0');
const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

const rows = d1(`SELECT ${META_COLUMNS} FROM extractions ${where} ORDER BY created_at DESC LIMIT ${limit}`);

if (rows.length === 0) {
    console.log('No extractions yet.' + (includePractice ? '' : ' (Practice rows are hidden; pass --practice.)'));
    process.exit(0);
}

const when = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
/** An account, short enough to scan a list by. The full id is in index.json. */
const account = id => (id ? String(id).slice(0, 8) : '--------');
const hex = n => (n === null || n === undefined ? '--' : `0x${n.toString(16).toUpperCase().padStart(4, '0')}`);

console.log(`\n${rows.length} extraction(s):\n`);
for (const r of rows) {
    const verified = r.verified_reread === 1 ? 'verified' : r.verified_reread === 0 ? 'MISMATCH' : 'unverified';
    console.log(
        `  ${r.sha256.slice(0, 12)}  ${account(r.owner)}  ${when(r.created_at)}  ${r.variant.padEnd(12)} ` +
        `${String(r.byte_length).padStart(7)}B  zb=${r.zb_number ?? '--'}  ` +
        `cksum=${hex(r.checksum_stored)}  ${verified}` +
        `${r.practice ? '  [PRACTICE]' : ''}${r.label ? `  "${r.label}"` : ''}`);
    if (r.exchanges !== null) {
        console.log(
            `                seg=${hex(r.segment)} base=0x${(r.base_address ?? 0).toString(16)} ` +
            `chunk=${r.chunk_size} ${r.exchanges} exchanges, ${r.retries} retries, ` +
            `${((r.elapsed_ms ?? 0) / 1000).toFixed(1)}s via ${r.transport}`);
    }
}
console.log('');

if (listOnly) process.exit(0);

mkdirSync(OUT_DIR, { recursive: true });
const index = [];
/**
 * Files are named by the image, as they always were (tests and notes refer to `<hash12>.bin`). The
 * same image under two owners is the one case that would overwrite, so only then is the account
 * added to the name.
 */
const owners = new Map();
for (const r of rows) owners.set(r.sha256, (owners.get(r.sha256) ?? new Set()).add(r.owner));

for (const meta of rows) {
    const [full] = d1(`SELECT image_gz_b64, edits_json, log_text FROM extractions WHERE id = ${quote(meta.id)}`);
    if (!full?.image_gz_b64) {
        console.warn(`  ! ${meta.sha256.slice(0, 12)} has no image`);
        continue;
    }
    const image = gunzipSync(Buffer.from(full.image_gz_b64, 'base64'));

    // The hash is re-checked here rather than trusted. A row whose bytes do not hash to its sha256
    // went wrong somewhere between the ECU and this disk, and finding that out now is far cheaper
    // than finding it out after an afternoon of analysis.
    const actual = createHash('sha256').update(image).digest('hex');
    const trustworthy = actual === meta.sha256;

    const shared = owners.get(meta.sha256).size > 1;
    const stem = `${meta.practice ? 'PRACTICE_' : ''}${meta.sha256.slice(0, 12)}${shared ? `-${account(meta.owner)}` : ''}`;
    const binPath = join(OUT_DIR, `${stem}.bin`);
    writeFileSync(binPath, image);
    if (full.log_text) writeFileSync(join(OUT_DIR, `${stem}.log.txt`), full.log_text, 'utf8');
    if (full.edits_json) writeFileSync(join(OUT_DIR, `${stem}.edits.json`), full.edits_json, 'utf8');

    index.push({ ...meta, file: `${stem}.bin`, hashVerified: trustworthy });
    console.log(
        `  -> ${stem}.bin  ${image.length} bytes  ` +
        (trustworthy ? 'hash OK' : `HASH MISMATCH (got ${actual.slice(0, 12)})`));
}

writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
console.log(`\nWrote ${index.length} file(s) to data/extractions/ (plus index.json)\n`);
