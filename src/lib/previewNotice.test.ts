/**
 * The first-run notice, and what it holds back.
 *
 * The operator's decision of 2026-09-24 moved "what this preview sends, and why" from a page on m3
 * into the app. What makes it more than a dialog is that nothing is sent before the owner confirms
 * it — and that production, which sends nothing at all, shows nothing new. Both are pinned here
 * against the real send paths: this app's sync code and the canonical outbox behind it, with
 * `fetch` and IndexedDB replaced by recorders.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiagnosticInput } from './diagnostics';
import type { SyncPayload } from './sync';

// Every test imports the modules afresh: the confirmation is module state, and so is the outbox.
beforeEach(() => {
    vi.resetModules();
});
afterEach(() => {
    vi.unstubAllGlobals();
});

/** A page whose `app-variant` says `preview` — or, for production, a page that says nothing. */
function page(variant: 'preview' | null) {
    vi.stubGlobal('document', {
        querySelector: (selector: string) =>
            variant !== null && selector === 'meta[name="app-variant"]'
                ? { getAttribute: (name: string) => (name === 'content' ? variant : null) }
                : null,
    });
}

/** localStorage in memory, every read and write recorded. */
function storage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial));
    const store = {
        getItem: vi.fn((key: string) => items.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => void items.set(key, String(value))),
        removeItem: vi.fn((key: string) => void items.delete(key)),
        clear: () => items.clear(),
        key: (index: number) => [...items.keys()][index] ?? null,
        get length() {
            return items.size;
        },
    };
    vi.stubGlobal('localStorage', store);
    return store;
}

/** localStorage as a locked-down browser can leave it: every call throws. */
function refusingStorage() {
    const refuse = () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 });
}

/** Every request the page makes, as `METHOD path`. The gate answers as an active session for #TEST. */
function network() {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
        requests.push(`${init?.method ?? 'GET'} ${input}`);
        const body = input === '/_gate/status' ? { state: 'active', account_label: '#TEST' } : { id: 'row' };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    return requests;
}

/** Just enough IndexedDB for the canonical outbox: a database per name, one autoincrement store. */
function indexedDb() {
    const databases = new Map<string, Map<number, Record<string, unknown>>>();
    let nextKey = 1;
    const request = <T,>(run: () => T) => {
        const req: { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
        queueMicrotask(() => {
            try {
                req.result = run();
                req.onsuccess?.();
            } catch (error) {
                req.error = error;
                req.onerror?.();
            }
        });
        return req;
    };
    vi.stubGlobal('indexedDB', {
        open(name: string) {
            const req: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void } = {};
            queueMicrotask(() => {
                const fresh = !databases.has(name);
                if (fresh) databases.set(name, new Map());
                const rows = databases.get(name)!;
                const store = {
                    add: (value: Record<string, unknown>) => request(() => {
                        const key = nextKey++;
                        rows.set(key, { ...value, key });
                        return key;
                    }),
                    getAll: () => request(() => [...rows.values()]),
                    getAllKeys: () => request(() => [...rows.keys()]),
                    delete: (key: number) => request(() => void rows.delete(key)),
                    count: () => request(() => rows.size),
                };
                req.result = { createObjectStore: () => store, transaction: () => ({ objectStore: () => store }), close: () => {} };
                if (fresh) req.onupgradeneeded?.();
                req.onsuccess?.();
            });
            return req;
        },
    });
    return { rows: (name: string) => [...(databases.get(name)?.values() ?? [])] };
}

const SESSION: SyncPayload = {
    id: 'session-1', createdAt: 0, label: null, transport: 'practice', practice: true, appBuild: 'test',
    variant: 'partial-24k', byteLength: 0, sha256: '0'.repeat(64), segment: null, baseAddress: null,
    zbNumber: null, manufacturerData: null, checksumStored: null, chunkSize: null, exchanges: null,
    retries: null, elapsedMs: null, verifiedReread: null, imageGzB64: '', editsJson: null, logText: null,
};

const FAILED_READ: DiagnosticInput = {
    kind: 'read', ok: false, error: 'no answer at telegram 140', logLines: ['12:00:00.000  read'], trace: null,
};

describe('the preview notice', () => {
    it('stands in front of the preview until confirmed, and the confirmation is kept under a versioned key', async () => {
        page('preview');
        const kept = storage();
        const notice = await import('./previewNotice');
        expect(notice.NOTICE_KEY).toBe('preview-notice:v1');
        expect(notice.noticeRequired()).toBe(true);
        expect(notice.syncAllowed()).toBe(false);

        notice.confirmNotice();
        expect(kept.setItem).toHaveBeenCalledWith('preview-notice:v1', expect.any(String));
        expect(notice.noticeRequired()).toBe(false);
        expect(notice.syncAllowed()).toBe(true);
    });

    it('is not asked again while the key is there — and is, for any other version of it', async () => {
        page('preview');
        storage({ 'preview-notice:v1': '2026-09-24T00:00:00.000Z' });
        expect((await import('./previewNotice')).noticeRequired()).toBe(false);

        vi.resetModules();
        storage({ 'preview-notice:v0': '2026-09-01T00:00:00.000Z' });
        expect((await import('./previewNotice')).noticeRequired()).toBe(true);
    });

    it('shows when storage cannot be read, and a confirmation still lets the owner through for the page', async () => {
        page('preview');
        refusingStorage();
        const notice = await import('./previewNotice');
        expect(notice.noticeRequired()).toBe(true);
        expect(() => notice.confirmNotice()).not.toThrow();
        expect(notice.noticeRequired()).toBe(false);
        expect(notice.syncAllowed()).toBe(true);
    });
});

describe('production', () => {
    it('shows nothing, allows nothing, and does not even read the key', async () => {
        page(null);
        const kept = storage();
        const notice = await import('./previewNotice');
        expect(notice.noticeRequired()).toBe(false);
        expect(notice.syncAllowed()).toBe(false);
        expect(kept.getItem).not.toHaveBeenCalled();
    });

    it('shows nothing when storage refuses, either', async () => {
        page(null);
        refusingStorage();
        expect((await import('./previewNotice')).noticeRequired()).toBe(false);
    });

    it('is the only condition the page puts the dialog up on', () => {
        // The dialog is drawn by one hook whose prerender answer is "no" and whose page answer is
        // noticeRequired() — false on production, tested above. Pinned at the source, the way the
        // chrome tests pin the copy rules, because a second mount or a different condition is
        // exactly the change that would put it on production without failing anything else.
        const notice = readFileSync(join(__dirname, 'previewNotice.ts'), 'utf8');
        expect(notice).toContain('useSyncExternalStore(subscribe, noticeRequired, () => false)');

        const source = readFileSync(join(__dirname, '..', 'app', 'page.tsx'), 'utf8');
        expect(source).toContain('const noticeOpen = usePreviewNoticeOpen();');
        expect(source.match(/<PreviewNoticeDialog\b/g)).toHaveLength(1);
        expect(source).toContain('{noticeOpen && <PreviewNoticeDialog onConfirm={confirmNotice} />}');
        expect(source).toMatch(/<main inert=\{noticeOpen\}/);
        expect(source).toContain('useCloud(preview && !noticeOpen)');
    });
});

describe('nothing is sent before the owner confirms', () => {
    it('makes no request from SYNC, SEND, the automatic record, the outbox or the cloud lists', async () => {
        page('preview');
        storage({ 'owner-sync:account': '#TEST' });
        const requests = network();
        const idb = indexedDb();
        const sync = await import('./sync');
        const diagnostics = await import('./diagnostics');

        expect(await sync.saveExtraction(SESSION)).toMatchObject({ ok: false, notSent: true, uploadedBytes: 0 });
        await diagnostics.recordDiagnostic(FAILED_READ);
        expect(await diagnostics.sendDiagnostic(FAILED_READ)).toMatchObject({ ok: false, queued: true });
        expect(await diagnostics.flushDiagnostics()).toBe(0);
        expect((await sync.listCloudSessions()).rows).toBeNull();
        expect((await sync.fetchCloudSession('session-1')).row).toBeNull();
        expect((await sync.deleteCloudSession('session-1')).ok).toBe(false);
        expect((await diagnostics.listCloudDiagnostics()).rows).toBeNull();
        expect((await diagnostics.deleteCloudDiagnostic('record-1')).ok).toBe(false);

        expect(requests).toEqual([]);
        // The two records wait where a record that could not go already waits.
        expect(idb.rows('smg2-outbox')).toHaveLength(2);
    });

    it('once confirmed, SYNC goes, and the record that waited goes with the first flush', async () => {
        page('preview');
        storage({ 'owner-sync:account': '#TEST' });
        const requests = network();
        const idb = indexedDb();
        const notice = await import('./previewNotice');
        const sync = await import('./sync');
        const diagnostics = await import('./diagnostics');

        await diagnostics.recordDiagnostic(FAILED_READ);
        expect(requests).toEqual([]);

        notice.confirmNotice();
        expect((await sync.saveExtraction(SESSION)).ok).toBe(true);
        expect(await diagnostics.flushDiagnostics()).toBe(1);
        expect(requests).toEqual(['POST /api/extractions', 'GET /_gate/status', 'POST /api/diagnostics']);
        expect(idb.rows('smg2-outbox')).toHaveLength(0);
    });

    it('never sends a record filed before any account was confirmed on this device', async () => {
        // A fresh device: the gate has never answered here, so a record filed before the notice
        // carries no account, and the canonical outbox drops it rather than guess whose it is.
        page('preview');
        storage();
        const requests = network();
        const idb = indexedDb();
        const notice = await import('./previewNotice');
        const diagnostics = await import('./diagnostics');

        await diagnostics.recordDiagnostic(FAILED_READ);
        notice.confirmNotice();
        expect(await diagnostics.flushDiagnostics()).toBe(0);
        expect(requests).toEqual(['GET /_gate/status']);
        expect(idb.rows('smg2-outbox')).toHaveLength(0);
    });
});

describe('the dialog', () => {
    it('says all of it, with one way on and the policy in a new tab', async () => {
        const { PreviewNoticeDialog } = await import('@/components/PreviewNoticeDialog');
        const { NOTICE_TITLE, PREVIEW_NOTICE } = await import('./previewNotice');
        // Rendered as the prerender would, which is English (i18n's server snapshot).
        const html = renderToStaticMarkup(createElement(PreviewNoticeDialog, { onConfirm: () => {} }));

        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain(NOTICE_TITLE);
        for (const line of Object.values(PREVIEW_NOTICE.en)) expect(html).toContain(line);

        // The language, and the one way on. Nothing closes it.
        const buttons = html.match(/<button\b[^>]*>.*?<\/button>/g) ?? [];
        expect(buttons).toHaveLength(2);
        expect(buttons.filter(button => button.includes(PREVIEW_NOTICE.en.confirm))).toHaveLength(1);
        expect(html).toMatch(
            /<a href="https:\/\/m3\.tsunagi\.app\/en\/privacy-policy#preview" target="_blank" rel="noopener noreferrer"/);
    });

    it('speaks of reads only, because this build cannot write', async () => {
        // m3's copy, shared by all five apps, said records follow "each read and write". This build
        // has no write path, and the notice may not claim to send records of something the app
        // cannot do. The day a write path lands this fails, and the notice, the policy's #preview
        // list and the key's version change together.
        const { CAPABILITIES } = await import('./version');
        const { PREVIEW_NOTICE } = await import('./previewNotice');
        expect(CAPABILITIES.canWriteToEcu).toBe(false);
        expect(Object.values(PREVIEW_NOTICE.ja).join('\n')).not.toMatch(/書き込|書込/);
        expect(Object.values(PREVIEW_NOTICE.en).join('\n')).not.toMatch(/\bwrit/i);
    });
});
