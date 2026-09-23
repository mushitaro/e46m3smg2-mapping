import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe as suite, expect, it } from 'vitest';
import { parseXdf, type XdfItem } from '@tsunagi/xdf-engine';
import { categoryCounts } from './itemSearch';
import { groupItems, KIND_ORDER } from './itemGroups';
import { kindOf } from './calibration/run';

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
const order = categoryCounts(items);

const flatten = (groups: ReturnType<typeof groupItems>) =>
    groups.flatMap(g => g.kinds.flatMap(k => [...k.members]));

describe('the tree groups', () => {
    it('places every item exactly once', () => {
        const placed = flatten(groupItems(items, order, 'UNCATEGORISED'));
        expect(placed).toHaveLength(items.length);
        expect(new Set(placed.map(i => i.uniqueId)).size).toBe(items.length);
    });

    it('reports a count that matches what it holds', () => {
        for (const group of groupItems(items, order, 'UNCATEGORISED')) {
            expect(group.count).toBe(group.kinds.reduce((n, k) => n + k.members.length, 0));
        }
    });

    it('follows the facet row, so the chips and the tree agree about what comes first', () => {
        const groups = groupItems(items, order, 'UNCATEGORISED');
        const named = groups.map(g => g.name).filter(name => order.some(([n]) => n === name));
        const ranks = named.map(name => order.findIndex(([n]) => n === name));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });

    it('nests kinds in display order and never labels a kind it does not hold', () => {
        for (const group of groupItems(items, order, 'UNCATEGORISED')) {
            const kinds = group.kinds.map(k => k.kind);
            const expected = KIND_ORDER.filter(k => kinds.includes(k));
            expect(kinds).toEqual(expected);
            for (const k of group.kinds) {
                expect(k.members.length).toBeGreaterThan(0);
                for (const m of k.members) expect(kindOf(m)).toBe(k.kind);
            }
        }
    });

    it('gives an item with no category a home rather than dropping it', () => {
        const orphan = { ...items[0], uniqueId: 'orphan', categories: [] } as XdfItem;
        const groups = groupItems([...items, orphan], order, 'UNCATEGORISED');
        const last = groups[groups.length - 1];
        expect(last.name).toBe('UNCATEGORISED');
        expect(flatten(groups)).toHaveLength(items.length + 1);
    });

    it('keeps the order it was given inside a group, so a ranked list stays ranked', () => {
        const first = items.filter(i => i.categories[0] === order[0][0]);
        const reversed = [...first].reverse();
        const [group] = groupItems(reversed, order, 'UNCATEGORISED');
        const maps = reversed.filter(i => kindOf(i) === 'map').map(i => i.uniqueId);
        const mapGroup = group.kinds.find(k => k.kind === 'map');
        expect((mapGroup?.members ?? []).map(i => i.uniqueId)).toEqual(maps);
    });
});
