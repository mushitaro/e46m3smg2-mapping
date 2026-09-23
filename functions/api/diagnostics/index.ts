/// <reference types="@cloudflare/workers-types" />

/**
 * POST a diagnostic record, or GET the owner's list.
 *
 * Deliberately separate from `/api/extractions`: an extraction requires an image, and the run worth
 * reporting most is the one that never produced one. This endpoint accepts a record with no bytes
 * at all — a connect that was refused, a probe that matched nothing, a read that died at telegram
 * 140 — because "what happened" is the payload.
 *
 * Records arrive on their own, after every read and every failure, and the app sends again what
 * it could not send the first time — so the same id can arrive twice. A repeat from the same owner
 * is harmless; an id that belongs to another owner is refused with 409.
 */

import {
    conflict, json, limitOf, MAX_ROW_BYTES, ownerOf, readJson, rowBytes, tooLarge, unauthorized,
    isRowId, type Env,
} from '../../_shared';

interface DiagnosticBody {
    id?: string;
    createdAt?: number;
    kind?: string;
    ok?: boolean;
    error?: string | null;
    route?: string | null;
    practice?: boolean;
    appBuild?: string | null;
    zbNumber?: string | null;
    segment?: number | null;
    baseAddress?: number | null;
    extractionSha?: string | null;
    chunkSize?: number | null;
    exchanges?: number | null;
    retries?: number | null;
    bytesDone?: number | null;
    elapsedMs?: number | null;
    logText?: string | null;
    traceGzB64?: string | null;
    traceDropped?: number | null;
    txBytes?: number | null;
    rxBytes?: number | null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, data }) => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();

    const parsed = await readJson<DiagnosticBody>(request);
    if (parsed.error) return parsed.error;
    const body = parsed.body;
    // Only an id and a kind are required. Everything else is allowed to be absent, because a
    // report that cannot be filed for missing fields is a report that does not get filed.
    if (!isRowId(body.id) || !body.kind) return json({ error: 'id and kind are required' }, 400);

    const now = Date.now();
    const values = [
        body.id, owner.id, body.createdAt ?? now, now, body.kind, body.ok ? 1 : 0, body.error ?? null,
        body.route ?? null, body.practice ? 1 : 0, body.appBuild ?? null,
        request.headers.get('user-agent') ?? null,
        body.zbNumber ?? null, body.segment ?? null, body.baseAddress ?? null,
        body.extractionSha ?? null,
        body.chunkSize ?? null, body.exchanges ?? null, body.retries ?? null,
        body.bytesDone ?? null, body.elapsedMs ?? null,
        body.logText ?? null, body.traceGzB64 ?? null, body.traceDropped ?? null,
        body.txBytes ?? null, body.rxBytes ?? null,
    ];
    const bytes = rowBytes(values);
    if (bytes > MAX_ROW_BYTES) return tooLarge(bytes);

    let result: D1Result;
    try {
        result = await env.RUNS_DB.prepare(
            `INSERT INTO diagnostics (
                id, owner, created_at, synced_at, kind, ok, error, route, practice, app_build, user_agent,
                zb_number, segment, base_address, extraction_sha,
                chunk_size, exchanges, retries, bytes_done, elapsed_ms,
                log_text, trace_gz_b64, trace_dropped, tx_bytes, rx_bytes
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)
             ON CONFLICT(id) DO UPDATE SET synced_at = excluded.synced_at
              WHERE diagnostics.owner = excluded.owner`,
        ).bind(...values).run();
    } catch (error) {
        console.error('diagnostic insert failed:', error instanceof Error ? error.message : typeof error);
        return json({ error: 'insert failed' }, 500);
    }
    if (!result.meta.changes) return conflict();

    return json({ ok: true, id: body.id, syncedAt: now }, 201);
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env, data }) => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();

    const url = new URL(request.url);
    const failedOnly = url.searchParams.get('failed') === '1';
    const includePractice = url.searchParams.get('practice') === '1';

    const result = await env.RUNS_DB.prepare(
        `SELECT id, created_at, synced_at, kind, ok, error, route, practice, app_build,
                zb_number, segment, base_address, extraction_sha,
                chunk_size, exchanges, retries, bytes_done, elapsed_ms,
                trace_dropped, tx_bytes, rx_bytes,
                length(trace_gz_b64) AS trace_b64_length,
                log_text IS NOT NULL AS has_log
           FROM diagnostics
          WHERE owner = ?1
            AND (?2 = 0 OR ok = 0)
            AND (?3 = 1 OR practice = 0)
          ORDER BY created_at DESC
          LIMIT ?4`,
    ).bind(owner.id, failedOnly ? 1 : 0, includePractice ? 1 : 0, limitOf(url)).all();

    return json({ diagnostics: result.results });
};
