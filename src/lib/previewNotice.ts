'use client';

/**
 * The preview's first-run notice: what it sends, when, what for, who can see it and how it goes —
 * in front of the owner before any of it leaves the device.
 *
 * It used to be a page on m3 that every preview app's first visit was routed through before the app
 * issued its session. The operator decided on 2026-09-24 that the page was one more stop between the
 * owner and the tool, and that the confirmation belongs in the app's own first-run dialog, as TUNER's
 * disclaimer is. Here it is more than a stop on the way in: `syncAllowed()` is the question every
 * request path in this app asks first (`sync.ts`, `diagnostics.ts`, `useCloud`), so nothing is sent
 * until the owner has pressed 確認して続ける on this browser.
 *
 * **The words are the ones m3's page showed, verbatim** — tsunagi-m3 `lib/preview-notice-copy.ts`,
 * `NOTICE_COPY` and `NOTICE_APPS['smg2-preview']` — except the build's name, ワークス版 / WORKS since
 * the operator's decision of 2026-09-25 (a name, not a change to what is sent, so the key below
 * stayed `v1`); the button, which continues rather than opens; and the two lines on error records:
 * m3's said "each read and write" and "after each operation", and this build cannot write, so they
 * say what it does — a record after each read and whenever something fails (page.tsx). They
 * describe what `buildPayload` (sync.ts) and `diagnosticPayload` (diagnostics.ts) put in a request,
 * plus the user agent the API records beside each row; the privacy policy's `#preview` section on
 * m3 lists the same things at length. A change to either payload is a change to this text and to
 * that list, and a new key below.
 *
 * **Confirmed once per browser.** The acknowledgement is a localStorage key with its version in its
 * name: a change to what the preview sends is a new key (`v2`), and everyone is asked again. A key
 * that is missing — or storage that refuses to be read — means not confirmed, and the notice shows.
 * A key that cannot be WRITTEN still lets the owner through for this page's life; they are asked
 * again next time.
 *
 * **Production never sees it.** Everything here starts from `isPreviewBuild()`, so a build with no
 * `app-variant` draws no dialog, reads no key and — as before — sends nothing.
 */

import { useSyncExternalStore } from 'react';

import type { Lang } from './i18n';
import { isPreviewBuild } from './owner-sync';

/** Where the confirmation is kept. The version is in the name, so a new notice is a new key. */
export const NOTICE_KEY = 'preview-notice:v1';

/** The dialog's title: the app as the preview names itself — the gate's page, the branded manifest. */
export const NOTICE_TITLE = 'E46M3SMG2 /// MAPPING — WORKS';

export interface PreviewNoticeText {
    lead: string;
    sessionsTitle: string;
    /** What one saved session holds. */
    sessions: string;
    sessionsWhen: string;
    recordsTitle: string;
    /** What one error record holds. */
    records: string;
    recordsWhen: string;
    alsoSent: string;
    purposeTitle: string;
    purpose: string;
    whereTitle: string;
    where: string;
    deleteTitle: string;
    deleteBody: string;
    /** The link to the privacy policy's preview section. */
    policy: string;
    /** The one way on. */
    confirm: string;
}

export const PREVIEW_NOTICE: Record<Lang, PreviewNoticeText> = {
    ja: {
        lead: 'このワークス版は、保存した記録を別の端末でも開けるよう、また不具合を調べられるよう、次のものを運営者のサーバーへ送ります。',
        sessionsTitle: '保存したセッション',
        sessions: 'SMG II ECU から読み出したイメージ、ZB 番号、製造者データ、編集した値、読み出しの記録',
        sessionsWhen: 'SYNC を押して保存したときに送ります。',
        recordsTitle: 'エラーの記録',
        records: '読み出しごとの結果とエラーの文面、通信記録の抜粋、ZB 番号',
        recordsWhen: '読み出しのたびと、失敗したときに自動で送ります。通信できないときは端末に残し、次に送ります。',
        alsoSent: 'どちらにも、アプリの版とブラウザの種類が付きます。',
        purposeTitle: '使いみち',
        purpose: 'ご本人が別の端末で記録を開くため、そして不具合を調べてツールを直すためだけに使います。',
        whereTitle: '保存先と、見られる人',
        where: 'Cloudflare のデータベース（アジア太平洋地域）に、アカウントごとに分けて保存します。見られるのは、ご本人と運営者だけです。',
        deleteTitle: '削除',
        deleteBody:
            '保存したセッションとエラーの記録は、アプリの中でいつでも削除できます。まとめて削除したいときは、Discord からご連絡ください。',
        policy: '詳しくはプライバシーポリシー',
        confirm: '確認して続ける',
    },
    en: {
        lead: 'So that what you save opens on your other devices, and so that faults can be investigated, this WORKS build sends the following to our server.',
        sessionsTitle: 'Sessions you save',
        sessions: 'the image read from the SMG II ECU, the ZB number, the manufacturer data, your edits and the read log',
        sessionsWhen: 'Sent when you press SYNC to save one.',
        recordsTitle: 'Error records',
        records: 'the outcome and any error text of each read, an excerpt of the communication, and the ZB number',
        recordsWhen: 'Sent automatically after each read, and whenever something fails. Without a connection they wait on the device and go next time.',
        alsoSent: 'Both carry the app version and the browser type.',
        purposeTitle: 'What it is for',
        purpose: 'Only for opening your records on your other devices, and for finding and fixing faults in the tool.',
        whereTitle: 'Where it is kept, and who can see it',
        where: 'In a Cloudflare database (Asia-Pacific), kept separately per account. Only you and the operator can see it.',
        deleteTitle: 'Deleting it',
        deleteBody: 'You can delete saved sessions and error records in the app at any time. To have everything deleted at once, contact us on Discord.',
        policy: 'Privacy policy, in full',
        confirm: 'Confirm and continue',
    },
};

/** Confirmed on this page although storage would not keep it. */
let confirmedHere = false;
const listeners = new Set<() => void>();

/** Whether the owner has confirmed the notice on this browser. Storage that cannot be read is "no". */
export function noticeConfirmed(): boolean {
    if (confirmedHere) return true;
    try {
        return localStorage.getItem(NOTICE_KEY) !== null;
    } catch {
        return false;
    }
}

/** 確認して続ける. Kept when storage allows; either way it holds until the page goes. */
export function confirmNotice(): void {
    confirmedHere = true;
    try {
        localStorage.setItem(NOTICE_KEY, new Date().toISOString());
    } catch {
        // Private mode, or a full quota: confirmed for this page, asked again on the next.
    }
    listeners.forEach(listener => listener());
}

/** The notice stands in front of the app: a preview build, not yet confirmed on this browser. */
export function noticeRequired(): boolean {
    return isPreviewBuild() && !noticeConfirmed();
}

/**
 * Whether this page may make SYNC's requests at all — a session, a record, the outbox, the lists,
 * the gate's status. A preview build whose owner has confirmed the notice; nothing else.
 */
export function syncAllowed(): boolean {
    return isPreviewBuild() && noticeConfirmed();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // Confirmed in another tab of this browser: this tab's dialog goes too, rather than asking twice.
    const onStorage = (event: StorageEvent) => {
        if (event.key === NOTICE_KEY || event.key === null) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

/**
 * Whether the notice is up.
 *
 * `useSyncExternalStore` for the reason `usePreviewBuild` uses it: the prerender cannot know, and
 * says `false`, so the export carries no dialog; the first client render reads the page and the
 * storage and puts it up.
 */
export function usePreviewNoticeOpen(): boolean {
    return useSyncExternalStore(subscribe, noticeRequired, () => false);
}
