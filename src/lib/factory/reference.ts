'use client';

/**
 * The reference an edit is measured against.
 *
 * Until now this app had exactly one image and nothing to compare it to, so "is this cell stock?"
 * was unanswerable and REVERT could only mean "back to the bytes I read". With BMW's own data on
 * disk there are five things a person can want to compare against:
 *
 *   BASE     the image as read           — what the ECU holds right now
 *   STOCK    Y7843259.0DA                — what the factory shipped for THIS assembly (ZB 7843255)
 *   7843252  Y7843256.0DA                — another factory calibration for the same hardware
 *   7843253  Y7843257.0DA
 *   7843254  Y7843258.0DA
 *
 * The last three are the reason this file exists at all. 602 bytes differ across the four, mostly
 * inside the AUTO shift-threshold family, so "what does BMW change when it wants a different shift
 * schedule" is answerable by reading rather than by guessing. That is a controlled four-way
 * comparison the factory already ran, sitting on disk, costing no vehicle time.
 *
 * Loading is lazy and failure is not an error: the factory files are BMW's and may simply not be
 * present. A missing reference means the comparison controls are unavailable, never that the app
 * is broken.
 */

import { FACTORY_VARIANTS, SUBJECT_VARIANT, factoryDataUrl, type FactoryVariant } from './catalogue';
import { overlayFactory, parseFactoryFile, type FactoryFile } from './ihex';

/** What a comparison is made against. `base` needs no file. */
export type ReferenceId = 'base' | `factory:${string}`;

export interface Reference {
    readonly id: ReferenceId;
    /** What the selector shows. STOCK for the subject's own factory data. */
    readonly label: string;
    /** A sentence for the reader: what this is and why they might pick it. */
    readonly note: string;
    readonly variant: FactoryVariant | null;
}

export const BASE_REFERENCE: Reference = {
    id: 'base',
    label: 'BASE',
    note: 'The image as it was read. REVERT always targets this.',
    variant: null,
};

export function referencesFor(): Reference[] {
    return [
        BASE_REFERENCE,
        ...FACTORY_VARIANTS.map((variant): Reference => ({
            id: `factory:${variant.dataNumber}`,
            label: variant.isSubject ? 'STOCK' : `ZB ${variant.zb}`,
            note: variant.isSubject
                ? `The factory calibration for this car's assembly (ZB ${variant.zb}). The dump ` +
                  `matches it byte for byte, so anything that differs from it is something you changed.`
                : `A different factory calibration for the same hardware. Useful for seeing what ` +
                  `BMW itself changed between assemblies.`,
            variant,
        })),
    ];
}

const cache = new Map<string, Promise<FactoryFile | null>>();

async function fetchVariant(variant: FactoryVariant): Promise<FactoryFile | null> {
    const url = factoryDataUrl(variant);
    const cached = cache.get(url);
    if (cached) return cached;

    const promise = fetch(url)
        .then(async response => {
            if (!response.ok) return null;
            // latin-1: the header carries "München" in cp1252 and a UTF-8 decode would mangle it.
            const buffer = await response.arrayBuffer();
            return parseFactoryFile(new TextDecoder('windows-1252').decode(buffer));
        })
        .catch(() => null);
    cache.set(url, promise);
    return promise;
}

/**
 * The bytes to compare against, laid over the image being edited.
 *
 * A `.0DA` is sparse — it programs 12,768 of the 24,032 addresses in its span — so it is overlaid
 * onto the base rather than used alone. Bytes the factory file does not program keep the values
 * the car has, which is correct: those bytes are not part of what the factory data defines, and
 * inventing 0xFF for them would make every unprogrammed byte look like a difference.
 */
export async function referenceImage(
    reference: Reference, base: Uint8Array, imageBase = 0,
): Promise<Uint8Array | null> {
    if (reference.id === 'base' || !reference.variant) return base;
    const file = await fetchVariant(reference.variant);
    if (!file) return null;
    return overlayFactory(base, file, imageBase).bytes;
}

/** Is the factory data actually present? Decides whether the comparison controls are offered. */
export async function factoryDataAvailable(): Promise<boolean> {
    return (await fetchVariant(SUBJECT_VARIANT)) !== null;
}
