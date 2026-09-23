import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe as suite, expect, it } from 'vitest';
import { parseXdf } from '@tsunagi/xdf-engine';
import { categoryCounts, searchItems } from './itemSearch';

const XDF = join(__dirname, '..', '..', 'public', 'xdf', 'Siemens_SMG_II_510_512K.xdf');

/**
 * The MS4X Dev Team's XDF is not in this repository (it is theirs to publish, not ours — see
 * THIRD-PARTY-NOTICES.md), so on a fresh clone these tests skip rather than fail. Put the file
 * where README.md says and they run.
 */
const HAVE_XDF = existsSync(XDF);
const describe = HAVE_XDF ? suite : suite.skip;

const def = HAVE_XDF ? parseXdf(readFileSync(XDF, 'utf8')) : { items: [] as ReturnType<typeof parseXdf>['items'] };
const items = def.items;

describe('finding one of 111 items', () => {
    it('an empty query keeps everything, in file order', () => {
        const hits = searchItems(items, '');
        expect(hits).toHaveLength(items.length);
        expect(hits[0].item.uniqueId).toBe(items[0].uniqueId);
    });

    it('ranks an exact title above a prefix above a substring', () => {
        const hits = searchItems(items, 'rpm limit');
        expect(hits[0].item.title).toBe('RPM Limit');
        expect(hits[0].rank).toBe(0);
        // "DWF: RPM Limit Hysteresis" contains it, so it must come after.
        expect(hits.slice(1).some(h => h.item.title.includes('RPM Limit'))).toBe(true);
    });

    it('prefers the shorter title when the rank ties', () => {
        const hits = searchItems(items, 'clutch');
        const titles = hits.map(h => h.item.title);
        expect(titles.length).toBeGreaterThan(5);
        const short = titles.indexOf('CLUTCH: Overload Cooldown time');
        const long = titles.indexOf('KICKDOWN: Throttle Difference Clutch Factor');
        expect(short).toBeGreaterThanOrEqual(0);
        expect(long).toBeGreaterThanOrEqual(0);
        expect(short).toBeLessThan(long);
    });

    it('searches the description, which is where the German state names live', () => {
        // "Anfahrhilfe" appears in no title at all — only in the HILLCLIMB descriptions. Before
        // this, the text that names the hill-start parameters was unreachable by search.
        const byTitle = items.filter(i => i.title.toLowerCase().includes('anfahrhilfe'));
        expect(byTitle).toHaveLength(0);

        const hits = searchItems(items, 'anfahrhilfe');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.every(h => h.rank === 3)).toBe(true);
        expect(hits.some(h => h.item.title.startsWith('HILLCLIMB'))).toBe(true);
    });

    it('never ranks a description match above a title match', () => {
        const hits = searchItems(items, 'racestart');
        const firstDescriptionOnly = hits.findIndex(h => h.rank === 3);
        const lastTitle = hits.map(h => h.rank).lastIndexOf(2);
        if (firstDescriptionOnly >= 0 && lastTitle >= 0) {
            expect(firstDescriptionOnly).toBeGreaterThan(lastTitle);
        }
    });

    it('returns nothing for a query that matches nothing, rather than everything', () => {
        expect(searchItems(items, 'zzzznotathing')).toEqual([]);
    });
});

describe('facet counts', () => {
    it('count the whole catalogue, not the filtered view', () => {
        const counts = categoryCounts(items);
        const total = counts.reduce((n, [, c]) => n + c, 0);
        // Every item is in at least one category, so the sum is at least the item count.
        expect(total).toBeGreaterThanOrEqual(items.length);
        expect(counts.find(([name]) => name === 'Clutch')?.[1]).toBe(12);
        // Declared and empty — worth keeping visible rather than hiding.
        expect(counts.find(([name]) => name === 'Pressure')).toBeUndefined();
    });
});
