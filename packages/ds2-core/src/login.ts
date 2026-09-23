/**
 * DS2 seed/key security access (control 0x90).
 *
 * Ported exactly from the MSS54HP CSL Convert Tuner's calculateLoginKey, which
 * came from the reference Mss54SeedKeyCalculator.CalculateKey.
 *
 * The algorithm is kept in the core package because the exchange shape — request
 * seed, receive a 46-byte frame or a 5-byte "already unlocked", compute, send
 * the key — is the same DS2 mechanism on every module. Whether the *key
 * derivation* below is identical on SMG and DSC has NOT been established. Until
 * a module has been proven on hardware, treat this as MSS54-verified only; see
 * the verified-ledger discipline in the plan (§4-1).
 */

import { Ds2Error } from './errors';
import { isPositiveResponse, type Ds2Frame } from './frame';

/** The access level the tuner uses, and the only one proven on a real DME. */
export const DS2_DEFAULT_ACCESS_LEVEL = 5;

/** Length of a genuine seed response frame. */
export const DS2_SEED_FRAME_LENGTH = 46;
/** Length of the positive response that means "this session is already unlocked". */
export const DS2_ALREADY_UNLOCKED_LENGTH = 5;

/**
 * Computes the login key from a seed response.
 *
 * `seedFrameBytes` is the WHOLE 46-byte frame, not just its payload — the
 * algorithm indexes byte 1 (the length byte) as the modulus and reads absolute
 * offsets 18..21 and 41..44. Passing a payload instead of a frame produces a
 * plausible-looking wrong key.
 */
export function calculateLoginKey(accessLevel: number, seedFrameBytes: Uint8Array): number {
    if (seedFrameBytes.length !== DS2_SEED_FRAME_LENGTH) {
        throw new Ds2Error(
            'SEED_LENGTH_INVALID',
            `Expected a ${DS2_SEED_FRAME_LENGTH}-byte seed response, got ${seedFrameBytes.length} bytes`,
            { detail: { expected: DS2_SEED_FRAME_LENGTH, got: seedFrameBytes.length } },
        );
    }
    let key = 0;
    for (let i = 0; i < 4; i++) {
        const idx = (accessLevel + i) % seedFrameBytes[1];
        const term = seedFrameBytes[idx] + seedFrameBytes[18 + i] + seedFrameBytes[41 + i];
        key = ((key << 8) | (term & 0xff)) >>> 0;
    }
    return key;
}

/** ASCII "BMW" followed by the access level byte. */
export function buildSeedRequestPayload(accessLevel: number = DS2_DEFAULT_ACCESS_LEVEL): Uint8Array {
    return new Uint8Array([0x42, 0x4d, 0x57, accessLevel]);
}

export function buildKeyPayload(key: number): Uint8Array {
    return new Uint8Array([
        (key >>> 24) & 0xff,
        (key >>> 16) & 0xff,
        (key >>> 8) & 0xff,
        key & 0xff,
    ]);
}

/** A positive login response of length 5 means the session was already unlocked (no seed needed). */
export function isAlreadyUnlockedResponse(frame: Ds2Frame): boolean {
    return isPositiveResponse(frame) && frame.length === DS2_ALREADY_UNLOCKED_LENGTH;
}

/** A positive login response of length 46 is a genuine seed to compute a key from. */
export function isSeedResponse(frame: Ds2Frame): boolean {
    return isPositiveResponse(frame) && frame.length === DS2_SEED_FRAME_LENGTH;
}
