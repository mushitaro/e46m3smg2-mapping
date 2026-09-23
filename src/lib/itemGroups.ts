/**
 * The tree's groups: category → kind → item.
 *
 * Extracted from the component because the property that matters cannot be seen by looking at the
 * screen: **every item lands in exactly one group.** A grouping that silently drops an item makes
 * a parameter disappear from a list that still says `112` above it, and the way that gets
 * reported is "the tool does not have it" — six months after the definition gained it.
 *
 * The nesting is the reference tuner's: the factory's own category partition, and inside each the
 * three storage kinds — a constant, a curve and a map are different things to open, and a category
 * like GEAR LOGIC holds all three. An item whose XDF declares no category is not dropped and not
 * hidden behind a chip; it gets a named home of its own, at the end.
 */

import type { XdfItem } from '@tsunagi/xdf-engine';
import { kindOf, type ItemKind } from './calibration/run';

export interface KindGroup {
    readonly kind: ItemKind;
    readonly members: readonly XdfItem[];
}

export interface ItemGroup {
    readonly name: string;
    readonly kinds: readonly KindGroup[];
    readonly count: number;
}

/** Storage kinds in the order they are shown: simplest first. */
export const KIND_ORDER: readonly ItemKind[] = ['constant', 'curve', 'map'];

/**
 * @param items      already filtered and, when a query is in force, already ranked
 * @param order      the facet row's categories, most-populous first
 * @param fallback   the name for an item that declares no category, in the reader's language
 */
export function groupItems(
    items: readonly XdfItem[],
    order: readonly (readonly [string, number])[],
    fallback: string,
): ItemGroup[] {
    const buckets = new Map<string, XdfItem[]>();
    for (const item of items) {
        // The FIRST category, consistently. An item in two categories appears once, under the one
        // its definition names first — the alternative is a tree whose row count disagrees with
        // the counter above it.
        const name = item.categories[0] ?? fallback;
        const bucket = buckets.get(name);
        if (bucket) bucket.push(item);
        else buckets.set(name, [item]);
    }

    const rank = new Map(order.map(([name], i) => [name, i]));
    return [...buckets.entries()]
        .sort((a, b) => (rank.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b[0]) ?? Number.MAX_SAFE_INTEGER))
        .map(([name, group]) => ({
            name,
            kinds: KIND_ORDER
                .map(kind => ({ kind, members: group.filter(i => kindOf(i) === kind) }))
                .filter(g => g.members.length > 0),
            count: group.length,
        }));
}
