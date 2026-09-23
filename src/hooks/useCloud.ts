'use client';

/**
 * The owner's side of SYNC, as state: whether the preview session is good, and what is saved.
 *
 * Only a preview build asks anything. With `enabled` false this hook makes no request at all —
 * production is local-only, and a status poll is still a request.
 *
 * `unknown` (offline, m3 down, anything unexpected) is not `expired`. The page offers SIGN IN only
 * on `expired`: sending an owner to m3 because the garage has no signal would turn "no network"
 * into an error page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
    deleteCloudDiagnostic, flushDiagnostics, listCloudDiagnostics, pendingDiagnostics, type CloudDiagnostic,
} from '@/lib/diagnostics';
import { gateStatus, type GateState } from '@/lib/owner-sync';
import { deleteCloudSession, listCloudSessions, type CloudSession } from '@/lib/sync';

export interface CloudState {
    readonly gate: GateState;
    /** The account the gate resolved, as m3 labels it (`#XXXX`). */
    readonly account: string | null;
    /** Null until read, and when it could not be read. */
    readonly sessions: readonly CloudSession[] | null;
    readonly diagnostics: readonly CloudDiagnostic[] | null;
    /** Records waiting in the outbox. */
    readonly pending: number;
    readonly loading: boolean;
}

export interface CloudApi extends CloudState {
    refresh(): Promise<void>;
    /** A request just came back 401: say so now, rather than at the next poll. */
    markExpired(): void;
    deleteSession(id: string): Promise<boolean>;
    deleteDiagnostic(id: string): Promise<boolean>;
}

export function useCloud(enabled: boolean): CloudApi {
    const [state, setState] = useState<CloudState>({
        gate: 'unknown', account: null, sessions: null, diagnostics: null, pending: 0, loading: false,
    });
    const running = useRef(false);

    const refresh = useCallback(async () => {
        if (!enabled || running.current) return;
        running.current = true;
        setState(s => ({ ...s, loading: true }));
        try {
            const status = await gateStatus();
            if (status.state !== 'active') {
                const pending = await pendingDiagnostics();
                setState(s => ({ ...s, gate: status.state, pending, loading: false }));
                return;
            }
            // A good session is the moment to send what waited for one.
            await flushDiagnostics();
            const [sessions, diagnostics, pending] = await Promise.all([
                listCloudSessions(), listCloudDiagnostics(), pendingDiagnostics(),
            ]);
            const expired = sessions.expired || diagnostics.expired;
            setState({
                gate: expired ? 'expired' : 'active',
                account: status.label,
                sessions: sessions.rows,
                diagnostics: diagnostics.rows,
                pending,
                loading: false,
            });
        } finally {
            running.current = false;
        }
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        void refresh();
        const onOnline = () => void refresh();
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [enabled, refresh]);

    const markExpired = useCallback(() => setState(s => ({ ...s, gate: 'expired' })), []);

    const deleteSession = useCallback(async (id: string) => {
        const r = await deleteCloudSession(id);
        if (r.expired) markExpired();
        if (r.ok) setState(s => ({ ...s, sessions: s.sessions?.filter(row => row.id !== id) ?? null }));
        return r.ok;
    }, [markExpired]);

    const deleteDiagnostic = useCallback(async (id: string) => {
        const r = await deleteCloudDiagnostic(id);
        if (r.expired) markExpired();
        if (r.ok) setState(s => ({ ...s, diagnostics: s.diagnostics?.filter(row => row.id !== id) ?? null }));
        return r.ok;
    }, [markExpired]);

    return { ...state, refresh, markExpired, deleteSession, deleteDiagnostic };
}
