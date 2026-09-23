/**
 * Which factory calibration belongs to which assembly number.
 *
 * `GDSMG2.DAT` in BMW's own programming data holds the mapping, and reading it corrected a
 * long-standing mistake in this project: **7843260 is the HARDWARE number, not the ZB.** It is
 * what the flash carries six times at 0x2FF94 and what EDIABAS IDENT reports, which is why it
 * was taken for the assembly number for months. The real ZBs are 7843252-7843255, and each pairs
 * with one of four data files:
 *
 *     ZB 7843252 -> 7843256DA      ZB 7843254 -> 7843258DA
 *     ZB 7843253 -> 7843257DA      ZB 7843255 -> 7843259DA
 *
 * That is four factory calibrations for one hardware, and 602 bytes differ between them —
 * concentrated in 0x35EA0-0x360D0, the middle of the AUTO shift-threshold family. So the "second
 * calibration for differential analysis" that both analysis documents named as the number-one
 * unresolved need is actually four, already on disk, needing no vehicle time at all.
 *
 * The `.0DA` files are large and are not bundled into the app. They are read from disk by the
 * tests and by the tooling; the UI loads them from `public/factory/` when they have been placed
 * there. A missing file is a missing REFERENCE, never a broken app.
 */

export interface FactoryVariant {
    /** BMW assembly number — what a person means by "ZB". */
    readonly zb: string;
    /** The data file's own number, as it appears in `GDSMG2.DAT` and in the filename. */
    readonly dataNumber: string;
    readonly dataFile: string;
    /** True for the calibration this project's dump was read from. */
    readonly isSubject: boolean;
}

/** Hardware number shared by all four. Not a ZB, despite what IDENT calls it. */
export const HARDWARE_NUMBER = '7843260';

/** The program file, common to every variant. */
export const PROGRAM_FILE = '7843260K.0PA';

/**
 * The four assemblies, in `GDSMG2.DAT` order.
 *
 * `isSubject` marks 7843255 because dump `5c5a0c857acd` matches `Y7843259.0DA` at 12,768 of
 * 12,768 bytes — the car is calibration-stock, and this is the reference a REVERT-to-factory
 * would target.
 */
export const FACTORY_VARIANTS: readonly FactoryVariant[] = [
    { zb: '7843252', dataNumber: '7843256', dataFile: 'Y7843256.0DA', isSubject: false },
    { zb: '7843253', dataNumber: '7843257', dataFile: 'Y7843257.0DA', isSubject: false },
    { zb: '7843254', dataNumber: '7843258', dataFile: 'Y7843258.0DA', isSubject: false },
    { zb: '7843255', dataNumber: '7843259', dataFile: 'Y7843259.0DA', isSubject: true },
];

export const SUBJECT_VARIANT = FACTORY_VARIANTS.find(v => v.isSubject)!;

/**
 * The checksums BMW's own files declare, for cross-checking the algorithm derived from the flash.
 *
 * These are `;$CARB_MODE_9_CVN` values. Reproducing them from the file contents, with the block
 * ranges read out of the descriptor, is what turns "a CRC that fits our one dump" into "the CRC
 * this ECU family uses" — the fit and the confirmation come from independent sources.
 */
export const DECLARED_CHECKSUMS = {
    /** `Y7843259.0DA` — and the value the car stores at 0x32080. */
    calibrationSubject: 0x4c83,
    /** `7843260K.0PA` — and the value the car stores at 0x0C136. */
    program: 0x2660,
} as const;

/** Where the UI looks for factory data, when it has been placed there. */
export const FACTORY_PUBLIC_DIR = '/factory';

export function factoryDataUrl(variant: FactoryVariant): string {
    return `${FACTORY_PUBLIC_DIR}/${variant.dataFile}`;
}
