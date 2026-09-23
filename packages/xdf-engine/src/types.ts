/**
 * The XDF object model.
 *
 * Addresses in this model are **XDF addresses** — the absolute addresses the definition
 * itself uses, which for the SMG2 pair are positions inside the 512 KiB image. Turning one
 * into an offset inside whichever file you loaded is `XdfDefinition.fileOffsetOf()`, and it is
 * the only place BASEOFFSET is applied. Keeping the two apart is what lets one definition serve
 * both the 512 KiB dump and the 24 KiB partial without a second copy of every address.
 */

import type { XdfScaling } from './math';

/** Element width in bits. 32-bit exists in the format; widen `readRaw` at the same time as this. */
export type XdfWidth = 8 | 16 | 32;

/**
 * `mmedtypeflags` bit meanings.
 *
 * These are not documented by TunerPro in a way worth trusting, so they were established by
 * comparing two definitions whose ECUs have known byte order:
 *
 *   MSS54HP CSL 0401 (Motorola CPU32, big-endian): flags are only absent or 0x01, and 0x01
 *     appears on 8-bit items too — so 0x01 cannot be an endianness bit. It is SIGNED.
 *   Siemens SMG2 510: 0x02 and 0x03 appear on 16-bit items and *never* on 8-bit items, where
 *     byte order has no meaning. So 0x02 is LSB-FIRST, and the SMG2 calibration is little-endian.
 *
 * The 32 items carrying 0x03 in SMG2 510 are exactly the ones that need a sign (speed-difference
 * offsets, lateral-acceleration thresholds, throttle-difference min/max), which is the
 * independent check on reading 0x01 as "signed".
 */
export const XdfTypeFlag = {
    SIGNED: 0x01,
    LSB_FIRST: 0x02,
} as const;

/** One contiguous run of same-width numbers: a constant, an axis, or a value grid. */
export interface XdfEmbedded {
    /** XDF address, or null for an axis that carries only labels. */
    readonly address: number | null;
    readonly bits: XdfWidth;
    readonly signed: boolean;
    readonly lsbFirst: boolean;
    readonly rows: number;
    readonly cols: number;
    /** Bit stride between rows; 0 means packed. Negative marks a label-only axis. */
    readonly majorStrideBits: number;
    /** Bit stride between columns; 0 means packed. */
    readonly minorStrideBits: number;
    /** The attribute as written, so an unexpected bit can be reported rather than swallowed. */
    readonly typeFlagsRaw: number;
}

export interface XdfAxis {
    readonly id: 'x' | 'y' | 'z';
    readonly indexCount: number;
    readonly data: XdfEmbedded;
    /**
     * `<LABEL>` values, in index order, when the definition supplies them. An axis with labels
     * and no address is a naming device, not data — `Gear Ratios` labels its x axis
     * Neutral/1..6/Rear and stores nothing.
     */
    readonly labels: readonly string[] | null;
    /**
     * Indices the definition supplied no <LABEL> for at all.
     *
     * Distinct from a label whose `value` is the empty string, which is how single-row tables in
     * this definition deliberately leave their row heading blank. Conflating the two produced
     * seven warnings about perfectly good tables, and seven false warnings is how a validator
     * teaches its reader to skip the list.
     */
    readonly labelHoles: readonly number[];
    readonly units: string | null;
    readonly decimals: number | null;
    /**
     * TunerPro's display-radix flag, verbatim.
     *
     * 3 means hexadecimal, and in this definition it marks exactly the four items whose value is
     * a bit pattern rather than a number: `Checksum`, `RACESTART: Clutch Config`, `CFG: Logic`
     * and `CFG: Lever Plus/Minus`. It is the author's own signal and the parser used to drop it,
     * so a 16-bit logic register rendered as "65535".
     *
     * It says how to DISPLAY a value, never what the bits mean — three of those four are
     * documented bitfields and one is a checksum. Meaning stays with the catalog.
     */
    readonly outputType: number | null;
    readonly scaling: XdfScaling;
}

interface XdfItemBase {
    /** `uniqueid` from the file. Stable across edits of the definition; the key we key UI state on. */
    readonly uniqueId: string;
    readonly title: string;
    readonly description: string | null;
    /** Resolved category names, already corrected for the 1-based `CATEGORYMEM category` attribute. */
    readonly categories: readonly string[];
}

export interface XdfConstant extends XdfItemBase {
    readonly kind: 'constant';
    readonly data: XdfEmbedded;
    readonly units: string | null;
    readonly decimals: number | null;
    /** See `XdfAxis.outputType`. 3 = hexadecimal. */
    readonly outputType: number | null;
    readonly scaling: XdfScaling;
}

export interface XdfTable extends XdfItemBase {
    readonly kind: 'table';
    readonly x: XdfAxis | null;
    readonly y: XdfAxis | null;
    readonly z: XdfAxis;
}

export type XdfItem = XdfConstant | XdfTable;

export interface XdfRegion {
    readonly name: string;
    readonly description: string | null;
    readonly startAddress: number;
    readonly size: number;
}

export interface XdfHeader {
    readonly title: string;
    readonly description: string | null;
    readonly author: string | null;
    readonly fileVersion: string | null;
    /**
     * BASEOFFSET. `subtract` true means the file offset is the XDF address MINUS `offset`;
     * this is how the 24 KiB partial definition (offset 204800 = 0x32000, subtract 1) maps the
     * same absolute addresses onto a dump that starts at 0x32000.
     */
    readonly baseOffset: { readonly offset: number; readonly subtract: boolean };
    readonly defaults: {
        readonly bits: XdfWidth;
        readonly signed: boolean;
        readonly lsbFirst: boolean;
    };
    readonly regions: readonly XdfRegion[];
    /** Category names by their zero-based index, as declared. */
    readonly categories: readonly string[];
}

export interface XdfDefinition {
    readonly header: XdfHeader;
    readonly items: readonly XdfItem[];
    /** Map an XDF address to an offset in the loaded image. The only user of BASEOFFSET. */
    fileOffsetOf(xdfAddress: number): number;
    /** Inverse of `fileOffsetOf`, for reporting a raw offset back in the definition's terms. */
    xdfAddressOf(fileOffset: number): number;
}
