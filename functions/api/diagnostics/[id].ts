/// <reference types="@cloudflare/workers-types" />

/**
 * One of the owner's diagnostics: GET it, log and trace included, or DELETE it. Separate from the
 * listing so pulling a trace is an explicit act rather than a side effect of browsing. Another
 * owner's id is answered as if it did not exist.
 */

import { json, ownerOf, unauthorized, type Env } from '../../_shared';

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ env, params, data }) => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();

    const row = await env.RUNS_DB.prepare(
        `SELECT id, created_at, synced_at, kind, ok, error, route, practice, app_build,
                zb_number, segment, base_address, extraction_sha,
                chunk_size, exchanges, retries, bytes_done, elapsed_ms,
                log_text, trace_gz_b64, trace_dropped, tx_bytes, rx_bytes
           FROM diagnostics WHERE id = ?1 AND owner = ?2`,
    ).bind(String(params.id), owner.id).first();
    if (!row) return json({ error: 'not found' }, 404);
    return json({ diagnostic: row });
};

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ env, params, data }) => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();

    const result = await env.RUNS_DB.prepare(`DELETE FROM diagnostics WHERE id = ?1 AND owner = ?2`)
        .bind(String(params.id), owner.id).run();
    if (!result.meta.changes) return json({ error: 'not found' }, 404);
    return json({ ok: true });
};
