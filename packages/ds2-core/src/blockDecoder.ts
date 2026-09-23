/**
 * Shared field decoding for DS2 data blocks. Ported from the MSS54HP CSL
 * Convert Tuner, which took it from the reference Mss54Ds2Tool
 * (DmeLiveValueDecoder.cs, DmeAdaptationDecoder.cs).
 *
 * The reference has two field-format enums — DmeLiveValueFieldFormat (live
 * values) and DmeAdaptationFieldFormat (adaptations) — but they decode
 * identically, and the adaptation set is a strict subset of the live one. In
 * particular the reference's adaptation `Int8` and its live-value `Int7` are
 * both `(sbyte)data[0]`; `int7` below covers both. So one decoder serves every
 * block family: each ECU layer owns its field tables and shares this.
 */

export type FieldFormat = 'int7' | 'uint8' | 'uint10' | 'int15' | 'uint16' | 'int31' | 'uint32';

export interface FieldDef {
    /** The ECU's own symbol for this value (e.g. 'n', 'tmot'), for traceability back to the SGBD. */
    symbol: string;
    offset: number;
    format: FieldFormat;
    scale: number;
    add: number;
}

export function byteLength(format: FieldFormat): number {
    switch (format) {
        case 'int7':
        case 'uint8':
            return 1;
        case 'uint10':
        case 'int15':
        case 'uint16':
            return 2;
        case 'int31':
        case 'uint32':
            return 4;
    }
}

export function readRaw(bytes: Uint8Array, format: FieldFormat): number {
    switch (format) {
        case 'int7':
            return (bytes[0] << 24) >> 24; // sign-extend int8
        case 'uint8':
            return bytes[0];
        case 'uint10':
        case 'uint16':
            return (bytes[0] << 8) | bytes[1];
        case 'int15':
            return (((bytes[0] << 8) | bytes[1]) << 16) >> 16; // sign-extend int16
        case 'uint32':
            return (
                ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
            );
        case 'int31':
            return (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    }
}

/**
 * Returns null when the payload is too short to hold this field — a real case,
 * since a block's length varies by ECU software version.
 *
 * Callers MUST distinguish null from a decoded 0. A short-but-checksum-valid
 * response otherwise produces a whole table of dashes with nothing naming the
 * cause; see minPayloadLength below for how to catch it once, up front.
 */
export function decodeField(payload: Uint8Array, field: FieldDef): number | null {
    const len = byteLength(field.format);
    if (field.offset < 0 || field.offset + len > payload.length) return null;
    const raw = readRaw(payload.subarray(field.offset, field.offset + len), field.format);
    return field.add + raw * field.scale;
}

/**
 * The shortest payload that can satisfy every field in a table.
 *
 * Validate a block against THIS, not against a documented block length.
 * Reference documentation is routinely self-contradictory — in the reference
 * implementation one block declared 83 bytes while its own field table ran to
 * offset 92. An equality check against a number that may be stale rejects
 * responses the ECU is entitled to send; this fails only in the case that
 * currently produces silent nulls.
 */
export function minPayloadLength(fields: readonly FieldDef[]): number {
    return fields.reduce((m, f) => Math.max(m, f.offset + byteLength(f.format)), 0);
}
