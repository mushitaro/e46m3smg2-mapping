/**
 * What an export contains, in a form a person can check.
 *
 * A `.bin` with a correct CRC is not an auditable artifact — it is a file that will load, and
 * whether it holds what you meant is unknowable from the bytes alone. Six months from now the
 * folder is all the context there is, and "SMG2_510_PARTIAL24K_..._CRCOK.bin" says nothing about
 * which three cells moved.
 *
 * So every export writes this beside it. It states, per changed cell, the address, the raw
 * before and after, and the physical before and after. Raw is first because raw is what the
 * flash holds and it survives a later correction to the scaling; physical is what the reader
 * typed and is the only form they can sanity-check.
 */

import {
    type XdfDefinition,
    type XdfItem,
    offsetsOf,
    runTargetOf,
} from '@tsunagi/xdf-engine';
import { changedCells, editedSpanOffsets, type EditSet } from './edits';
import { describeOrigin, type Workspace } from './workspace';

export interface ManifestInput {
    readonly workspace: Workspace;
    readonly def: XdfDefinition;
    readonly items: readonly XdfItem[];
    readonly definitionFile: string;
    /** Items this project invented. Named in the manifest so a recipient is never surprised. */
    readonly addedIds: ReadonlySet<string>;
    readonly appVersion: string;
    readonly binFileName: string;
    /** Stored and recomputed calibration CRC, when the image carries a descriptor. */
    readonly checksum: { before: number; after: number } | null;
    readonly stamp: Date;
}

function hex(n: number, width = 4): string {
    return `0x${(n >>> 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

function num(v: number): string {
    return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export function buildManifest(input: ManifestInput): string {
    const { workspace, def, items, checksum, stamp } = input;
    const byId = new Map(items.map(i => [i.uniqueId, i]));
    const lines: string[] = [];
    const w = (s = '') => lines.push(s);

    w(`SMG II 510 — export manifest`);
    w(`file        : ${input.binFileName}`);
    w(`written     : ${stamp.toISOString()}`);
    w(`app         : ${input.appVersion}`);
    w(`definition  : ${input.definitionFile}`);
    w();
    w(`source      : ${describeOrigin(workspace.origin)}`);
    w(`source SHA  : ${workspace.sha256}`);
    w(`length      : ${workspace.original.length.toLocaleString()} B`);
    w(`variant     : ${workspace.variant ?? 'raw (no definition matches this length)'}`);
    w();

    if (checksum) {
        w(`calibration CRC-16 : ${hex(checksum.before)} -> ${hex(checksum.after)}`);
        w(`  reflected 0xA001, seed 0x7878, over 0x320E0-0x378BF (inclusive), range read from`);
        w(`  the descriptor at 0x32080. Confirmed against BMW's own ;$CARB_MODE_9_CVN.`);
    } else {
        w(`calibration CRC-16 : not present in this image`);
    }
    w();

    const entries = [...workspace.edits.values()];
    const cellTotal = entries.reduce((n, e) => n + changedCells(e).length, 0);
    const spans = editedSpanOffsets(def, workspace.edits, items);

    w(`CHANGES: ${entries.length} item(s), ${cellTotal} cell(s), ${spans.length} byte(s) may differ`);
    w('='.repeat(78));

    if (entries.length === 0) {
        w();
        w(`Nothing was changed. This export is the bytes as they were read.`);
        return lines.join('\n');
    }

    for (const entry of entries.sort((a, b) => a.title.localeCompare(b.title))) {
        const item = byId.get(entry.uniqueId);
        w();
        // A recipient opening this .bin in TunerPro will not find an item we invented. Saying so
        // here is the difference between a shared file and a shared surprise.
        w(entry.title + (input.addedIds.has(entry.uniqueId)
            ? '   [ADDED BY THIS PROJECT — not in the community definition]'
            : ''));
        if (!item) {
            // Cannot happen through the UI, and if it ever does the manifest must say so rather
            // than print an address it guessed.
            w(`  (this item is no longer in the definition; its edit was dropped)`);
            continue;
        }
        const { data, scaling } = runTargetOf(item);
        const offsets = offsetsOf(def, item);
        const width = data.bits / 8;
        w(`  address   ${hex(data.address ?? 0, 5)}   ${entry.rows}x${entry.cols}` +
          `   ${data.bits}-bit ${data.signed ? 'signed' : 'unsigned'} ${data.lsbFirst ? 'LE' : 'BE'}`);
        w(`  scaling   ${scaling.math}`);
        w(`  ${'cell'.padEnd(10)}${'offset'.padEnd(10)}${'raw'.padEnd(18)}physical`);
        for (const cell of changedCells(entry)) {
            const at = offsets[cell.index];
            const where = entry.rows === 1 ? `[${cell.col}]` : `[${cell.row},${cell.col}]`;
            const raw = `${cell.baseRaw} -> ${cell.raw}`;
            const phys = `${num(scaling.toPhysical(cell.baseRaw))} -> ${num(scaling.toPhysical(cell.raw))}`;
            w(`  ${where.padEnd(10)}${hex(at, 5).padEnd(10)}${raw.padEnd(18)}${phys}`);
            void width;
        }
    }

    w();
    w('='.repeat(78));
    w(`BYTES PERMITTED TO DIFFER (${spans.length})`);
    w(`  Every byte of every changed cell. The export must not differ anywhere else — that is`);
    w(`  what stops a recomputed CRC from making an edit to unnamed bytes look correct.`);
    // Runs rather than a list of 4,000 offsets: a reader checks ranges, not integers.
    const runs: [number, number][] = [];
    for (const offset of spans) {
        const last = runs[runs.length - 1];
        if (last && offset === last[1] + 1) last[1] = offset;
        else runs.push([offset, offset]);
    }
    for (const [a, b] of runs) w(`  ${hex(a, 5)}${a === b ? '' : ` - ${hex(b, 5)}`}`);
    if (checksum && checksum.before !== checksum.after) {
        w(`  0x32080 - 0x32081   (the checksum word itself)`);
    }

    return lines.join('\n');
}

/** Hand a string to the browser as a text file. */
export function downloadText(text: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
