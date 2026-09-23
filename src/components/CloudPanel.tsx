'use client';

import React from 'react';
import { CloudOff, FileInput, LogIn, RefreshCw, Trash2 } from 'lucide-react';

import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import type { CloudApi } from '@/hooks/useCloud';
import type { CloudSession } from '@/lib/sync';
import type { CloudDiagnostic } from '@/lib/diagnostics';
import { DataList, DataRow, EmptyState, MicroLabel, Pill, Section, TextButton, humanName } from '@/components/ui';

/**
 * CLOUD — what this owner has saved, beside SESSIONS, which is what this device holds.
 *
 * Preview only; the page does not mount it otherwise. It answers three questions and offers the
 * two acts that follow from them:
 *
 * - **Where does SYNC save to?** The note names the account (`保存先 アカウント #XXXX`), so an owner
 *   who signed in on a borrowed phone can see whose account is receiving the car's data.
 * - **What is saved?** Sessions (the image, how it was read, the edits), and the diagnostic
 *   records the app files on its own after every read and every failure.
 * - **Can I still reach it?** When the preview session has lapsed, it says so and offers SIGN IN —
 *   but only when the page says it is safe to leave (nothing connected, nothing running), because
 *   signing in is a same-tab trip through m3.
 *
 * RESTORE puts a saved session back into SESSIONS on this device, edits included. DELETE removes
 * the cloud copy only; the copy on this device, if there is one, is untouched — the confirmation
 * says so. Both confirm in the reader's language (`tsunagi-m-ux` §13), which is why the page passes
 * the prompts in rather than this component calling `confirm` itself.
 */
export function CloudPanel({
    cloud,
    busyId,
    canRestore,
    reauth,
    onRestore,
    onDeleteSession,
    onDeleteDiagnostic,
}: {
    cloud: CloudApi;
    /** The row being restored or deleted, so its controls read as occupied. */
    busyId: string | null;
    /** False while the link is busy: restoring replaces the image in hand. */
    canRestore: boolean;
    /** Present only when signing in again is both needed and safe. */
    reauth: (() => void) | null;
    onRestore: (row: CloudSession) => void;
    onDeleteSession: (row: CloudSession) => void;
    onDeleteDiagnostic: (row: CloudDiagnostic) => void;
}) {
    const { t } = useLang();
    const expired = cloud.gate === 'expired';

    return (
        <Section
            title={C.cloud}
            count={cloud.sessions?.length}
            note={expired ? t.cloudExpired : t.cloudNote(cloud.account)}
            actions={
                <>
                    {reauth && (
                        <TextButton Icon={LogIn} onClick={reauth}>{C.bSignIn}</TextButton>
                    )}
                    <TextButton
                        Icon={RefreshCw}
                        tone="neutral"
                        disabled={cloud.loading}
                        onClick={() => void cloud.refresh()}
                    >
                        {C.bRefresh}
                    </TextButton>
                </>
            }
        >
            {cloud.sessions === null ? (
                <EmptyState Icon={CloudOff} label={C.cloud} hint={expired ? undefined : t.cloudUnavailable} />
            ) : cloud.sessions.length === 0 ? (
                <EmptyState Icon={CloudOff} label={C.cloud} hint={t.cloudEmpty} />
            ) : (
                <DataList>
                    {cloud.sessions.map(row => (
                        <DataRow
                            key={row.id}
                            name={humanName(row.label ?? '')}
                            ident={row.sha256.slice(0, 12)}
                            leading={row.practice ? <Pill tone="secondary">{C.vPracticeBytes}</Pill> : undefined}
                            trailing={
                                <span className="flex shrink-0 items-center gap-3">
                                    <span className="font-mono text-[10px] text-slate-600">
                                        {(row.byte_length / 1024).toFixed(0)} KiB
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onRestore(row)}
                                        disabled={!canRestore || busyId !== null}
                                        aria-label={C.bRestore}
                                        title={C.bRestore}
                                        className="text-slate-600 transition hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <FileInput className="size-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteSession(row)}
                                        disabled={busyId !== null}
                                        aria-label={C.bDelete}
                                        title={C.bDelete}
                                        className="text-slate-600 transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <Trash2 className="size-3.5" />
                                    </button>
                                </span>
                            }
                            detail={
                                <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[10px] text-slate-600">
                                    <span>{row.variant}</span>
                                    {row.zb_number && <span>ZB {row.zb_number}</span>}
                                    {row.has_edits ? <span className="text-blue-400">{C.fEdits}</span> : null}
                                    <span>{new Date(row.created_at).toLocaleString()}</span>
                                    {busyId === row.id && <span className="text-slate-400">…</span>}
                                </span>
                            }
                        />
                    ))}
                </DataList>
            )}

            <div className="mt-4 flex min-h-[20px] items-baseline justify-between gap-3">
                <MicroLabel>{C.cloudRecords}</MicroLabel>
                {cloud.diagnostics && (
                    <span className="font-mono text-[11px] tabular-nums text-slate-600">{cloud.diagnostics.length}</span>
                )}
            </div>
            <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-slate-500">{t.cloudRecordsNote(cloud.pending)}</p>
            {cloud.diagnostics && cloud.diagnostics.length > 0 && (
                <DataList className="mt-1.5">
                    {cloud.diagnostics.map(row => (
                        <DataRow
                            key={row.id}
                            name={humanName(row.error ?? '')}
                            ident={row.id.slice(0, 8)}
                            code={row.kind.toUpperCase()}
                            codeTone={row.ok ? 'neutral' : 'danger'}
                            leading={
                                row.ok
                                    ? <Pill tone="ok">{C.vOk}</Pill>
                                    : <Pill tone="danger">{C.vFailed}</Pill>
                            }
                            trailing={
                                <button
                                    type="button"
                                    onClick={() => onDeleteDiagnostic(row)}
                                    disabled={busyId !== null}
                                    aria-label={C.bDelete}
                                    title={C.bDelete}
                                    className="shrink-0 text-slate-600 transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            }
                            detail={
                                <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[10px] text-slate-600">
                                    {row.route && <span>{row.route}</span>}
                                    {row.practice ? <span>{C.originPractice}</span> : null}
                                    {row.exchanges !== null && <span>{row.bytes_done ?? 0} B · {row.exchanges} ex</span>}
                                    <span>{new Date(row.created_at).toLocaleString()}</span>
                                </span>
                            }
                        />
                    ))}
                </DataList>
            )}
        </Section>
    );
}
