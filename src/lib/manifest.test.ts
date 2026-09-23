import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe as suite, expect, it } from 'vitest';
import { parseXdf, readRun, type XdfDefinition } from '@tsunagi/xdf-engine';
import { EMPTY_EDITS, withCell } from './edits';
import { buildManifest } from './manifest';
import type { Workspace } from './workspace';

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
    const s = new Uint8Array(0x80000);
    for (let i = 0; i < s.length; i++) s[i] = (i * 31 + (i >> 8)) & 0xff;
    return s;
}

const items = def.items;
const TABLE = items.find(i => i.title === 'AUTO: A3 Speed Thresholds')!;
const CONSTANT = items.find(i => i.title === 'RPM Limit')!;

function workspaceWith(base: Uint8Array, edits = EMPTY_EDITS): Workspace {
    return {
        original: base,
        variant: 'full-512k',
        origin: { kind: 'file', fileName: 'test.bin', lastModified: 0 },
        sha256: 'abcdef0123456789',
        loadedAt: 0,
        edits,
    };
}

const render = (w: Workspace, checksum: { before: number; after: number } | null = null) =>
    buildManifest({
        workspace: w, def, items,
        definitionFile: '/xdf/Siemens_SMG_II_510_512K.xdf',
        addedIds: new Set<string>(),
        appVersion: 'v0.2.0',
        binFileName: 'SMG2_510_FULL512K_test_CRCOK.bin',
        checksum,
        stamp: new Date(0),
    });

describe('the export manifest', () => {
    it('says plainly when nothing changed', () => {
        const text = render(workspaceWith(image()));
        expect(text).toContain('CHANGES: 0 item(s), 0 cell(s)');
        expect(text).toContain('Nothing was changed.');
    });

    it('states every changed cell in raw AND physical, with its address', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        const edits = withCell(EMPTY_EDITS, def, base, TABLE, 1, 2, before[1 * 16 + 2] + 16);
        const text = render(workspaceWith(base, edits), { before: 0x4c83, after: 0x1234 });

        expect(text).toContain('AUTO: A3 Speed Thresholds');
        expect(text).toContain('CHANGES: 1 item(s), 1 cell(s), 2 byte(s) may differ');
        // Raw first: it is what the flash holds and it survives a scaling correction.
        expect(text).toMatch(new RegExp(`${before[18]} -> ${before[18] + 16}`));
        // The cell's own address, not the item's start.
        expect(text).toMatch(/\[1,2\]\s+0x[0-9A-F]{5}/);
        // Physical, so the reader can sanity-check what they typed.
        expect(text).toMatch(/-> [\d.]+/);
        expect(text).toContain('0x4C83 -> 0x1234');
    });

    it('carries a constant as a single indexed cell, not a 2-D one', () => {
        const base = image();
        const before = readRun(def, base, CONSTANT)[0];
        const edits = withCell(EMPTY_EDITS, def, base, CONSTANT, 0, 0, before + 100);
        const text = render(workspaceWith(base, edits));

        expect(text).toContain('RPM Limit');
        expect(text).toContain('[0]');
        expect(text).not.toContain('[0,0]');
    });

    it('lists the permitted bytes as runs, so a person can check ranges', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        let edits = withCell(EMPTY_EDITS, def, base, TABLE, 0, 0, before[0] + 1);
        edits = withCell(edits, def, base, TABLE, 0, 1, before[1] + 1);
        const text = render(workspaceWith(base, edits));

        expect(text).toContain('BYTES PERMITTED TO DIFFER (4)');
        // Two adjacent 16-bit cells are one four-byte run, printed as a range.
        expect(text).toMatch(/0x[0-9A-F]{5} - 0x[0-9A-F]{5}/);
    });

    it('names the checksum word when the CRC was rewritten', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        const edits = withCell(EMPTY_EDITS, def, base, TABLE, 0, 0, before[0] + 1);
        const text = render(workspaceWith(base, edits), { before: 1, after: 2 });
        expect(text).toContain('0x32080 - 0x32081   (the checksum word itself)');
    });

    it('records the provenance an audit needs', () => {
        const text = render(workspaceWith(image()));
        expect(text).toContain('source SHA  : abcdef0123456789');
        expect(text).toContain('definition  : /xdf/Siemens_SMG_II_510_512K.xdf');
        expect(text).toContain('app         : v0.2.0');
    });
});

describe('an item this project invented', () => {
    it('is named as such, so a recipient is not surprised by it in TunerPro', () => {
        const base = image();
        const before = readRun(def, base, TABLE);
        const edits = withCell(EMPTY_EDITS, def, base, TABLE, 0, 0, before[0] + 1);
        const text = buildManifest({
            workspace: workspaceWith(base, edits), def, items,
            definitionFile: '/xdf/x.xdf',
            addedIds: new Set([TABLE.uniqueId]),
            appVersion: 'v0.2.0', binFileName: 'x.bin', checksum: null, stamp: new Date(0),
        });
        expect(text).toContain('[ADDED BY THIS PROJECT');
    });
});
