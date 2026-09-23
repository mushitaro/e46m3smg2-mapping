import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe as suite, expect, it } from 'vitest';
import { parseXdf, readRun, type XdfDefinition, type XdfItem } from '@tsunagi/xdf-engine';
import {
    EMPTY_EDITS,
    applyEdits,
    editedSpanOffsets,
    changedCellCount,
    changedCells,
    currentRun,
    rebase,
    withBulk,
    withCell,
    withCellReverted,
    withRun,
    withoutItem,
} from './edits';
import { quantise } from './quantise';

const XDF = join(__dirname, '..', '..', 'public', 'xdf', 'Siemens_SMG_II_510_512K.xdf');
const DUMP = join(__dirname, '..', '..', 'data', 'extractions', '5c5a0c857acd.bin');

/**
 * The MS4X Dev Team's XDF is not in this repository (it is theirs to publish, not ours — see
 * THIRD-PARTY-NOTICES.md), so on a fresh clone these tests skip rather than fail. Put the file
 * where README.md says and they run.
 */
const HAVE_XDF = existsSync(XDF);
const describe = HAVE_XDF ? suite : suite.skip;

const def: XdfDefinition = HAVE_XDF ? parseXdf(readFileSync(XDF, 'utf8')) : ({ items: [] } as unknown as XdfDefinition);

function image(): Uint8Array {
    if (existsSync(DUMP)) return new Uint8Array(readFileSync(DUMP));
    const synthetic = new Uint8Array(0x80000);
    for (let i = 0; i < synthetic.length; i++) synthetic[i] = (i * 31 + (i >> 8)) & 0xff;
    return synthetic;
}

const items = def.items;
const byTitle = (t: string): XdfItem => items.find(i => i.title === t)!;
const TABLE = byTitle('AUTO: A3 Speed Thresholds');
const CONSTANT = byTitle('RPM Limit');

describe('the edit set counts what will change, and nothing else', () => {
    it('records a real change', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        const edits = withCell(EMPTY_EDITS, def, base, TABLE, 1, 3, before[1 * 16 + 3] + 8);

        expect(edits.size).toBe(1);
        expect(changedCellCount(edits)).toBe(1);
        expect(changedCells(edits.get(TABLE.uniqueId)!)).toEqual([
            { index: 19, row: 1, col: 3, baseRaw: before[19], raw: before[19] + 8 },
        ]);
    });

    it('drops the entry when a cell is typed back to the value it already had', () => {
        // The property the old float comparison could not give: "typed the same value" is a
        // no-op, not an edit, so the count is never inflated by cells that will write nothing.
        const base = image();
        const before = readRun(def, base, TABLE);
        const edits = withCell(EMPTY_EDITS, def, base, TABLE, 0, 0, before[0]);
        expect(edits.size).toBe(0);
    });

    it('cancels exactly on revert', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        let e = withCell(EMPTY_EDITS, def, base, TABLE, 2, 5, before[2 * 16 + 5] + 40);
        expect(e.size).toBe(1);
        e = withCellReverted(e, def, base, TABLE, 2, 5);
        expect(e.size).toBe(0);
    });

    it('cancels exactly on +d then -d, because raw integers cancel and floats do not', () => {
        const base = image();
        const all = [...Array(readRun(def, base, TABLE).length).keys()];
        let e = withBulk(EMPTY_EDITS, def, base, TABLE, all, r => r + 7);
        expect(changedCellCount(e)).toBeGreaterThan(100);
        e = withBulk(e, def, base, TABLE, all, r => r - 7);
        expect(e.size).toBe(0);
    });

    it('treats a constant as a run of one, with no special path', () => {
        const base = image();
        const before = readRun(def, base, CONSTANT);
        expect(before).toHaveLength(1);

        const raised = quantise(CONSTANT, 8300);
        const e = withCell(EMPTY_EDITS, def, base, CONSTANT, 0, 0, raised.raw);
        expect(e.size).toBe(1);
        expect(changedCellCount(e)).toBe(1);

        const out = applyEdits(def, base, e, items);
        expect(readRun(def, out, CONSTANT)).toEqual([raised.raw]);
    });

    it('withoutItem drops a whole item', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        let e = withCell(EMPTY_EDITS, def, base, TABLE, 0, 1, before[1] + 3);
        e = withCell(e, def, base, CONSTANT, 0, 0, readRun(def, base, CONSTANT)[0] + 1);
        expect(e.size).toBe(2);
        expect(withoutItem(e, TABLE.uniqueId).size).toBe(1);
    });

    it('currentRun returns the pending edit, not the loaded bytes', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        const e = withCell(EMPTY_EDITS, def, base, TABLE, 0, 0, before[0] + 5);
        expect(currentRun(e, def, base, TABLE)[0]).toBe(before[0] + 5);
        expect(readRun(def, base, TABLE)[0]).toBe(before[0]);
    });
});

describe('what an export would differ in', () => {
    it('never reaches a byte outside the cells that were edited', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        let e = withCell(EMPTY_EDITS, def, base, TABLE, 1, 2, before[1 * 16 + 2] + 16);
        e = withCell(e, def, base, TABLE, 4, 9, before[4 * 16 + 9] + 16);

        const out = applyEdits(def, base, e, items);
        const actuallyDiffer: number[] = [];
        for (let i = 0; i < base.length; i++) if (base[i] !== out[i]) actuallyDiffer.push(i);

        // THE safety property: nothing outside the edited cells moved. Not equality — raising a
        // 16-bit cell by 16 moves only its low byte, so the permitted set is a superset.
        const permitted = new Set(editedSpanOffsets(def, e, items));
        expect(actuallyDiffer.filter(o => !permitted.has(o))).toEqual([]);
        expect(actuallyDiffer.length).toBeGreaterThan(0);
        // Two 16-bit cells: four bytes may move, and the export must not reach past them.
        expect(permitted.size).toBe(4);
    });

    it('leaves the base untouched', () => {
        const base = image();
        const copy = Uint8Array.from(base);
        const e = withCell(EMPTY_EDITS, def, base, TABLE, 0, 0, readRun(def, base, TABLE)[0] + 1);
        applyEdits(def, base, e, items);
        expect(Array.from(base)).toEqual(Array.from(copy));
    });

    it('an empty set produces byte-identical output', () => {
        const base = image();
        expect(Array.from(applyEdits(def, base, EMPTY_EDITS, items))).toEqual(Array.from(base));
    });
});

describe('restoring a saved set', () => {
    it('drops edits whose value the image already holds', () => {
        // A write has landed. Carrying the edit would claim a pending change that writes nothing.
        const base = image();
        const before = readRun(def, base, TABLE);
        const e = withCell(EMPTY_EDITS, def, base, TABLE, 3, 3, before[3 * 16 + 3] + 12);
        const flashed = applyEdits(def, base, e, items);

        expect(rebase(e, def, flashed, items).size).toBe(0);
        expect(rebase(e, def, base, items).size).toBe(1);
    });

    it('drops an edit whose item is no longer in the definition', () => {
        const base = image();
        const e = withCell(EMPTY_EDITS, def, base, TABLE, 0, 0, readRun(def, base, TABLE)[0] + 1);
        expect(rebase(e, def, base, items.filter(i => i !== TABLE)).size).toBe(0);
    });
});

describe('withRun refuses what it cannot honour', () => {
    it('rejects a length mismatch rather than writing a prefix', () => {
        const base = image();
        expect(() => withRun(EMPTY_EDITS, def, base, TABLE, [1, 2, 3]))
            .toThrow(/element\(s\) and 3 were given/);
    });

    it('rejects a cell outside the table', () => {
        const base = image();
        expect(() => withCell(EMPTY_EDITS, def, base, TABLE, 99, 0, 0)).toThrow(/outside/);
    });
});
