/**
 * Sending a record of what happened, whether or not it worked.
 *
 * The extraction upload requires an image. That means the run most worth reporting — a read that
 * died at telegram 140 of 205, a probe that matched nothing, a connect the cable refused — had no
 * way off the phone at all. This is the other half.
 *
 * Nothing here is gated on success. `ok: false` rows are the point of the table.
 *
 * **Two ways out, and the automatic one is the one that matters.** SEND is still there, and
 * reports what it did. But a record is worth something only if it is caught at the moment of the
 * failure, it is small, and nobody presses a button in a garage with the engine off — so the page
 * files one on its own after every read and every failure (`recordDiagnostic`). That path is
 * best-effort and silent: it never throws, never blocks the operation it describes, and when it
 * cannot send — offline, the preview session lapsed, the server down — the record waits in an
 * IndexedDB outbox (the newest twenty) and goes after the next send that succeeds.
 *
 * **Preview only.** Production makes no request here at all; its records stay on screen, where
 * COPY still works.
 *
 * **Not before the notice.** On the preview, nothing goes until the owner has confirmed the
 * first-run notice (`syncAllowed()`, `previewNotice.ts`). A record filed before that goes where a
 * record that could not be sent already goes — the outbox, stamped with the account this device
 * last confirmed — and nothing is flushed, so it leaves with the first flush after the owner
 * confirms, or not at all if no account was ever confirmed here.
 */

import { formatTrace, type TraceSnapshot } from '@tsunagi/ds2-transport';

import { api, isPreviewBuild, outbox } from './owner-sync';
import { syncAllowed } from './previewNotice';
import { APP_BUILD, gzipToBase64 } from './sync';
import { APP_VERSION, BUILD_ID } from './version';

export type DiagnosticKind = 'connect' | 'probe' | 'read' | 'manual';

export interface DiagnosticInput {
    readonly kind: DiagnosticKind;
    readonly ok: boolean;
    readonly error?: string | null;
    readonly route?: string | null;
    readonly practice?: boolean;
    readonly zbNumber?: string | null;
    readonly segment?: number | null;
    readonly baseAddress?: number | null;
    /** The extraction this belongs to, when one was produced. Joins the two tables. */
    readonly extractionSha?: string | null;
    readonly chunkSize?: number | null;
    readonly exchanges?: number | null;
    readonly retries?: number | null;
    readonly bytesDone?: number | null;
    readonly elapsedMs?: number | null;
    readonly logLines: readonly string[];
    readonly trace: TraceSnapshot | null;
}

export interface DiagnosticResult {
    readonly ok: boolean;
    readonly id: string;
    readonly uploadedBytes: number;
    /** It did not go now, and waits in the outbox for the next send that does. */
    readonly queued?: boolean;
    readonly error?: string;
}

/**
 * An id that is unique per run without needing a clock the browser and the server agree on.
 *
 * Not the trace hash: two identical failures a minute apart are two findings, and collapsing them
 * would hide that the fault is reproducible.
 */
function newId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The report as it would be filed, for the UI to show before sending it. */
export function renderDiagnostic(input: DiagnosticInput): string {
    const header = [
        `kind      ${input.kind}`,
        `outcome   ${input.ok ? 'ok' : `FAILED — ${input.error ?? 'no message'}`}`,
        `route     ${input.route ?? 'unknown'}${input.practice ? ' (practice)' : ''}`,
        `build     v${APP_VERSION} · ${BUILD_ID}`,
        input.exchanges !== null && input.exchanges !== undefined
            ? `progress  ${input.bytesDone ?? 0} bytes, ${input.exchanges} exchanges, ` +
              `${input.retries ?? 0} retries, ${((input.elapsedMs ?? 0) / 1000).toFixed(1)}s`
            : null,
        input.trace
            ? `wire      ${input.trace.txBytes} B out, ${input.trace.rxBytes} B in` +
              (input.trace.dropped ? `, ${input.trace.dropped} trace entries omitted` : '')
            : null,
    ].filter(Boolean).join('\n');

    const log = input.logLines.length ? `\n\n--- session log ---\n${input.logLines.join('\n')}` : '';
    const trace = input.trace && input.trace.entries.length
        ? `\n\n--- telegrams ---\n${formatTrace(input.trace)}`
        : '';
    return header + log + trace;
}

/** The record as the API takes it. The id is fixed here, so a record sent twice is one row. */
export async function diagnosticPayload(input: DiagnosticInput): Promise<DiagnosticPayload> {
    const traceText = input.trace && input.trace.entries.length ? formatTrace(input.trace) : null;
    return {
        id: newId(),
        createdAt: Date.now(),
        kind: input.kind,
        ok: input.ok,
        error: input.error ?? null,
        route: input.route ?? null,
        practice: input.practice ?? false,
        appBuild: APP_BUILD,
        zbNumber: input.zbNumber ?? null,
        segment: input.segment ?? null,
        baseAddress: input.baseAddress ?? null,
        extractionSha: input.extractionSha ?? null,
        chunkSize: input.chunkSize ?? null,
        exchanges: input.exchanges ?? null,
        retries: input.retries ?? null,
        bytesDone: input.bytesDone ?? null,
        elapsedMs: input.elapsedMs ?? null,
        logText: input.logLines.length ? input.logLines.join('\n') : null,
        traceGzB64: traceText ? await gzipToBase64(new TextEncoder().encode(traceText)) : null,
        traceDropped: input.trace?.dropped ?? null,
        txBytes: input.trace?.txBytes ?? null,
        rxBytes: input.trace?.rxBytes ?? null,
    };
}

export interface DiagnosticPayload {
    readonly id: string;
    readonly createdAt: number;
    readonly kind: DiagnosticKind;
    readonly ok: boolean;
    readonly error: string | null;
    readonly route: string | null;
    readonly practice: boolean;
    readonly appBuild: string;
    readonly zbNumber: string | null;
    readonly segment: number | null;
    readonly baseAddress: number | null;
    readonly extractionSha: string | null;
    readonly chunkSize: number | null;
    readonly exchanges: number | null;
    readonly retries: number | null;
    readonly bytesDone: number | null;
    readonly elapsedMs: number | null;
    readonly logText: string | null;
    readonly traceGzB64: string | null;
    readonly traceDropped: number | null;
    readonly txBytes: number | null;
    readonly rxBytes: number | null;
}

/** Records that could not be sent yet. Separate from the session store: it is a queue, not data. */
const OUTBOX = outbox('smg2-outbox');

type Sent = 'sent' | 'retry' | 'drop';

/**
 * One attempt. `retry` is what an outbox is for: no network, a lapsed session (401), a server that
 * did not answer (5xx). `drop` is a record the server will never take (400, 409, 413) — keeping it
 * would block every record behind it.
 */
async function post(payload: DiagnosticPayload): Promise<{ sent: Sent; status: number }> {
    const r = await api('/api/diagnostics', { method: 'POST', body: payload });
    if (r.ok) return { sent: 'sent', status: r.status };
    if (r.status === 0 || r.status === 401 || r.status >= 500) return { sent: 'retry', status: r.status };
    return { sent: 'drop', status: r.status };
}

/**
 * Send whatever the outbox holds, oldest first. Called after every send that succeeds, and by
 * `useCloud` once the gate says the session is active — but never before the notice is confirmed:
 * until then the records wait, and not even the gate's status is asked.
 */
export async function flushDiagnostics(): Promise<number> {
    if (!syncAllowed()) return 0;
    return OUTBOX.flush(async record => (await post(record as DiagnosticPayload)).sent !== 'retry');
}

/**
 * File a record on its own — after a read, after a failure. Silent and best-effort: resolves
 * whatever happens, never throws, and keeps what it could not send for later.
 */
export async function recordDiagnostic(input: DiagnosticInput): Promise<void> {
    if (!isPreviewBuild()) return;
    try {
        const payload = await diagnosticPayload(input);
        // Not confirmed yet: kept, as a record that could not go is, and not sent.
        if (!syncAllowed()) {
            await OUTBOX.add(payload);
            return;
        }
        const { sent } = await post(payload);
        if (sent === 'retry') await OUTBOX.add(payload);
        else if (sent === 'sent') await flushDiagnostics();
    } catch {
        // A report about a failure must never become a second failure.
    }
}

/** SEND: the same record, sent now, with the outcome said out loud. */
export async function sendDiagnostic(input: DiagnosticInput): Promise<DiagnosticResult> {
    const payload = await diagnosticPayload(input);
    const uploadedBytes = JSON.stringify(payload).length;
    if (!isPreviewBuild()) return { ok: false, id: payload.id, uploadedBytes: 0, error: 'this build does not sync' };
    if (!syncAllowed()) {
        // SEND is behind the notice, so this is the guard rather than a path anyone takes: kept, as
        // a record that could not go is, and not sent before the owner has confirmed.
        await OUTBOX.add(payload);
        return { ok: false, queued: true, id: payload.id, uploadedBytes, error: 'notice not confirmed' };
    }
    const { sent, status } = await post(payload);
    if (sent === 'sent') {
        void flushDiagnostics();
        return { ok: true, id: payload.id, uploadedBytes };
    }
    if (sent === 'retry') {
        // The report about a link failure can itself fail on the same dead network. It is kept and
        // goes with the next send that works — and it is still on screen, where COPY works now.
        await OUTBOX.add(payload);
        return { ok: false, queued: true, id: payload.id, uploadedBytes, error: status ? `HTTP ${status}` : 'offline' };
    }
    return { ok: false, id: payload.id, uploadedBytes, error: `HTTP ${status}` };
}

/** The owner's records, newest first — what the CLOUD list shows. No log or trace. */
export interface CloudDiagnostic {
    readonly id: string;
    readonly created_at: number;
    readonly kind: string;
    readonly ok: number;
    readonly error: string | null;
    readonly route: string | null;
    readonly practice: number;
    readonly zb_number: string | null;
    readonly bytes_done: number | null;
    readonly exchanges: number | null;
}

export async function listCloudDiagnostics(): Promise<{ rows: readonly CloudDiagnostic[] | null; expired: boolean }> {
    if (!syncAllowed()) return { rows: null, expired: false };
    const r = await api<{ diagnostics?: CloudDiagnostic[] }>('/api/diagnostics?practice=1&limit=100');
    return { rows: r.ok ? r.data?.diagnostics ?? [] : null, expired: r.expired };
}

export async function deleteCloudDiagnostic(id: string): Promise<{ ok: boolean; expired: boolean }> {
    if (!syncAllowed()) return { ok: false, expired: false };
    const r = await api(`/api/diagnostics/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { ok: r.ok, expired: r.expired };
}

/** How many records are waiting to be sent. */
export function pendingDiagnostics(): Promise<number> {
    return isPreviewBuild() ? OUTBOX.count() : Promise.resolve(0);
}
