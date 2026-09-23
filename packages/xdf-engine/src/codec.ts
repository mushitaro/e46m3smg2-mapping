/**
 * Reading and writing values through an XDF definition.
 *
 * Endianness and signedness come from the definition on every access. Nothing here assumes a
 * byte order, because the two definitions this engine has to serve disagree about it: MSS54HP
 * is big-endian and SMG2 510 is little-endian. A parser with a baked-in order is the reason the
 * DME tuner's `BinaryParser` cannot be reused for this ECU.
 *
 * Raw values are carried alongside physical ones everywhere. Raw is what is actually in the
 * bytes; a later correction to a `<MATH>` equation should re-label an old reading, not falsify it.
 */

import type { XdfScaling } from './math';
import type { XdfAxis, XdfDefinition, XdfEmbedded, XdfItem, XdfWidth } from './types';

export class XdfCodecError extends Error {
    constructor(message: string) { super(message); this.name = 'XdfCodecError'; }
}

/** A run's shape once strides are resolved. Bits are converted to bytes here, or we refuse. */
export interface RunLayout {
    readonly rows: number;
    readonly cols: number;
    readonly bytesPerElement: number;
    readonly colStrideBytes: number;
    readonly rowStrideBytes: number;
    /** Bytes from the first element's start to the end of the last. */
    readonly totalBytes: number;
}

function toBytes(bits: number, what: string): number {
    if (bits % 8 !== 0) {
        throw new XdfCodecError(`${what} is ${bits} bits, which is not a whole number of bytes; ` +
            `sub-byte packing is not supported`);
    }
    return bits / 8;
}

/**
 * Resolve a run's layout.
 *
 * `count` overrides rows*cols for an axis, which declares its length in `<indexcount>` rather
 * than on EMBEDDEDDATA. A stride of 0 means packed. A NEGATIVE major stride is TunerPro's marker
 * for an axis that carries labels instead of data; callers must check `address` first.
 */
export function layoutOf(data: XdfEmbedded, count?: number): RunLayout {
    const bytesPerElement = toBytes(data.bits, 'element size');
    const colStrideBytes = data.minorStrideBits !== 0
        ? toBytes(Math.abs(data.minorStrideBits), 'minor stride')
        : bytesPerElement;

    let rows: number;
    let cols: number;
    if (count !== undefined) {
        // An axis: one linear run of `count` elements. `mmedcolcount` may or may not repeat it.
        rows = 1;
        cols = count;
    } else {
        rows = Math.max(1, data.rows);
        cols = Math.max(1, data.cols);
    }

    const rowStrideBytes = data.majorStrideBits > 0 && count === undefined
        ? toBytes(data.majorStrideBits, 'major stride')
        : cols * colStrideBytes;

    const totalBytes = rows === 0 || cols === 0
        ? 0
        : (rows - 1) * rowStrideBytes + (cols - 1) * colStrideBytes + bytesPerElement;

    return { rows, cols, bytesPerElement, colStrideBytes, rowStrideBytes, totalBytes };
}

export function readRaw(
    image: Uint8Array, offset: number, bits: XdfWidth, signed: boolean, lsbFirst: boolean,
): number {
    const width = bits / 8;
    if (offset < 0 || offset + width > image.length) {
        throw new XdfCodecError(`read of ${width} byte(s) at 0x${offset.toString(16)} is outside the ` +
            `${image.length}-byte image`);
    }
    let value = 0;
    for (let i = 0; i < width; i++) {
        const byte = image[offset + (lsbFirst ? i : width - 1 - i)];
        value += byte * 2 ** (8 * i);
    }
    if (signed && value >= 2 ** (bits - 1)) value -= 2 ** bits;
    return value;
}

export function writeRaw(
    image: Uint8Array, offset: number, bits: XdfWidth, signed: boolean, lsbFirst: boolean, raw: number,
): void {
    const width = bits / 8;
    if (offset < 0 || offset + width > image.length) {
        throw new XdfCodecError(`write of ${width} byte(s) at 0x${offset.toString(16)} is outside the ` +
            `${image.length}-byte image`);
    }
    const { min, max } = signed
        ? { min: -(2 ** (bits - 1)), max: 2 ** (bits - 1) - 1 }
        : { min: 0, max: 2 ** bits - 1 };
    const rounded = Math.round(raw);
    if (!Number.isFinite(rounded) || rounded < min || rounded > max) {
        throw new XdfCodecError(`raw value ${raw} does not fit a ${signed ? 'signed' : 'unsigned'} ` +
            `${bits}-bit field (range ${min}..${max})`);
    }
    let value = rounded < 0 ? rounded + 2 ** bits : rounded;
    for (let i = 0; i < width; i++) {
        image[offset + (lsbFirst ? i : width - 1 - i)] = value % 256;
        value = Math.floor(value / 256);
    }
}

/** A byte range in FILE offsets, tagged with what occupies it. Used by the validator and coverage. */
export interface ByteSpan {
    readonly start: number;
    readonly end: number;
    readonly itemId: string;
    readonly itemTitle: string;
    /** 'value' for a constant or a z grid; 'axis-x'/'axis-y' for a table's breakpoints. */
    readonly role: 'value' | 'axis-x' | 'axis-y';
}

function axisCount(axis: XdfAxis): number | undefined {
    return axis.id === 'z' ? undefined : axis.indexCount;
}

/** Every byte range an item occupies. Label-only axes contribute nothing, because they store nothing. */
export function spansOf(def: XdfDefinition, item: XdfItem): readonly ByteSpan[] {
    const out: ByteSpan[] = [];
    const push = (data: XdfEmbedded, count: number | undefined, role: ByteSpan['role']) => {
        if (data.address === null) return;
        const start = def.fileOffsetOf(data.address);
        out.push({
            start,
            end: start + layoutOf(data, count).totalBytes,
            itemId: item.uniqueId,
            itemTitle: item.title,
            role,
        });
    };
    if (item.kind === 'constant') {
        push(item.data, undefined, 'value');
    } else {
        push(item.z.data, undefined, 'value');
        if (item.x) push(item.x.data, axisCount(item.x), 'axis-x');
        if (item.y) push(item.y.data, axisCount(item.y), 'axis-y');
    }
    return out;
}

export interface DecodedAxis {
    readonly labels: readonly string[] | null;
    readonly raw: readonly number[] | null;
    readonly values: readonly number[] | null;
    readonly units: string | null;
    readonly decimals: number | null;
}

export type DecodedItem =
    | {
        readonly kind: 'constant';
        readonly item: XdfItem;
        readonly raw: number;
        readonly value: number;
        readonly units: string | null;
    }
    | {
        readonly kind: 'table';
        readonly item: XdfItem;
        readonly rows: number;
        readonly cols: number;
        readonly raw: readonly (readonly number[])[];
        readonly values: readonly (readonly number[])[];
        readonly units: string | null;
        /**
         * How many decimal places the definition asks for on the VALUES.
         *
         * The axes have carried this since the parser was written; the table's own payload did
         * not, so a grid had no choice but to guess from the magnitude. A guess is wrong in the
         * one direction that matters: a threshold stored to 1/16 km/h rendered as an integer
         * looks like it cannot be adjusted more finely than 1 km/h.
         */
        readonly decimals: number | null;
        readonly x: DecodedAxis | null;
        readonly y: DecodedAxis | null;
    };

function decodeAxis(def: XdfDefinition, image: Uint8Array, axis: XdfAxis): DecodedAxis {
    if (axis.data.address === null) {
        return { labels: axis.labels, raw: null, values: null, units: axis.units, decimals: axis.decimals };
    }
    const base = def.fileOffsetOf(axis.data.address);
    const layout = layoutOf(axis.data, axisCount(axis));
    const raw: number[] = [];
    const values: number[] = [];
    for (let i = 0; i < layout.cols; i++) {
        const r = readRaw(image, base + i * layout.colStrideBytes, axis.data.bits, axis.data.signed, axis.data.lsbFirst);
        raw.push(r);
        values.push(axis.scaling.toPhysical(r));
    }
    return { labels: axis.labels, raw, values, units: axis.units, decimals: axis.decimals };
}

export function decodeItem(def: XdfDefinition, image: Uint8Array, item: XdfItem): DecodedItem {
    if (item.kind === 'constant') {
        if (item.data.address === null) throw new XdfCodecError(`constant "${item.title}" has no address`);
        const raw = readRaw(
            image, def.fileOffsetOf(item.data.address), item.data.bits, item.data.signed, item.data.lsbFirst);
        return { kind: 'constant', item, raw, value: item.scaling.toPhysical(raw), units: item.units };
    }

    const z = item.z;
    if (z.data.address === null) throw new XdfCodecError(`table "${item.title}" has no z address`);
    const base = def.fileOffsetOf(z.data.address);
    const layout = layoutOf(z.data);
    const raw: number[][] = [];
    const values: number[][] = [];
    for (let r = 0; r < layout.rows; r++) {
        const rawRow: number[] = [];
        const valueRow: number[] = [];
        for (let c = 0; c < layout.cols; c++) {
            const offset = base + r * layout.rowStrideBytes + c * layout.colStrideBytes;
            const v = readRaw(image, offset, z.data.bits, z.data.signed, z.data.lsbFirst);
            rawRow.push(v);
            valueRow.push(z.scaling.toPhysical(v));
        }
        raw.push(rawRow);
        values.push(valueRow);
    }
    return {
        kind: 'table',
        item,
        rows: layout.rows,
        cols: layout.cols,
        raw,
        values,
        units: z.units,
        decimals: z.decimals,
        x: item.x ? decodeAxis(def, image, item.x) : null,
        y: item.y ? decodeAxis(def, image, item.y) : null,
    };
}

/**
 * The write target of an item: a constant's own field, or a table's z payload.
 *
 * One helper because `encodeCell` and the run functions had started to spell it three ways, and
 * a constant that is silently treated as a 1x1 table is exactly the confusion that left all 56
 * constants uneditable while the code looked like it handled them.
 */
export function runTargetOf(item: XdfItem): { data: XdfEmbedded; scaling: XdfScaling } {
    return item.kind === 'constant'
        ? { data: item.data, scaling: item.scaling }
        : { data: item.z.data, scaling: item.z.scaling };
}

/**
 * Byte offset of every element of an item's run, in row-major order.
 *
 * The single place strides are turned into addresses. Everything that reads, writes, or reasons
 * about which bytes an edit touches goes through this, so a stride bug cannot show up in one of
 * those and not the others.
 */
export function offsetsOf(def: XdfDefinition, item: XdfItem): number[] {
    const { data } = runTargetOf(item);
    if (data.address === null) throw new XdfCodecError(`"${item.title}" has no address`);
    const layout = layoutOf(data);
    const base = def.fileOffsetOf(data.address);
    const out: number[] = [];
    for (let r = 0; r < layout.rows; r++) {
        for (let c = 0; c < layout.cols; c++) {
            out.push(base + r * layout.rowStrideBytes + c * layout.colStrideBytes);
        }
    }
    return out;
}

/**
 * Read an item's whole run as RAW values, row-major.
 *
 * Raw, not physical, because that is what an edit set has to hold: comparing a proposed edit
 * against the base in physical units is a float comparison, and a float comparison cannot tell
 * "the user typed the value it already had" from "the user typed something one LSB away".
 */
export function readRun(def: XdfDefinition, image: Uint8Array, item: XdfItem): number[] {
    const { data } = runTargetOf(item);
    return offsetsOf(def, item).map(
        offset => readRaw(image, offset, data.bits, data.signed, data.lsbFirst));
}

/**
 * Write an item's whole run from RAW values. Mutates `image`.
 *
 * Refuses a length mismatch rather than writing the prefix: a short run would leave the tail
 * holding the previous calibration's numbers, and the result would open, decode, and be wrong
 * only in the part nobody looked at.
 */
export function encodeRun(
    def: XdfDefinition, image: Uint8Array, item: XdfItem, raw: readonly number[],
): void {
    const { data } = runTargetOf(item);
    const offsets = offsetsOf(def, item);
    if (raw.length !== offsets.length) {
        throw new XdfCodecError(
            `"${item.title}" holds ${offsets.length} element(s) and ${raw.length} were given`);
    }
    offsets.forEach((offset, i) => writeRaw(image, offset, data.bits, data.signed, data.lsbFirst, raw[i]));
}

/** Write one cell of a table, or the value of a constant (row and col ignored). Mutates `image`. */
export function encodeCell(
    def: XdfDefinition, image: Uint8Array, item: XdfItem, physical: number, row = 0, col = 0,
): void {
    const target = item.kind === 'constant' ? item.data : item.z.data;
    const scaling = item.kind === 'constant' ? item.scaling : item.z.scaling;
    if (target.address === null) throw new XdfCodecError(`"${item.title}" has no address to write to`);
    if (scaling.inverse === 'none') {
        throw new XdfCodecError(
            `"${item.title}" uses MATH ${JSON.stringify(scaling.math)}, which this engine cannot invert; ` +
            `the item is read-only`);
    }
    const layout = layoutOf(target, item.kind === 'constant' ? undefined : undefined);
    if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) {
        throw new XdfCodecError(`cell (${row}, ${col}) is outside "${item.title}" (${layout.rows}x${layout.cols})`);
    }
    const offset = def.fileOffsetOf(target.address) + row * layout.rowStrideBytes + col * layout.colStrideBytes;
    writeRaw(image, offset, target.bits, target.signed, target.lsbFirst, scaling.toRaw(physical));
}
