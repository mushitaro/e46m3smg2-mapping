'use client';

import React, { useState } from 'react';
import { FolderOpen, Trash2, Pencil, Check, X, FileInput } from 'lucide-react';
import { C } from '@/lib/chrome';
import { useLang } from '@/lib/i18n';
import { DataList, DataRow, EmptyState, Pill, TextButton, humanName } from '@/components/ui';
import type { SessionRecord } from '@/lib/sessionStore';

/**
 * Every image this tool has held, newest first.
 *
 * Modelled on the reference tuner's SESSIONS list, and it answers the same question: *which run
 * am I looking at, and what else do I still have?* The columns are chosen so a row can be
 * identified without opening it — the number an operator wrote down, where the bytes came from,
 * how long they are, and whether the checksum verified at the time.
 *
 * ## Three things this list is careful about
 *
 * **PRACTICE never loses its badge.** Invented bytes are labelled on the record itself, not
 * derived at render time, so a row cannot come back from storage looking like a dump.
 *
 * **Delete says what goes with it.** Deleting the last session that references a set of bytes
 * takes the bytes and their edits too, and the confirmation says so. An eighteen-minute read is
 * not something to remove behind a generic "Are you sure?".
 *
 * **The number is not the position.** `#3` stays `#3` after `#2` is deleted. Rows are sorted by
 * it descending, but nothing is renumbered — the label is a name, not an index.
 */

function originLabel(origin: SessionRecord['origin']): string {
    if (origin.kind === 'vehicle') return C.originVehicle;
    if (origin.kind === 'practice') return C.originPractice;
    return origin.fileName;
}

export function SessionList({
    sessions,
    activeSha256,
    onOpen,
    onDelete,
    onRename,
}: {
    sessions: readonly SessionRecord[];
    /** The image currently loaded, so the row that is open can say so. */
    activeSha256: string | null;
    onOpen: (session: SessionRecord) => void;
    onDelete: (session: SessionRecord) => void;
    onRename: (session: SessionRecord, label: string) => void;
}) {
    const { t } = useLang();
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState('');

    if (sessions.length === 0) {
        return <EmptyState Icon={FolderOpen} label={C.sessions} hint={t.noSessionsYet} />;
    }

    return (
        <DataList>
            {sessions.map(session => {
                const active = session.sha256 === activeSha256;
                const isEditing = editing === session.id;
                return (
                    <DataRow
                        key={session.id}
                        selected={active}
                        /*
                         * No `onSelect`. `DataRow` wraps a selectable row in a `<button>`, and
                         * this row carries three of its own — OPEN, RENAME, DELETE. A button
                         * inside a button is invalid HTML, and React said so at runtime: it
                         * reported a hydration error on every session row. So the row is a plain
                         * list item and opening it is an explicit control, which also stops a
                         * mis-aimed tap on RENAME from loading a different image.
                         */
                        code={`#${session.seq}`}
                        codeTone={active ? 'primary' : 'neutral'}
                        name={isEditing ? humanName('') : humanName(session.label)}
                        ident={session.sha256.slice(0, 12)}
                        leading={
                            session.practice ? <Pill tone="secondary">{C.vPracticeBytes}</Pill>
                                : session.checksumOk === null ? undefined
                                : <Pill tone={session.checksumOk ? 'ok' : 'caution'}>{session.checksumOk ? C.vCrcOk : C.vCrcBad}</Pill>
                        }
                        trailing={
                            <span className="flex shrink-0 items-center gap-3">
                                <span className="font-mono text-[10px] text-slate-600">
                                    {(session.byteLength / 1024).toFixed(0)} KiB
                                </span>
                                {!isEditing && !active && (
                                    <button
                                        onClick={() => onOpen(session)}
                                        aria-label={C.bOpen}
                                        title={C.bOpen}
                                        className="text-slate-600 transition hover:text-blue-400"
                                    >
                                        <FileInput className="size-3.5" />
                                    </button>
                                )}
                                {isEditing ? (
                                    <>
                                        <button
                                            onClick={() => { onRename(session, draft); setEditing(null); }}
                                            aria-label={C.bSave}
                                            className="text-slate-500 transition hover:text-blue-400"
                                        >
                                            <Check className="size-3.5" />
                                        </button>
                                        <button onClick={() => setEditing(null)} aria-label={C.close} className="text-slate-500 transition hover:text-slate-300">
                                            <X className="size-3.5" />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => { setEditing(session.id); setDraft(session.label); }}
                                            aria-label={C.bRename}
                                            className="text-slate-600 transition hover:text-slate-300"
                                        >
                                            <Pencil className="size-3.5" />
                                        </button>
                                        <button
                                            onClick={() => onDelete(session)}
                                            aria-label={C.bClear}
                                            className="text-slate-600 transition hover:text-red-400"
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </>
                                )}
                            </span>
                        }
                        detail={
                            isEditing ? (
                                <input
                                    autoFocus
                                    value={draft}
                                    onChange={e => setDraft(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') { onRename(session, draft); setEditing(null); }
                                        if (e.key === 'Escape') setEditing(null);
                                    }}
                                    className="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none"
                                />
                            ) : (
                                <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[10px] text-slate-600">
                                    <span>{originLabel(session.origin)}</span>
                                    {session.zb && <span>ZB {session.zb}</span>}
                                    <span>{new Date(session.createdAt).toLocaleString()}</span>
                                </span>
                            )
                        }
                    />
                );
            })}
        </DataList>
    );
}
