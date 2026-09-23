/**
 * Corrections and additions to a community definition, without editing the community definition.
 *
 * The MS4X XDF is provably wrong in five places and silent about several structures that matter.
 * The obvious fix — edit the file — is the wrong one:
 *
 *   - **It destroys the cross-check.** The XDF is what lets this tool's output be verified in
 *     TunerPro. Patch the file and the two agree because they read the same edited bytes, not
 *     because the reading is right.
 *   - **Most of it is not expressible in XDF anyway.** There is no way to say "rows 0-4 are
 *     upshift", "bit 4 is the sub-18 km/h crawl logic", or "these two items share bytes on
 *     purpose".
 *   - **Provenance dies.** A patched file is byte-indistinguishable from an original, and a year
 *     from now nobody can separate MS4X's addresses from ours.
 *
 * So: an overlay, applied at load, carrying its own evidence.
 *
 * ## The rule that keeps it honest
 *
 * Every `patch` states `was` — the value the vendor file currently holds. `applyOverlay` checks
 * it before changing anything. If MS4X republishes with a different address, the build fails and
 * names the entry, instead of silently "correcting" something that is no longer wrong. This is
 * the most important rule in the file: a correction that cannot detect its own obsolescence is
 * a lie waiting for a version bump.
 */

import type { XdfAxis, XdfDefinition, XdfEmbedded, XdfItem } from './types';

/** How sure we are, per field. One entry can mix grades, so this is not per entry. */
export type Provenance =
    | { readonly kind: 'community' }
    | { readonly kind: 'measured'; readonly evidence: string }
    | { readonly kind: 'documented'; readonly source: string }
    | { readonly kind: 'inferred'; readonly confidence: 'strong' | 'weak'; readonly evidence: string };

/** What may be corrected on an item. Only what has actually been needed. */
export interface EmbeddedPatch {
    readonly address?: number;
    readonly rows?: number;
    readonly cols?: number;
    /**
     * An axis's declared length.
     *
     * Separate from `cols` because it lives on the axis rather than on its embedded data, and
     * because correcting a table's width WITHOUT it leaves the labelled axis one point short —
     * which the validator then reports, correctly, as a shape mismatch. A correction that
     * creates a new warning is not finished.
     */
    readonly indexCount?: number;
}

export interface OverlayPatch {
    readonly op: 'patch';
    /** XDF `uniqueid`. Never a title — three titles repeat in this file — and never an index. */
    readonly uniqueId: string;
    /** For the reader and for the failure message. */
    readonly title: string;
    /** Which run: a constant's own field, or one of a table's axes. */
    readonly target: 'value' | 'x' | 'y';
    /** The vendor's CURRENT values. Checked before anything is changed. */
    readonly was: EmbeddedPatch;
    readonly now: EmbeddedPatch;
    readonly why: string;
    readonly provenance: Provenance;
}

export interface OverlayAlias {
    readonly op: 'alias';
    readonly uniqueIds: readonly [string, string];
    readonly why: string;
    readonly provenance: Provenance;
}

/**
 * Prose in both languages.
 *
 * A note's `prose` is body copy the reader has to *understand*, not shorthand they recognise — so
 * unlike the instrument's vocabulary it belongs to the reader's language. `en` is the authority:
 * for a legend transcribed out of the vendor XDF it is the string a test compares against the
 * definition's own `<description>`, and translating that in place would break the check that the
 * transcription is still faithful. `ja` rides alongside it.
 */
export interface Bilingual {
    readonly en: string;
    readonly ja: string;
}

export interface OverlayNote {
    readonly op: 'note';
    readonly uniqueId: string;
    /** Row roles, bit legends, gear pairings — structure the XDF cannot express. */
    readonly rowGroups?: readonly { readonly label: string; readonly rows: readonly number[] }[];
    readonly bits?: readonly {
        readonly bit: number;
        /** The transcription. Compared against the XDF by `catalog.test.ts`. */
        readonly label: string;
        readonly labelJa: string;
        readonly documented: boolean;
    }[];
    readonly prose?: Bilingual;
    readonly provenance: Provenance;
}

/**
 * An item the definition omits entirely.
 *
 * Modelled on an item the definition DOES have, so the new one inherits its widths, endianness,
 * scaling and axis labels rather than restating them. That is not laziness: the whole reason to
 * believe an undeclared block is a shift table is that it sits on the same stride, with the same
 * geometry, as ten declared ones. Copying the sibling's shape IS the evidence, and restating the
 * numbers by hand would let the two drift apart.
 */
export interface OverlayAdd {
    readonly op: 'add';
    /**
     * Deliberately NOT hex-shaped. A vendor `uniqueid` looks like `0x6E91`; this looks like
     * `smg2/auto-36240`, so nothing can mistake an item we invented for one MS4X shipped —
     * not in the diff list, not in the manifest, not in a bug report six months from now.
     */
    readonly uniqueId: string;
    readonly title: string;
    /** The declared item whose shape this one copies. */
    readonly modelledOn: string;
    readonly address: number;
    readonly description: string;
    readonly why: string;
    readonly provenance: Provenance;
}

/**
 * A unit the vendor left blank, supplied.
 *
 * ## Why this is a correction and not an embellishment
 *
 * The MS4X definition labels **nine** items `kmh` whose MATH is `X/16`, and leaves **thirty-two
 * more with the identical `X/16`** carrying no unit at all — among them all twenty `AUTO: *
 * Speed Thresholds`, which are the tables this tool exists to edit. The same author, the same
 * file, the same conversion, two different amounts of labelling. So the unit is not being
 * invented here; it is being read off the vendor's own siblings.
 *
 * `was` is the guard, exactly as it is for `patch`: the entry states the unit the file currently
 * carries, and `applyOverlay` refuses if that has changed. If MS4X labels these itself, the build
 * fails and names the entry rather than quietly writing over a better answer.
 *
 * **What this op must never be used for.** A unit is a claim about physics. `RACESTART: Target
 * Clutch` is `X/256` and unlabelled, and it stays unlabelled, because nothing in the file or the
 * dump says what 1.0 of it is. The twelve `Clutch Math` constants stay unlabelled for the same
 * reason. A wrong unit is worse than none: it makes a number quotable.
 */
export interface OverlayUnits {
    readonly op: 'units';
    readonly uniqueId: string;
    readonly title: string;
    readonly target: 'value' | 'x' | 'y';
    /** What the file says today. Usually `null`; checked before anything changes. */
    readonly was: { readonly units: string | null };
    readonly now: { readonly units: string; readonly decimals?: number };
    readonly why: string;
    readonly provenance: Provenance;
}

export type OverlayEntry = OverlayPatch | OverlayAlias | OverlayNote | OverlayAdd | OverlayUnits;

export interface Overlay {
    readonly version: string;
    readonly entries: readonly OverlayEntry[];
}

export class OverlayError extends Error {
    constructor(message: string) { super(message); this.name = 'OverlayError'; }
}

export interface OverlayResult {
    readonly definition: XdfDefinition;
    /** Items this overlay invented, so the UI can badge them and the manifest can name them. */
    readonly added: ReadonlySet<string>;
    /** What was applied, for the UI's provenance badges and the export manifest. */
    readonly applied: readonly OverlayEntry[];
    /** Aliases, so the validator can downgrade an overlap it now knows is deliberate. */
    readonly aliases: readonly (readonly [string, string])[];
    readonly notes: ReadonlyMap<string, OverlayNote>;
}

function unitsOf(item: XdfItem, target: OverlayUnits['target']): string | null {
    if (item.kind === 'constant') return target === 'value' ? item.units : null;
    if (target === 'value') return item.z.units;
    const axis = target === 'x' ? item.x : item.y;
    return axis ? axis.units : null;
}

function withUnits(item: XdfItem, entry: OverlayUnits): XdfItem {
    const { units, decimals } = entry.now;
    if (item.kind === 'constant') {
        return { ...item, units, decimals: decimals ?? item.decimals };
    }
    if (entry.target === 'value') {
        return { ...item, z: { ...item.z, units, decimals: decimals ?? item.z.decimals } };
    }
    const key = entry.target === 'x' ? 'x' : 'y';
    const axis = item[key];
    if (!axis) return item;
    return { ...item, [key]: { ...axis, units, decimals: decimals ?? axis.decimals } };
}

function embeddedOf(item: XdfItem, target: OverlayPatch['target']): XdfEmbedded | null {
    if (item.kind === 'constant') return target === 'value' ? item.data : null;
    if (target === 'value') return item.z.data;
    const axis = target === 'x' ? item.x : item.y;
    return axis ? axis.data : null;
}

/** The declared length of the run a patch targets, or null when the target has no axis. */
function axisIndexCount(item: XdfItem, target: OverlayPatch['target']): number | null {
    if (item.kind === 'constant') return null;
    if (target === 'value') return item.z.indexCount;
    const axis = target === 'x' ? item.x : item.y;
    return axis ? axis.indexCount : null;
}

function withEmbedded(data: XdfEmbedded, patch: EmbeddedPatch): XdfEmbedded {
    return {
        ...data,
        address: patch.address ?? data.address,
        rows: patch.rows ?? data.rows,
        cols: patch.cols ?? data.cols,
    };
}

function withAxis(axis: XdfAxis, patch: EmbeddedPatch): XdfAxis {
    return {
        ...axis,
        indexCount: patch.indexCount ?? axis.indexCount,
        data: withEmbedded(axis.data, patch),
    };
}

function patchItem(item: XdfItem, entry: OverlayPatch): XdfItem {
    if (item.kind === 'constant') {
        return { ...item, data: withEmbedded(item.data, entry.now) };
    }
    if (entry.target === 'value') {
        // Correcting a table's width means correcting the axis that labels it. Doing one without
        // the other trades a real defect for a warning, which is not a repair.
        const next: XdfItem = { ...item, z: withAxis(item.z, entry.now) };
        return entry.now.cols !== undefined && next.x
            ? { ...next, x: { ...next.x, indexCount: entry.now.cols } }
            : next;
    }
    const axis: XdfAxis | null = entry.target === 'x' ? item.x : item.y;
    if (!axis) throw new OverlayError(`"${entry.title}" has no ${entry.target} axis to patch`);
    const next = withAxis(axis, entry.now);
    return entry.target === 'x' ? { ...item, x: next } : { ...item, y: next };
}

/**
 * Apply an overlay, refusing rather than guessing.
 *
 * Throws when a `was` does not match, when an id is not in the definition, or when a patch names
 * an axis the item does not have. All three mean the definition changed under the overlay, and
 * the only safe response is to stop and say which entry.
 */
export function applyOverlay(def: XdfDefinition, overlay: Overlay): OverlayResult {
    const byId = new Map(def.items.map(i => [i.uniqueId, i]));
    const applied: OverlayEntry[] = [];
    const aliases: (readonly [string, string])[] = [];
    const notes = new Map<string, OverlayNote>();
    const added = new Set<string>();
    const extra: XdfItem[] = [];

    /**
     * Adds are applied first, whatever order the catalog lists them in.
     *
     * An entry that names an item this overlay itself invented — a unit for the eleventh AUTO
     * table, say — would otherwise fail or succeed depending on where its author happened to put
     * it in the array. That is a trap with no symptom until someone reorders the file for
     * readability, so the ordering is decided here rather than left to whoever edits the catalog.
     */
    const ordered = [...overlay.entries].sort((a, b) => Number(b.op === 'add') - Number(a.op === 'add'));

    for (const entry of ordered) {
        if (entry.op === 'add') {
            if (byId.has(entry.uniqueId)) {
                throw new OverlayError(
                    `add "${entry.title}" uses id ${entry.uniqueId}, which the definition already has`);
            }
            const model = byId.get(entry.modelledOn);
            if (!model) {
                throw new OverlayError(
                    `add "${entry.title}" is modelled on ${entry.modelledOn}, which is not in this `
                    + `definition. The overlay is for a different XDF than the one loaded.`);
            }
            if (model.kind !== 'table') {
                throw new OverlayError(`add "${entry.title}" is modelled on a constant; only tables are supported`);
            }
            // The x axis moves with the z payload. In this definition an AUTO block's axis sits a
            // fixed distance below its data, and a block that borrowed its sibling's axis would
            // label its own numbers with the neighbour's breakpoints.
            const axisOffset = model.x && model.x.data.address !== null && model.z.data.address !== null
                ? model.x.data.address - model.z.data.address
                : null;
            const item: XdfItem = {
                ...model,
                uniqueId: entry.uniqueId,
                title: entry.title,
                description: entry.description,
                z: { ...model.z, data: { ...model.z.data, address: entry.address } },
                x: model.x && axisOffset !== null
                    ? { ...model.x, data: { ...model.x.data, address: entry.address + axisOffset } }
                    : model.x,
            };
            extra.push(item);
            byId.set(entry.uniqueId, item);
            added.add(entry.uniqueId);
            applied.push(entry);
            continue;
        }
        if (entry.op === 'alias') {
            for (const id of entry.uniqueIds) {
                if (!byId.has(id)) {
                    throw new OverlayError(`alias names "${id}", which is not in this definition`);
                }
            }
            aliases.push(entry.uniqueIds);
            applied.push(entry);
            continue;
        }
        if (entry.op === 'units') {
            const target = byId.get(entry.uniqueId);
            if (!target) {
                throw new OverlayError(`units names "${entry.uniqueId}", which is not in this definition`);
            }
            const current = unitsOf(target, entry.target);
            if (current !== entry.was.units) {
                throw new OverlayError(
                    `units "${entry.title}" expected the definition to carry ${JSON.stringify(entry.was.units)} `
                    + `and it carries ${JSON.stringify(current)}. The vendor file changed; re-check the entry `
                    + `rather than overwriting a unit somebody else supplied.`);
            }
            const updated = withUnits(target, entry);
            byId.set(entry.uniqueId, updated);
            // An item this overlay added lives in `extra`, and `byId` is only its index. Writing
            // to the index alone left the eleventh AUTO table without the unit its ten siblings
            // had just been given — the one item that most needed it, because it is the one no
            // vendor file describes.
            const slot = extra.findIndex(i => i.uniqueId === entry.uniqueId);
            if (slot >= 0) extra[slot] = updated;
            applied.push(entry);
            continue;
        }
        if (entry.op === 'note') {
            if (!byId.has(entry.uniqueId)) {
                throw new OverlayError(`note names "${entry.uniqueId}", which is not in this definition`);
            }
            notes.set(entry.uniqueId, entry);
            applied.push(entry);
            continue;
        }

        const item = byId.get(entry.uniqueId);
        if (!item) {
            throw new OverlayError(
                `patch "${entry.title}" names uniqueid ${entry.uniqueId}, which is not in this ` +
                `definition. The overlay is for a different XDF than the one loaded.`);
        }
        const data = embeddedOf(item, entry.target);
        if (!data) {
            throw new OverlayError(`patch "${entry.title}" names a ${entry.target} run the item does not have`);
        }
        // The guard. A correction that cannot notice the vendor already fixed it is worse than
        // no correction at all, because it would re-break a repaired definition.
        for (const [key, expected] of Object.entries(entry.was) as [keyof EmbeddedPatch, number][]) {
            // `indexCount` lives on the axis, not on its embedded data. Reading it from the right
            // place keeps the guard checking what the patch will actually change.
            const actual = key === 'indexCount'
                ? axisIndexCount(item, entry.target)
                : (data as unknown as Record<string, number | null>)[key];
            if (actual !== expected) {
                throw new OverlayError(
                    `patch "${entry.title}" expected ${key} to be ${expected} in the vendor ` +
                    `definition and found ${actual}. The definition has changed — check whether ` +
                    `this correction is still needed before removing this guard.`);
            }
        }
        byId.set(entry.uniqueId, patchItem(item, entry));
        applied.push(entry);
    }

    // Added items go at the END, so an index into the vendor list still means what it meant.
    const items = [...def.items.map(i => byId.get(i.uniqueId) ?? i), ...extra];
    return {
        definition: { ...def, items },
        added,
        applied,
        aliases,
        notes,
    };
}
