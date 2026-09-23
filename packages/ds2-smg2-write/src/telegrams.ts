/**
 * The programming telegrams, transcribed from BMW's own SGBD.
 *
 * Every byte below came out of `C:\EDIABAS\ECU\SMG2.prg` — 535,906 bytes of BEST/2, disassembled
 * to 61,272 lines. They are not derived from the MSS54 implementation next door, and they are not
 * inferred from a capture. They are the constants EDIABAS itself moves into the send buffer.
 * `docs/smg2-write-protocol.md` records the extraction, including which byte of `BINAER_BUFFER`
 * lands in which byte of the telegram.
 *
 * ## The shape
 *
 *     32   09   07   xx   A2   A1   A0   --   CS
 *     |    |    |    |    \____________/       \__ appended by the transport
 *     |    |    |    |     24-bit address, MSB first
 *     |    |    |    subfunction: 06 erase, 02 write, 0F finish
 *     |    |    service 0x07
 *     |    total length including address, length and checksum
 *     ECU address
 *
 * ## What this module refuses to do
 *
 * It builds bytes. It does not send them, and it has no access to a transport. Sending is
 * `flash.ts`, which cannot be reached without a `FlashAuthorisation` that `preflight.ts` will not
 * currently issue — see the note there. Splitting it this way means the telegram shapes can be
 * tested exhaustively, today, without any part of the program being able to reach a car.
 */

/** The SMG II's DS2 address. Same value the read path uses. */
export const ECU_ADDRESS = 0x32;

/** Service and subfunctions, exactly as the SGBD spells them. */
export const SERVICE_PROGRAM = 0x07;
export const SUB_ERASE = 0x06;
export const SUB_WRITE = 0x02;
export const SUB_FINISH = 0x0f;

/** The other services the sequence needs, from the same source. */
export const SERVICE_RESET = 0x12;
export const SERVICE_BLOCK_LENGTH = 0x0d;
export const SERVICE_SEED = 0x90;
export const SERVICE_BAUD = 0x91;

/**
 * Interface timeouts, per operation.
 *
 * These differ, and the difference matters. Every job sets `1000 / 50 / 20`, but `FLASH_LOESCHEN`
 * replaces it with `0 / 100 / 20` for the erase itself. Sending an erase under the ordinary
 * timeout would time out on a *successful* erase — and the natural response to a timeout is a
 * retry, which for an erase is not a retry but a second erase.
 */
export const TIMEOUTS = {
    normal: { first: 1000, inter: 50, retries: 20 },
    erase: { first: 0, inter: 100, retries: 20 },
    erasePoll: { first: 500, inter: 25, retries: 20 },
} as const;

/** `42 4D 57` — the SGBD sends the three letters. */
export const SEED_MAGIC = Uint8Array.of(0x42, 0x4d, 0x57);

function frame(...payload: number[]): Uint8Array {
    // Length counts the address byte, the length byte, the payload and the checksum.
    const out = new Uint8Array(payload.length + 3);
    out[0] = ECU_ADDRESS;
    out[1] = out.length;
    out.set(payload, 2);
    out[out.length - 1] = out.slice(0, -1).reduce((a, b) => a ^ b, 0);
    return out;
}

function addressBytes(at: number): [number, number, number] {
    if (!Number.isInteger(at) || at < 0 || at > 0xffffff) {
        throw new RangeError(`address out of range: ${at}`);
    }
    return [(at >> 16) & 0xff, (at >> 8) & 0xff, at & 0xff];
}

/**
 * Erase, starting at `at`.
 *
 * **There is no length.** The SGBD's telegram carries three address bytes and nothing else, which
 * means the granularity is not ours to choose — the ECU erases whatever unit contains this
 * address. That is the single most important fact in this file, and it is why `preflight.ts`
 * will not authorise a write: a caller that does not know what a byte range will take with it
 * cannot state the consequence, and stating the consequence is the requirement.
 */
export function eraseTelegram(at: number): Uint8Array {
    return frame(SERVICE_PROGRAM, SUB_ERASE, ...addressBytes(at), 0x00);
}

/** Write `data` at `at`. The SGBD carries the length in the frame's own length byte. */
export function writeTelegram(at: number, data: Uint8Array): Uint8Array {
    if (data.length === 0) throw new RangeError('refusing to build an empty write');
    if (data.length > 0xff - 8) throw new RangeError(`payload too long for one frame: ${data.length}`);
    return frame(SERVICE_PROGRAM, SUB_WRITE, ...addressBytes(at), 0x00, ...data);
}

/** Close the segment that was opened at `at`. */
export function finishTelegram(at: number): Uint8Array {
    return frame(SERVICE_PROGRAM, SUB_FINISH, ...addressBytes(at), 0x00);
}

export function resetTelegram(): Uint8Array {
    return frame(SERVICE_RESET);
}

export function maxBlockLengthTelegram(): Uint8Array {
    return frame(SERVICE_BLOCK_LENGTH);
}

export function seedTelegram(): Uint8Array {
    return frame(SERVICE_SEED, ...SEED_MAGIC, 0x05);
}

/**
 * Ask the ECU to change baud rate.
 *
 * The SGBD's constant is `32 08 91 00 25 80 03`, and `00 25 80` read big-endian is 0x2580 = 9600
 * — the rate it is leaving. The trailing `03` is not identified; `docs/smg2-write-protocol.md`
 * lists it among the four things still open. This builder therefore takes the field as a number
 * and does not pretend to know what `03` selects.
 */
export function baudTelegram(baud: number, trailing: number): Uint8Array {
    if (!Number.isInteger(baud) || baud < 0 || baud > 0xffffff) throw new RangeError(`baud out of range: ${baud}`);
    return frame(SERVICE_BAUD, ...addressBytes(baud), trailing);
}

/** 125,000 — the rate `SET_EDIC_BAUDRATE` names, as the 32-bit little-endian `48 E8 01 00`. */
export const FAST_BAUD = 125000;
