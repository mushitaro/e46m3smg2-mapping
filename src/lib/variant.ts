'use client';

/**
 * Is this the owner preview? Read once, safely for hydration.
 *
 * The answer is the `app-variant` meta that `scripts/brand-preview.mjs` writes into the exported
 * pages — `preview` there, absent on production. One compile serves both, so the answer cannot be
 * baked in at build time; it has to be read from the page, and reading the DOM during the render
 * that Next prerenders would disagree with the prerender. `useSyncExternalStore` with a server
 * snapshot of `false` is the API for exactly that: the prerender says "not preview", the client
 * says what the page says.
 *
 * `false` is also the safe direction. Everything this gates is SYNC — requests to the gate and the
 * API — and production must make none (tsunagi-m-release §2.2: SYNC is preview-only for good,
 * because production is local-only and says so).
 *
 * What the build is CALLED is a second meta, `app-label`, written beside it from
 * `scripts/brand-label.mjs` — the preview is called WORKS (operator, 2026-09-25). It only names the
 * build in the header's badge: nothing compares it, and neither meta is derived from the other.
 */

import { useSyncExternalStore } from 'react';

import { isPreviewBuild } from './owner-sync';

const never = () => () => {};

export function usePreviewBuild(): boolean {
    return useSyncExternalStore(never, isPreviewBuild, () => false);
}

const readLabel = (): string => document.querySelector('meta[name="app-label"]')?.getAttribute('content') ?? '';

/** WORKS | STAGING | '' (production). Display only — brand-preview writes it from scripts/brand-label.mjs. */
export function useBuildLabel(): string {
    return useSyncExternalStore(never, readLabel, () => '');
}
