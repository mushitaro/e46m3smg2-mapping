/**
 * Where this app links out to, declared once (`tsunagi-m-chrome` §1): the header and the menu
 * sheet point at the same places, so the address lives here and not in two layouts.
 */

import type { Lang } from './i18n';

/**
 * The preview's section of the privacy policy on m3 — what SYNC sends, what it is for, how long it
 * is kept and how to delete it. The English policy is its own page, not a translation toggle.
 */
const PRIVACY_PREVIEW: Record<Lang, string> = {
    ja: 'https://m3.tsunagi.app/privacy-policy#preview',
    en: 'https://m3.tsunagi.app/en/privacy-policy#preview',
};

export function privacyUrl(lang: Lang): string {
    return PRIVACY_PREVIEW[lang];
}

/**
 * MESH — where the work continues and who carries it. Linked once, from the CREDITS colophon
 * (tsunagi-m-chrome §4). A plain link in a new tab; nothing is prefetched.
 */
const MESH: Record<Lang, string> = {
    ja: 'https://m3.tsunagi.app/mesh',
    en: 'https://m3.tsunagi.app/en/mesh',
};

export function meshUrl(lang: Lang): string {
    return MESH[lang];
}
