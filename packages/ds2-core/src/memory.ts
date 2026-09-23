/**
 * DS2 memory read/write payloads (controls 0x06 / 0x07) and programming
 * response parsing.
 *
 * The payload shapes are universal DS2. The *addresses and segments* they are
 * used with are not — those are per-ECU and belong in an ECU layer, never here.
 */

import { Ds2Error } from './errors';
import type { Ds2Frame } from './frame';

/**
 * The DS2 write count field caps here.
 *
 * Kept separate from any app's chunk-size constant on purpose. A chunk size and
 * this cap look like the same number and are bounded by different things: reads
 * are bounded only by framing, writes additionally need an even length at an
 * even address because flash programming is even-aligned. Sharing one constant
 * between the two is a latent brick — the read side can grow toward the framing
 * limit and silently take the write side with it, and the write path is the one
 * that erases first.
 */
export const DS2_MAX_WRITE_COUNT = 123;

export function buildReadMemoryPayload(
    segment: number,
    address24: number,
    count: number,
): Uint8Array {
    return new Uint8Array([
        segment,
        (address24 >>> 16) & 0xff,
        (address24 >>> 8) & 0xff,
        address24 & 0xff,
        count,
    ]);
}

export function buildWriteMemoryPayload(
    segment: number,
    address24: number,
    data: Uint8Array,
): Uint8Array {
    if (data.length > DS2_MAX_WRITE_COUNT) {
        throw new Ds2Error(
            'WRITE_COUNT_TOO_LARGE',
            `DS2 memory write count must be ${DS2_MAX_WRITE_COUNT} bytes or less, got ${data.length}`,
            { detail: { count: data.length, max: DS2_MAX_WRITE_COUNT } },
        );
    }
    const payload = new Uint8Array(5 + data.length);
    payload[0] = segment;
    payload[1] = (address24 >>> 16) & 0xff;
    payload[2] = (address24 >>> 8) & 0xff;
    payload[3] = address24 & 0xff;
    payload[4] = data.length;
    payload.set(data, 5);
    return payload;
}

/** Parsed DS2 write/programming response: [segment, addrHi, addrMid, addrLo, writtenCount, verifyByte]. */
export interface Ds2WriteResult {
    segment: number;
    nextAddress24: number;
    writtenCount: number;
    verifyByte: number;
}

/**
 * Parses a positive write/programming response payload.
 *
 * Some control responses (prepare / erase / finalize) legitimately return an
 * EMPTY payload — that is an acknowledgement, not a truncated frame, so this
 * returns null rather than throwing. A non-empty payload shorter than 6 bytes
 * is a genuine protocol error.
 */
export function parseWriteResult(frame: Ds2Frame): Ds2WriteResult | null {
    if (frame.payload.length === 0) return null;
    if (frame.payload.length < 6) {
        throw new Ds2Error(
            'PAYLOAD_TOO_SHORT',
            `DS2 write response payload is ${frame.payload.length} byte(s), expected 0 or at least 6`,
            { detail: { length: frame.payload.length, expected: '0 or >= 6' } },
        );
    }
    const p = frame.payload;
    return {
        segment: p[0],
        nextAddress24: (p[1] << 16) | (p[2] << 8) | p[3],
        writtenCount: p[4],
        verifyByte: p[5],
    };
}

/**
 * Meaning of a programming verify byte.
 *
 * Every one of these is a SEMANTIC failure: the ECU received the telegram,
 * attempted it, and reports what happened. None of them may be retried. Retry
 * belongs to transport failures only — re-sending after "cells were not erased"
 * papers over failing hardware and reports success. Structure the two apart by
 * running validation OUTSIDE the retry loop, rather than trying to classify
 * your way out of it.
 */
export function describeVerifyByte(verifyByte: number): string {
    switch (verifyByte) {
        case 1:
            return 'programming OK';
        case 2:
            return 'verify failed';
        case 3:
            return 'cells were not erased before programming attempt';
        case 4:
            return 'copying/backing up AIF not possible';
        case 5:
            return 'copying/backing up ZIF not possible';
        case 6:
            return 'boot-mode field management error; programming not possible';
        case 7:
            return 'program programming session active';
        case 8:
            return 'data programming session active';
        case 9:
            return 'hardware reference implausible';
        case 10:
            return 'program reference implausible';
        case 11:
            return 'program and hardware references do not match';
        case 12:
            return 'program incomplete';
        case 13:
            return 'data reference implausible';
        case 14:
            return 'program and data references do not match';
        case 15:
            return 'data incomplete';
        default:
            return `unknown verify byte 0x${verifyByte.toString(16)}`;
    }
}

/** Verify byte 1 is the only success. Everything else is a failure to report, not to retry. */
export function isVerifyByteOk(verifyByte: number): boolean {
    return verifyByte === 1;
}
