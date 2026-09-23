/**
 * BMW DS2 framing primitives. Pure — nothing here touches a port.
 *
 * Frame layout: [Address][Length][ControlOrStatus][Payload...][XOR checksum]
 * Length counts the WHOLE frame (Address + Length + Control + Payload +
 * Checksum), minimum 4 bytes.
 *
 * Ported from the MSS54HP CSL Convert Tuner's ds2.ts, which in turn came from
 * the reference Mss54Ds2Tool (Ds2Frame.cs, Ds2Checksum.cs). Split out of that
 * file here because the tuner's version mixes universal DS2 with MSS54HP
 * product decisions (flash layout, tune masks) that a diagnostic app has no
 * business importing.
 */

import { Ds2Error } from './errors';

/**
 * DS2 slave addresses for the E46 M3 modules this project speaks to.
 *
 * The tuner hardcoded 0x12 throughout because it only ever talks to the DME.
 * Everything else in this package takes the address as a parameter — an address
 * baked into a "pure" helper is exactly the coupling that stops the same codec
 * serving three modules.
 */
export const Ds2Address = {
    /** MSS54 / MSS54HP engine DME */
    DME: 0x12,
    /** SMG II gearbox */
    SMG: 0x32,
    /**
     * DSC. Early cars answer here as ASCMK20, late ones as DSC_E46 — one
     * address, two SGBDs, never both fitted (`docs/FITMENT.md`).
     *
     * NOT MK60. `DSC_MK60.prg` is a different ECU on a different protocol:
     * its IDENT is KWP2000 to 0xB8, so a DS2 tool cannot reach it at all.
     */
    DSC: 0x56,
} as const;

export type Ds2AddressValue = (typeof Ds2Address)[keyof typeof Ds2Address];

/** Smallest legal frame: address + length + control + checksum. */
export const DS2_MIN_FRAME_LENGTH = 4;
/** The length byte is one byte, so a frame cannot exceed this. */
export const DS2_MAX_FRAME_LENGTH = 255;

export const Ds2Control = {
    READ_ERROR_MEMORY: 0x04,
    CLEAR_ERROR_MEMORY: 0x05,
    READ_MEMORY: 0x06,
    WRITE_MEMORY: 0x07,
    READ_IO_STATUS: 0x0b,
    SET_IO_STATUS: 0x0c,
    QUERY_ENCODING_CHECKSUM: 0x0a,
    READ_SYSTEM_ADDRESSES: 0x0d,
    REBOOT: 0x12,
    /**
     * Clear adaptations. Payload is [mask1] when mask2 is 0, else [mask1, mask2].
     *
     * OVERLOADED on the MSS54: payload `00 01` is not a clear at all — it starts
     * VANOS diagnostic idle mode. Any ECU-specific layer building a 0x43 payload
     * must reject mask2 bit 0; see the tuner's buildClearAdaptationsPayload.
     */
    CLEAR_ADAPTATIONS: 0x43,
    READ_SHADOW_ERROR_MEMORY: 0x14,
    REQUEST_LOGIN_SEED: 0x90,
    SEND_LOGIN_KEY: 0x90,
    REQUEST_BAUD_SWITCH: 0x91,
    KEEP_ALIVE: 0x9e,
    END_DIAGNOSTIC_MODE: 0x9f,
} as const;

export const Ds2Status = {
    ACKNOWLEDGE: 0xa0,
    BUSY: 0xa1,
    REJECTED: 0xa2,
    PARAMETER_ERROR: 0xb0,
    FUNCTION_ERROR: 0xb1,
    NOT_ACKNOWLEDGE: 0xff,
} as const;

/**
 * A negative status is a fact about the device, not a transport failure, and it
 * must never be retried — the ECU received the request, considered it, and said
 * no. Log the numeric code verbatim: "rejected (status 0xB0)" is a fact,
 * "rejected" is not.
 */
export function describeStatus(status: number): string {
    switch (status) {
        case Ds2Status.ACKNOWLEDGE:
            return 'acknowledged';
        case Ds2Status.BUSY:
            return 'busy';
        case Ds2Status.REJECTED:
            return 'rejected';
        case Ds2Status.PARAMETER_ERROR:
            return 'parameter error (the ECU does not implement this value)';
        case Ds2Status.FUNCTION_ERROR:
            return 'function error';
        case Ds2Status.NOT_ACKNOWLEDGE:
            return 'not acknowledged';
        default:
            return `unknown status 0x${status.toString(16).padStart(2, '0')}`;
    }
}

export function ds2Checksum(bytes: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum ^= bytes[i];
    return sum & 0xff;
}

export interface Ds2Frame {
    address: number;
    length: number;
    controlOrStatus: number;
    payload: Uint8Array;
    checksum: number;
}

export function buildDs2Frame(
    address: number,
    controlByte: number,
    payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
    const length = DS2_MIN_FRAME_LENGTH + payload.length;
    if (length > DS2_MAX_FRAME_LENGTH) {
        throw new Ds2Error('FRAME_TOO_LONG', `DS2 frame too long: ${length} bytes`, {
            detail: { length, max: DS2_MAX_FRAME_LENGTH },
        });
    }
    const frame = new Uint8Array(length);
    frame[0] = address;
    frame[1] = length;
    frame[2] = controlByte;
    frame.set(payload, 3);
    frame[length - 1] = ds2Checksum(frame.subarray(0, length - 1));
    return frame;
}

/**
 * Parses and validates a complete frame.
 *
 * Note what this does NOT do: it does not check that `bytes.length` agrees with
 * the declared length byte, because the caller has already read exactly that
 * many bytes (the length byte is what told it how many to read). What it does
 * check is the declared length itself — the tuner's version trusted `bytes[1]`
 * implicitly, and a length of 0, 1 or 2 would sail through, producing a garbage
 * payload from `subarray(3, length - 1)` rather than an error.
 */
export function parseDs2Frame(bytes: Uint8Array): Ds2Frame {
    if (bytes.length < DS2_MIN_FRAME_LENGTH) {
        throw new Ds2Error(
            'FRAME_TOO_SHORT',
            `Invalid DS2 frame: ${bytes.length} bytes (minimum ${DS2_MIN_FRAME_LENGTH})`,
            { detail: { received: bytes.length, minimum: DS2_MIN_FRAME_LENGTH } },
        );
    }
    const declaredLength = bytes[1];
    if (declaredLength < DS2_MIN_FRAME_LENGTH) {
        throw new Ds2Error(
            'FRAME_LENGTH_INVALID',
            `Invalid DS2 length byte ${declaredLength} (minimum ${DS2_MIN_FRAME_LENGTH})`,
            { detail: { declaredLength, minimum: DS2_MIN_FRAME_LENGTH } },
        );
    }
    const checksum = bytes[bytes.length - 1];
    const calculated = ds2Checksum(bytes.subarray(0, bytes.length - 1));
    if (checksum !== calculated) {
        throw new Ds2Error(
            'CHECKSUM_MISMATCH',
            `Invalid DS2 checksum: expected 0x${calculated.toString(16)}, got 0x${checksum.toString(16)}`,
            { detail: { expected: calculated, got: checksum } },
        );
    }
    return {
        address: bytes[0],
        length: declaredLength,
        controlOrStatus: bytes[2],
        payload: bytes.subarray(3, bytes.length - 1),
        checksum,
    };
}

export function isPositiveResponse(frame: Ds2Frame): boolean {
    return frame.controlOrStatus === Ds2Status.ACKNOWLEDGE;
}

/** Reconstructs the raw bytes [Address][Length][Control][Payload...][Checksum]. */
export function frameToBytes(frame: Ds2Frame): Uint8Array {
    const bytes = new Uint8Array(frame.length);
    bytes[0] = frame.address;
    bytes[1] = frame.length;
    bytes[2] = frame.controlOrStatus;
    bytes.set(frame.payload, 3);
    bytes[frame.length - 1] = frame.checksum;
    return bytes;
}

export function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}
