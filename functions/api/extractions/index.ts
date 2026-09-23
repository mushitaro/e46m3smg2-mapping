/// <reference types="@cloudflare/workers-types" />

/**
 * POST an extraction (SYNC), or GET the owner's list.
 *
 * An extraction is the owner's cloud copy of a session: the image as it came off the car, how it
 * was read, and the edits made to it since. It belongs to the account the gate resolved for the
 * request, and every statement below says so with `owner = ?`.
 *
 * The list deliberately does NOT include the image. Everything needed to decide which rows matter
 * — identity, size, hash, how the read went, the stored checksum — is a column, so browsing costs
 * one small response and downloading the bytes is something you opt into per row.
 */

import {
    conflict, json, limitOf, MAX_ROW_BYTES, ownerOf, readJson, rowBytes, tooLarge, unauthorized,
    isRowId, type Env,
} from '../../_shared';

interface UploadBody {
    id?: string;
    createdAt?: number;
    label?: string | null;
    transport?: string;
    practice?: boolean;
    appBuild?: string | null;
    variant?: string;
    byteLength?: number;
    sha256?: string;
    segment?: number | null;
    baseAddress?: number | null;
    zbNumber?: string | null;
    manufacturerData?: string | null;
    checksumStored?: number | null;
    chunkSize?: number | null;
    exchanges?: number | null;
    retries?: number | null;
    elapsedMs?: number | null;
    verifiedReread?: boolean | null;
    imageGzB64?: string;
    editsJson?: string | null;
    logText?: string | null;
}

/** Fields without which a row would be a mystery rather than a record. */
const REQUIRED: (keyof UploadBody)[] = ['id', 'transport', 'variant', 'byteLength', 'sha256', 'imageGzB64'];

/** What a second save of the same session may change. How it was read stays as first recorded. */
const ON_SAVE_AGAIN = `
                synced_at = excluded.synced_at,
                label = COALESCE(excluded.label, extractions.label),
                app_build = excluded.app_build,
                user_agent = excluded.user_agent,
                zb_number = COALESCE(excluded.zb_number, extractions.zb_number),
                manufacturer_data = COALESCE(excluded.manufacturer_data, extractions.manufacturer_data),
                edits_json = excluded.edits_json,
                log_text = COALESCE(excluded.log_text, extractions.log_text)`;

export const onRequestPost: PagesFunction<Env> = async ({ request, env, data }) => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();

    const parsed = await readJson<UploadBody>(request);
    if (parsed.error) return parsed.error;
    const body = parsed.body;

    const missing = REQUIRED.filter(key => body[key] === undefined || body[key] === null);
    if (missing.length) return json({ error: 'missing fields', missing }, 400);
    if (!isRowId(body.id)) return json({ error: 'bad id' }, 400);
    if (!/^[0-9a-f]{64}$/.test(body.sha256!)) return json({ error: 'sha256 is not a SHA-256' }, 400);

    const now = Date.now();
    const values = [
        body.id, owner.id, body.createdAt ?? now, now, body.label ?? null,
        body.transport, body.practice ? 1 : 0, body.appBuild ?? null,
        request.headers.get('user-agent') ?? null,
        body.variant, body.byteLength, body.sha256,
        body.segment ?? null, body.baseAddress ?? null,
        body.zbNumber ?? null, body.manufacturerData ?? null,
        body.checksumStored ?? null,
        body.chunkSize ?? null, body.exchanges ?? null, body.retries ?? null, body.elapsedMs ?? null,
        body.verifiedReread === null || body.verifiedReread === undefined ? null : (body.verifiedReread ? 1 : 0),
        body.imageGzB64, body.editsJson ?? null, body.logText ?? null,
    ];

    /**
     * D1 refuses a row over 2 MB, and says so only as a 500 — which would arrive after the phone
     * has spent the upload, at the end of a read that took eighteen minutes. Checked here so the
     * answer is "too large" in words. A full 512 KiB image lands well inside this: even an
     * incompressible one is ~683 KB once base64'd.
     */
    const bytes = rowBytes(values);
    if (bytes > MAX_ROW_BYTES) return tooLarge(bytes);

    let result: D1Result<{ id: string }>;
    try {
        result = await env.RUNS_DB.prepare(
            `INSERT INTO extractions (
                id, owner, created_at, synced_at, label, transport, practice, app_build, user_agent,
                variant, byte_length, sha256, segment, base_address, zb_number, manufacturer_data,
                checksum_stored, chunk_size, exchanges, retries, elapsed_ms, verified_reread,
                image_gz_b64, edits_json, log_text
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)
             -- The same id again is this owner saving the same session again (new edits, a longer
             -- log). It is only ever merged into a row that is already theirs AND holds the same
             -- bytes. An id that belongs to anyone else changes nothing, and that becomes 409.
             ON CONFLICT(id) DO UPDATE SET ${ON_SAVE_AGAIN}
              WHERE extractions.owner = excluded.owner AND extractions.sha256 = excluded.sha256
             -- The same image under a new id — the car read again on a second phone, or a session
             -- restored from the cloud and saved again — is still one calibration for this owner.
             -- The row keeps its id, and the response says which id that is.
             ON CONFLICT(owner, sha256) DO UPDATE SET ${ON_SAVE_AGAIN}
             RETURNING id`,
        ).bind(...values).run<{ id: string }>();
    } catch (error) {
        console.error('extraction insert failed:', error instanceof Error ? error.message : typeof error);
        return json({ error: 'insert failed' }, 500);
    }

    const id = result.results?.[0]?.id;
    if (!result.meta.changes || !id) return conflict();
    return json({ ok: true, id, syncedAt: now }, 201);
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env, data }) => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();

    const url = new URL(request.url);
    // Practice rows are excluded unless asked for. They are invented bytes, and a list that mixes
    // them with real dumps makes the reader do the filtering every single time.
    const includePractice = url.searchParams.get('practice') === '1';

    const result = await env.RUNS_DB.prepare(
        `SELECT id, created_at, synced_at, label, transport, practice, app_build, variant,
                byte_length, sha256, segment, base_address, zb_number, manufacturer_data,
                checksum_stored, chunk_size, exchanges, retries, elapsed_ms, verified_reread,
                length(image_gz_b64) AS image_b64_length,
                edits_json IS NOT NULL AS has_edits
           FROM extractions
          WHERE owner = ?1 AND (?2 = 1 OR practice = 0)
          ORDER BY created_at DESC
          LIMIT ?3`,
    ).bind(owner.id, includePractice ? 1 : 0, limitOf(url)).all();

    return json({ extractions: result.results });
};
