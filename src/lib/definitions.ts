/**
 * Which definition describes the image in front of us.
 *
 * The two MS4X files are the same 111 items; they differ only in BASEOFFSET. Choosing between
 * them by IMAGE LENGTH rather than by asking the user removes a way to be wrong that has no
 * symptom: apply the 512 KiB variant to a 24 KiB partial and every address lands outside the
 * buffer, apply the 24 KiB variant to a full dump and every address lands 0x32000 too low —
 * which reads bytes that exist, decode as numbers, and are not the numbers.
 *
 * The validator's `outside-image` finding is the backstop for the first case. The second has no
 * backstop, which is why the choice is made from a fact about the file instead of a setting.
 */

import {
    applyOverlay, parseXdf, validateXdf,
    type OverlayNote, type XdfDefinition, type XdfFinding,
} from '@tsunagi/xdf-engine';
import { CATALOG_VERSION, SMG2_OVERLAY } from './smg2-catalog';
import { CALIBRATION_WINDOW, FULL_IMAGE_LENGTH } from '@tsunagi/ds2-smg2';

export type DefinitionVariant = 'partial-24k' | 'full-512k';

export interface LoadedDefinition {
    readonly variant: DefinitionVariant;
    readonly file: string;
    /** The vendor definition with this project's corrections applied. */
    readonly definition: XdfDefinition;
    readonly findings: readonly XdfFinding[];
    readonly source: string;
    /** The corrections version, so an export can be traced to the reading that produced it. */
    readonly catalogVersion: string;
    /** Structure the XDF cannot express: row groups, bit legends, prose. Keyed by uniqueId. */
    readonly notes: ReadonlyMap<string, OverlayNote>;
    /** Item pairs that share bytes on purpose, so the validator can stop calling them errors. */
    readonly aliases: readonly (readonly [string, string])[];
    /**
     * Items this project invented, by uniqueId.
     *
     * Badged in the UI and named in the export manifest. Nobody should hand a `.bin` to a third
     * party who then opens it in TunerPro and finds a table their definition has never heard of,
     * with no way to tell it came from here.
     */
    readonly added: ReadonlySet<string>;
}

const FILES: Record<DefinitionVariant, string> = {
    'partial-24k': '/xdf/Siemens_SMG_II_510_24K.xdf',
    'full-512k': '/xdf/Siemens_SMG_II_510_512K.xdf',
};

/** The lengths each variant is written for. Anything else is a file we should not guess about. */
export function variantForLength(byteLength: number): DefinitionVariant | null {
    if (byteLength === CALIBRATION_WINDOW.length) return 'partial-24k';
    if (byteLength === FULL_IMAGE_LENGTH) return 'full-512k';
    return null;
}

export function describeUnknownLength(byteLength: number): string {
    return `This image is ${byteLength.toLocaleString()} bytes. The MS4X definition is written for ` +
        `${CALIBRATION_WINDOW.length.toLocaleString()} (the 0x32000 calibration window) or ` +
        `${FULL_IMAGE_LENGTH.toLocaleString()} (the full flash). Loading it against either would ` +
        `put every address somewhere it was not meant to point.`;
}

const cache = new Map<DefinitionVariant, Promise<LoadedDefinition>>();

export function loadDefinition(variant: DefinitionVariant): Promise<LoadedDefinition> {
    const cached = cache.get(variant);
    if (cached) return cached;

    const file = FILES[variant];
    const promise = fetch(file)
        .then(async response => {
            if (!response.ok) throw new Error(`${file} could not be loaded (HTTP ${response.status})`);
            const source = await response.text();
            // The overlay is applied HERE, once, so nothing downstream can read the uncorrected
            // definition by accident. It throws if a `was:` no longer matches — a loud failure
            // naming the entry, rather than a silent mis-correction of a repaired file.
            const overlaid = applyOverlay(parseXdf(source), SMG2_OVERLAY);
            const definition = overlaid.definition;
            const imageLength = variant === 'partial-24k' ? CALIBRATION_WINDOW.length : FULL_IMAGE_LENGTH;
            const aliasKeys = new Set(overlaid.aliases.map(([a, b]) => [a, b].sort().join('|')));
            return {
                variant,
                file,
                definition,
                source,
                catalogVersion: CATALOG_VERSION,
                added: overlaid.added,
                notes: overlaid.notes,
                aliases: overlaid.aliases,
                // An overlap the catalog has declared deliberate is not an error. Leaving it red
                // teaches the reader to skip the findings list, which is where the real ones are.
                findings: validateXdf(definition, { imageLength, source }).filter(f => {
                    if (f.kind !== 'value-overlap' || f.items.length !== 2) return true;
                    return !aliasKeys.has([...f.items].sort().join('|'));
                }),
            };
        });

    cache.set(variant, promise);
    return promise;
}
