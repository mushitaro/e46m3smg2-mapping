/**
 * PRACTICE mode: a simulated SMG II, driven through the real link.
 *
 * This exists so the connect -> probe -> read sequence can be rehearsed, and so the read loop can
 * be exercised, without a car. It is a simulated DEVICE — `WebSerialTransport`, `Ds2Link` and
 * `Smg2ReadLink` are the production classes, so framing, echo verification, retries and the
 * address probe are genuinely running. A mock of the link would prove only that the UI renders.
 *
 * **The bytes are invented.** No real SMG2 dump exists yet. Everything a practice run produces is
 * labelled PRACTICE — in the session, in the badge, and in the exported filename — because a
 * synthetic image that reaches a folder unmarked is indistinguishable from a real one six months
 * later, and someone will try to flash it.
 */

import { simulatedPort, type Ds2Frame, type SerialPortLike } from '@tsunagi/ds2-core';
import { Ds2Address, Ds2Control } from '@tsunagi/ds2-core';
import {
    CALIBRATION_WINDOW,
    FULL_IMAGE_LENGTH,
    IDENTITY_ANCHORS,
    correctChecksum,
} from '@tsunagi/ds2-smg2';

/** The reference car's identity, from the recorded EdiabasLib capture (ZB 7843260, HW 2F, SW 10). */
export const PRACTICE_IDENTITY = { zbNumber: '7843260', hardwareNumber: '2F', softwareNumber: '10' } as const;

/** The segment and base the practice device decodes at, so a test or the UI can check the probe. */
export const PRACTICE_SEGMENT = 0x00;
export const PRACTICE_BASE = 0x000000;

/**
 * Build a plausible-but-invented flash image.
 *
 * Calibration bytes are derived from position rather than left zero, so a chunking mistake shows
 * up as wrong numbers instead of as a tidy field of zeros that looks like an unmapped region.
 */
export function buildPracticeImage(): Uint8Array {
    const image = new Uint8Array(FULL_IMAGE_LENGTH);
    for (let i = 0; i < image.length; i++) image[i] = (i * 31 + (i >> 8)) & 0xff;

    const putAscii = (address: number, text: string, length: number) => {
        for (let i = 0; i < length; i++) image[address + i] = i < text.length ? text.charCodeAt(i) : 0x20;
    };
    /**
     * Identity, laid out where the CAR keeps it.
     *
     * This used to plant the ZB number into `ident0` and `ident1`, which was invented. The real
     * ECU keeps neither: measured in `5c5a0c857acd`, ident0 is "0549T05105100570" three times
     * and ident1 is a slice of the GETRAG banner — no assembly number in either. The ZB lives at
     * 0x2FF94, six times over, far outside the calibration window.
     *
     * That difference is not cosmetic. It made the simulator EASIER than the car in exactly the
     * place the probe is decided: practice confirmed the address space, the car could not, and
     * the gap was invisible because both "worked". A simulator that is kinder than the hardware
     * is worse than no simulator, because it converts a real defect into a passing run.
     */
    putAscii(0x2ff70, '0549T0510510'.repeat(3), 36);
    putAscii(0x2ff94, PRACTICE_IDENTITY.zbNumber.repeat(6), 42);
    putAscii(0x2ffbe, '--+', 3);
    putAscii(IDENTITY_ANCHORS.ident0.address, '0549T05105100570'.repeat(3), IDENTITY_ANCHORS.ident0.length);
    // The GETRAG banner at its real offset, and ident1 as the XDF's 21-bytes-late view of it.
    putAscii(0x37700,
        `GETRAG DATEN: ZB_622.0.0252.00-HW_622.0.0248.00-PR_622.P.B100.50-DT_622.P.B703.50---+`, 85);
    putAscii(0x37680,
        `ALLGEMEIN: VERSION_510_VON__GETRAG__FUER_E46_VOM_-15.04.09/13:55--  Version GETRAG: 10+--`, 89);

    // Plant a few values that decode to something a person can sanity-check on screen. If these
    // come out wrong, the codec is wrong — a check that costs nothing and catches an endianness
    // or stride mistake instantly.
    const putU16LE = (address: number, value: number) => {
        image[address] = value & 0xff;
        image[address + 1] = (value >> 8) & 0xff;
    };
    // Gear Ratios @0x33504, X/1024: a real E46 M3 six-speed, then reverse.
    const ratios = [0, 4.23, 2.53, 1.67, 1.23, 1.0, 0.83, 3.75];
    ratios.forEach((r, i) => putU16LE(0x33504 + i * 2, Math.round(r * 1024)));
    // Rear Differential Ratio @0x33514, X/10000.
    putU16LE(0x33514, Math.round(3.62 * 10000));
    // RPM Limit @0x36F42.
    putU16LE(0x36f42, 7900);

    /**
     * A checksum descriptor of the ECU's own shape, then a correct CRC over it.
     *
     * Without this the practice image reads as "no checksum descriptor" while a real car reads
     * "CRC OK" — the same class of divergence as planting the ZB number in the wrong place. The
     * layout is `{u16 stored, u16 blockCount, u32 start, u32 end}` and the range is the real
     * one, 0x320E0-0x378BF inclusive.
     */
    const putU32LE = (address: number, value: number) => {
        image[address] = value & 0xff;
        image[address + 1] = (value >>> 8) & 0xff;
        image[address + 2] = (value >>> 16) & 0xff;
        image[address + 3] = (value >>> 24) & 0xff;
    };
    putU16LE(0x32082, 1);
    putU32LE(0x32084, 0x320e0);
    putU32LE(0x32088, 0x378bf);
    const corrected = correctChecksum(image, 'calibration');
    if (corrected) image.set(corrected.bytes);

    return image;
}

/**
 * A `requestPort` for `WebSerialTransport` backed by the practice device.
 *
 * Only read controls are answered with data. Anything else gets a bare ACK, and since
 * `@tsunagi/ds2-smg2` refuses to compose a write telegram at all, nothing ever reaches that path.
 */
export function practiceRequestPort(image = buildPracticeImage()): {
    requestPort: () => Promise<SerialPortLike>;
    image: Uint8Array;
} {
    const { requestPort } = simulatedPort({
        address: Ds2Address.SMG,
        respond: (request: Ds2Frame) => {
            if (request.controlOrStatus === Ds2Control.READ_MEMORY) {
                const [segment, a2, a1, a0, count] = request.payload;
                const address = (a2 << 16) | (a1 << 8) | a0;
                if (segment !== PRACTICE_SEGMENT || address + count > image.length) {
                    // An unmapped decode reads as 0xFF, which is what the probe has to reject.
                    return { payload: new Uint8Array(count).fill(0xff) };
                }
                return { payload: image.subarray(address, address + count) };
            }
            if (request.controlOrStatus === 0x53) {
                return {
                    payload: new TextEncoder().encode(
                        `FEP ${PRACTICE_IDENTITY.zbNumber} SIEMENS ${PRACTICE_IDENTITY.hardwareNumber}`),
                };
            }
            return null;
        },
    });
    return { requestPort, image };
}

/** The window a practice read covers, matching what a real extraction would take. */
export const PRACTICE_WINDOW = CALIBRATION_WINDOW;
