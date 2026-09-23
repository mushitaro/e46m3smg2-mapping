/**
 * Finding one of 111 items.
 *
 * The list has been in XDF document order with no search since it was written, which is fine for
 * ten items and useless for a hundred and eleven. Worse, 81 of them carry a `<description>` that
 * is the only place a German state name like "Anfahrhilfe" appears — so the text that would let
 * someone find the hill-start parameters was parsed, rendered once, and never searchable.
 *
 * Ranked rather than filtered, in three buckets: an exact title match, then a prefix, then a
 * substring anywhere including the description. Within a bucket, shorter titles first — a search
 * for "clutch" should surface `CLUTCH: Overload Cooldown time` above
 * `KICKDOWN: Throttle Difference Clutch Factor`.
 */

import type { XdfItem } from '@tsunagi/xdf-engine';

export interface SearchHit {
    readonly item: XdfItem;
    /** 0 exact, 1 prefix, 2 substring in the title, 3 substring in the description only. */
    readonly rank: number;
}

function normalise(s: string): string {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Rank items against a query. An empty query returns everything, unranked and in file order.
 *
 * The description is searched but ranked last, so a title match is never buried under an item
 * that merely mentions the word in its prose.
 */
export function searchItems(items: readonly XdfItem[], query: string): SearchHit[] {
    const q = normalise(query);
    if (!q) return items.map(item => ({ item, rank: 0 }));

    const hits: SearchHit[] = [];
    for (const item of items) {
        const title = normalise(item.title);
        const description = item.description ? normalise(item.description) : '';
        let rank: number | null = null;
        if (title === q) rank = 0;
        else if (title.startsWith(q)) rank = 1;
        else if (title.includes(q)) rank = 2;
        else if (description.includes(q)) rank = 3;
        if (rank !== null) hits.push({ item, rank });
    }

    return hits.sort((a, b) =>
        a.rank - b.rank
        || a.item.title.length - b.item.title.length
        || a.item.title.localeCompare(b.item.title));
}

/**
 * Which of the item's categories to show as facets, with counts over the WHOLE catalogue.
 *
 * Counted before filtering on purpose: a facet that showed the filtered count would read as
 * "there are two Clutch items" when there are twelve and ten are hidden by the search.
 */
export function categoryCounts(items: readonly XdfItem[]): [string, number][] {
    const counts = new Map<string, number>();
    for (const item of items) {
        for (const name of item.categories) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
