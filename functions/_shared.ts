/// <reference types="@cloudflare/workers-types" />

/**
 * Shared bits for the SYNC API.
 *
 * **Who a row belongs to.** Every handler takes the owner from `context.data.owner`, which only
 * the gate in `_middleware.ts` sets — after m3 has confirmed the browser's session and its
 * `owner_preview` right. Nothing the client sends can name an owner. A request that reaches a
 * handler without one is refused with 401, so a deployment whose middleware somehow did not run
 * serves nobody's rows rather than everybody's.
 *
 * There used to be a shared bearer token here, embedded in the static page, and an "open when the
 * secret is unset" branch for local development. Both are gone: the token was readable by anyone
 * who opened the page and it opened every row to them, and the open branch is the kind of default
 * that ships by accident. Local development goes through the gate too (`GATE_DEV_ACCOUNT` in
 * `.dev.vars`, honoured only on localhost).
 *
 * No CORS headers: the API answers its own origin only, and the gate refuses a write whose
 * `Origin` is not this site.
 */

import { json } from './_owner-gate/owner';

export { json, ownerOf, rowBytes, MAX_ROW_BYTES, unauthorized, tooLarge, conflict } from './_owner-gate/owner';

export interface Env {
    RUNS_DB: D1Database;
}

/**
 * Ceiling on a request body, checked before parsing.
 *
 * The row limit (`MAX_ROW_BYTES`, 1.9 MB) is what actually decides; this only stops a body that
 * could not possibly fit from being parsed at all. A full 512 KiB image gzips and base64s to well
 * under a megabyte.
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The body as JSON, or the response that says why not. */
export async function readJson<T>(request: Request): Promise<{ body: T; error?: undefined } | { error: Response }> {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
        return { error: json({ error: 'too_large', bytes: raw.length, limit: MAX_BODY_BYTES }, 413) };
    }
    try {
        return { body: JSON.parse(raw) as T };
    } catch {
        return { error: json({ error: 'body is not JSON' }, 400) };
    }
}

/** A list size from `?limit=`, clamped to something one response can carry. */
export function limitOf(url: URL, fallback = 50): number {
    const n = Number(url.searchParams.get('limit') ?? fallback);
    return Number.isFinite(n) ? Math.min(200, Math.max(1, Math.floor(n))) : fallback;
}

/** Ids this API issues or accepts: UUIDs, hex digests. Anything else is not a row of ours. */
export function isRowId(id: unknown): id is string {
    return typeof id === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(id);
}
