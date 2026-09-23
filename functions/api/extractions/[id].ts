/// <reference types="@cloudflare/workers-types" />

/**
 * One of the owner's extractions: GET it, image included, or DELETE it.
 *
 * Separate from the listing on purpose: the image is the only large thing here, so downloading it
 * is an explicit act rather than a side effect of browsing. Someone else's id is answered exactly
 * like an id that does not exist — 404 — so the answer says nothing about other owners' rows.
 */

import { json, ownerOf, unauthorized, type Env } from '../../_shared';

export const onRequestGet: PagesFunction<Env, 'id'> = async ({ env, params, data }) => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();

    const row = await env.RUNS_DB.prepare(
        `SELECT id, created_at, synced_at, label, transport, practice, app_build, variant,
                byte_length, sha256, segment, base_address, zb_number, manufacturer_data,
                checksum_stored, chunk_size, exchanges, retries, elapsed_ms, verified_reread,
                image_gz_b64, edits_json, log_text
           FROM extractions WHERE id = ?1 AND owner = ?2`,
    ).bind(String(params.id), owner.id).first();

    if (!row) return json({ error: 'not found' }, 404);
    return json({ extraction: row });
};

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ env, params, data }) => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();

    const result = await env.RUNS_DB.prepare(`DELETE FROM extractions WHERE id = ?1 AND owner = ?2`)
        .bind(String(params.id), owner.id).run();
    if (!result.meta.changes) return json({ error: 'not found' }, 404);
    return json({ ok: true });
};
