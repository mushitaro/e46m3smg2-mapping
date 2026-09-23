/**
 * Sending a record of what happened, whether or not it worked.
 *
 * The extraction upload requires an image. That means the run most worth reporting — a read that
 * died at telegram 140 of 205, a probe that matched nothing, a connect the cable refused — had no
 * way off the phone at all. This is the other half.
 *
 * Nothing here is gated on success. `ok: false` rows are the point of the table.
 */

import { formatTrace, type TraceSnapshot } from '@tsunagi/ds2-transport';

import { gzipToBase64 } from './sync';
import { APP_VERSION } from './version';

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
        `build     v${APP_VERSION}`,
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

export async function uploadDiagnostic(input: DiagnosticInput): Promise<DiagnosticResult> {
    const id = newId();
    const traceText = input.trace && input.trace.entries.length ? formatTrace(input.trace) : null;

    const payload = {
        id,
        createdAt: Date.now(),
        kind: input.kind,
        ok: input.ok,
        error: input.error ?? null,
        route: input.route ?? null,
        practice: input.practice ?? false,
        appBuild: APP_VERSION,
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

    const body = JSON.stringify(payload);
    try {
        const response = await fetch('/api/diagnostics', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body,
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            return { ok: false, id, uploadedBytes: body.length, error: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
        }
        return { ok: true, id, uploadedBytes: body.length };
    } catch (error) {
        // The report about a link failure can itself fail on the same dead network. Say so, and say
        // the report is still on screen — an offline garage is exactly where this runs.
        return {
            ok: false,
            id,
            uploadedBytes: body.length,
            error: `${(error as Error).message} — the report is still here; copy it or retry when online.`,
        };
    }
}
