#!/usr/bin/env node
/**
 * Pull diagnostic records — session logs and telegram traces — out of D1.
 *
 * The companion to `pull-extractions.mjs`. That one brings down images; this one brings down what
 * happened, including for the runs that produced no image. Failures are listed first because that
 * is what this table is read for. Like that one it is the operator's view: every owner's records,
 * each printed with the account it belongs to.
 *
 *   node scripts/pull-diagnostics.mjs                # newest 50, real runs
 *   node scripts/pull-diagnostics.mjs --failed       # only the runs that went wrong
 *   node scripts/pull-diagnostics.mjs --practice     # include simulated ones
 *   node scripts/pull-diagnostics.mjs --list         # metadata only
 *   node scripts/pull-diagnostics.mjs --id <id>
 *   node scripts/pull-diagnostics.mjs --sha <sha256> # the records of one image's reads (a prefix will do)
 *   node scripts/pull-diagnostics.mjs --owner <uuid> # one account's records
 *   node scripts/pull-diagnostics.mjs --local        # the `npm run preview` database
 *
 * Output lands in `data/diagnostics/`, which is gitignored along with the rest of `data/`.
 */

import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'data', 'diagnostics');
const DB = 'smg2-tuner-runs';
/** Node 20 refuses to execFile a `.cmd`, and a shell would mangle the SQL quoting. */
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const value = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
};

const failedOnly = flag('--failed');
const includePractice = flag('--practice');
const listOnly = flag('--list');
const local = flag('--local');
const onlyId = value('--id', null);
const onlySha = value('--sha', null)?.toLowerCase() ?? null;
const onlyOwner = value('--owner', null);
if (onlySha !== null && !/^[0-9a-f]{4,64}$/.test(onlySha)) {
    console.error('--sha takes hex digits (a prefix of the SHA-256 will do).');
    process.exit(1);
}
const quote = text => `'${text.replace(/'/g, "''")}'`;
const limit = Number(value('--limit', '50'));

const META = [
    'id', 'owner', 'created_at', 'kind', 'ok', 'error', 'route', 'practice', 'app_build',
    'zb_number', 'segment', 'base_address', 'extraction_sha',
    'chunk_size', 'exchanges', 'retries', 'bytes_done', 'elapsed_ms',
    'trace_dropped', 'tx_bytes', 'rx_bytes',
].join(', ');

function d1(sql) {
    const stdout = execFileSync(
        process.execPath,
        [WRANGLER, 'd1', 'execute', DB, local ? '--local' : '--remote', '--json', '--command', sql],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    const start = stdout.indexOf('[');
    if (start === -1) throw new Error(`unexpected wrangler output:\n${stdout.slice(0, 400)}`);
    return JSON.parse(stdout.slice(start))[0]?.results ?? [];
}

const clauses = [];
if (onlyId) clauses.push(`id = ${quote(onlyId)}`);
if (onlySha) clauses.push(`extraction_sha LIKE '${onlySha}%'`);
if (onlyOwner) clauses.push(`owner = ${quote(onlyOwner)}`);
if (failedOnly) clauses.push('ok = 0');
// Asking for one record or one image's reads is asking for them whatever they are.
if (!includePractice && !onlyId && !onlySha) clauses.push('practice = 0');
const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

// Failures first, then most recent: the ordering matches why the table is read.
const rows = d1(`SELECT ${META} FROM diagnostics ${where} ORDER BY ok ASC, created_at DESC LIMIT ${limit}`);

if (rows.length === 0) {
    console.log('No diagnostics yet.' + (includePractice ? '' : ' (Practice rows are hidden; pass --practice.)'));
    process.exit(0);
}

const when = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

console.log(`\n${rows.length} diagnostic(s):\n`);
for (const r of rows) {
    const outcome = r.ok ? 'ok    ' : 'FAILED';
    console.log(
        `  ${r.id.slice(0, 8)}  ${r.owner ? String(r.owner).slice(0, 8) : '--------'}  ${when(r.created_at)}  ${outcome}  ${String(r.kind).padEnd(7)} ` +
        `${(r.route ?? '--').padEnd(13)}${r.practice ? ' [PRACTICE]' : ''}`);
    if (!r.ok && r.error) console.log(`            ${String(r.error).slice(0, 150)}`);
    if (r.exchanges !== null) {
        console.log(
            `            ${r.bytes_done ?? 0} bytes, ${r.exchanges} exchanges, ${r.retries ?? 0} retries, ` +
            `${((r.elapsed_ms ?? 0) / 1000).toFixed(1)}s` +
            (r.tx_bytes !== null ? `  ·  wire ${r.tx_bytes}B out / ${r.rx_bytes}B in` : '') +
            (r.trace_dropped ? `  ·  ${r.trace_dropped} trace entries omitted` : ''));
    }
    if (r.extraction_sha) console.log(`            extraction ${String(r.extraction_sha).slice(0, 12)}`);
}
console.log('');

if (listOnly) process.exit(0);

mkdirSync(OUT_DIR, { recursive: true });
for (const meta of rows) {
    const [full] = d1(`SELECT log_text, trace_gz_b64 FROM diagnostics WHERE id = ${quote(meta.id)}`);
    const stem = `${meta.ok ? '' : 'FAILED_'}${meta.practice ? 'PRACTICE_' : ''}${meta.id.slice(0, 8)}`;

    const parts = [
        `id        ${meta.id}`,
        `owner     ${meta.owner ?? '--'}`,
        `at        ${when(meta.created_at)}`,
        `kind      ${meta.kind}`,
        `outcome   ${meta.ok ? 'ok' : `FAILED — ${meta.error ?? 'no message'}`}`,
        `route     ${meta.route ?? 'unknown'}${meta.practice ? ' (practice)' : ''}`,
        `build     ${meta.app_build ?? '--'}`,
    ];
    if (full?.log_text) parts.push('', '--- session log ---', full.log_text);
    if (full?.trace_gz_b64) {
        parts.push('', '--- telegrams ---',
            gunzipSync(Buffer.from(full.trace_gz_b64, 'base64')).toString('utf8'));
    }

    const path = join(OUT_DIR, `${stem}.txt`);
    writeFileSync(path, parts.join('\n') + '\n', 'utf8');
    console.log(`  -> ${stem}.txt`);
}
console.log(`\nWrote ${rows.length} file(s) to data/diagnostics/\n`);
