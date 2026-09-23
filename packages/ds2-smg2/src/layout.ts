/**
 * What is known about the SMG II ECU's memory, and — just as importantly — what is not.
 *
 * Everything in this file is either quoted from `C:\EDIABAS\ECU\SMG2.prg` (de-scrambled with
 * XOR 0xF7) or measured. Where the SGBD and the extracted job bytecode disagree, BOTH are
 * recorded and the disagreement is left open for the vehicle to settle, rather than being
 * resolved by picking the more convenient one.
 *
 * The SGBD's own telegram templates are STATIC extractions of literal byte sequences in the
 * BEST/2 bytecode — the address and count fields are patched at run time. So a template tells
 * you the SHAPE of a request reliably and its FIELD VALUES not at all.
 */

import { Ds2Address, Ds2Control } from '@tsunagi/ds2-core';

/** DS2 address of the gearbox ECU. Defined in ds2-core; re-exported so callers need one import. */
export const SMG2_ADDRESS = Ds2Address.SMG;

/**
 * The calibration window the MS4X "Siemens SMG2 510" definition describes, as offsets in the
 * full 512 KiB image.
 *
 * `0x32000` is the 24K definition's BASEOFFSET; `0x6000` is the smallest whole-KiB window that
 * contains every item (the outermost byte any item touches is 0x37FF0). The definition's own
 * REGION declares 0x8000, which is advisory and larger than anything it defines.
 */
export const CALIBRATION_WINDOW = {
    start: 0x32000,
    length: 0x6000,
    end: 0x38000,
} as const;

export const FULL_IMAGE_LENGTH = 0x80000;

/**
 * The whole flash, as a readable region.
 *
 * 4,370 telegrams at 120 bytes, roughly 18 minutes at 9600 — against 205 telegrams and about a
 * minute for the calibration window alone. Worth it for exactly two things the window cannot
 * answer: the program area is where the code that INDEXES these tables lives, and the stored
 * checksum at 0x32080 did not match any candidate computed over the window, which points at a
 * range outside it.
 */
export const FULL_IMAGE = {
    start: 0x00000,
    length: FULL_IMAGE_LENGTH,
    end: FULL_IMAGE_LENGTH,
} as const;

/** What a read covers. The window is a slice of the full image, at the same segment and base. */
export type ReadScope = 'window' | 'full';

export function regionFor(scope: ReadScope): { start: number; length: number } {
    return scope === 'full'
        ? { start: FULL_IMAGE.start, length: FULL_IMAGE.length }
        : { start: CALIBRATION_WINDOW.start, length: CALIBRATION_WINDOW.length };
}

/**
 * Anchors that make the address-space probe decisive rather than a guess.
 *
 * The definition places identity strings at fixed points inside the calibration window. A dump
 * taken from the right base shows the ECU's own part numbers there; a dump taken from the wrong
 * base does not. That turns "which segment and base address?" into a question with a yes/no
 * answer per candidate, which is the only kind of question worth putting to a car.
 */
export const IDENTITY_ANCHORS = {
    /**
     * Where the BMW assembly number actually lives.
     *
     * Measured in the first real 512 KiB dump (`5c5a0c857acd`, E46 M3, ZB 7843260):
     *
     *   0x2FF70  "0549T0510510" x3      36 bytes
     *   0x2FF94  "7843260"      x6      42 bytes   <- the ZB, six times
     *   0x2FFBE  "--+"
     *
     * This is the anchor the probe needs and did not have. `ident0` and `ident1` are the only
     * two the XDF names, they are the only two the probe read, and NEITHER contains the ZB —
     * so `scoreCandidate` could never take its decisive branch and the address space came back
     * `unconfirmed` on a correct read of a real car. The simulator hid it, because the practice
     * image planted the ZB at ident0/ident1, which is not where the car keeps it.
     *
     * Six repetitions is not redundancy for its own sake: a partially corrupted read still
     * matches, so the anchor stays decisive on a marginal cable.
     *
     * Whether 0x2FF94 holds across other SMG2 software versions is UNKNOWN — one image is one
     * image. It is an additional anchor, never the only one; a candidate that fails it can still
     * score on the others. It is read four bytes early and past the trailing "--+" for the same
     * reason: a small shift on another version still lands inside the window.
     *
     * 56 bytes, not the 80 that would also take in the "0549T0510510" prefix. The probe runs
     * BEFORE chunk-size negotiation, so every anchor read has to be a length any SMG2 will answer
     * unquestioned; a test pins the whole anchor set at 60 bytes or less.
     */
    zbBlock: { address: 0x2ff90, length: 56 },
    /** XDF item `IDENT1`, 60 bytes. Truncates the real string, which starts at 0x37700. */
    ident1: { address: 0x37715, length: 60 },
    /** XDF item `IDENT0`, 16 x 3 bytes: "0549T05105100570" three times. No ZB in it. */
    ident0: { address: 0x37fc0, length: 48 },
    /** XDF item `Checksum`, 16-bit, little-endian like every other 16-bit value in this ECU. */
    checksum: { address: 0x32080, length: 2 },
} as const;

/**
 * Candidate segment bytes for DS2 control 0x06.
 *
 * The SGBD contains BOTH of these and they disagree:
 *
 *   - the `SPEICHER` table maps every memory type to segment 0x00
 *       [["SPEICHER","WERT"],["FLASH","0x00"],["RAM","0x00"],["ROM","0x00"],["E2PROM","0x00"]]
 *     and the job comment says the SPEICHERART argument is accepted only for compatibility
 *     ("da laut Lastenh. keine Auswahl vorgesehen").
 *   - the extracted `SPEICHER_LESEN` template carries 0x01:
 *       32 09 06 01 00 00 00 21 1d
 *     while seven other read-memory jobs carry 0x00:
 *       32 09 06 00 00 00 00 02 3f
 *
 * A template's field values are patched at run time, so 0x01 may simply be whatever the
 * assembler emitted. Do not decide this from the files. Probe it (see `probe.ts`).
 */
export const CANDIDATE_SEGMENTS: readonly number[] = [0x00, 0x01];

/**
 * Candidate base addresses to try the calibration window at.
 *
 * `0x032000` is the definition's own view — plausible if the ECU's diagnostic address space is
 * flat over the flash. The others mirror the MSS54's `(subsegmentNibble << 20) | offset` scheme,
 * which is worth trying and is NOT assumed: that scheme encodes a master/slave split the MSS54
 * has and a single-processor SMG2 does not.
 */
export const CANDIDATE_BASES: readonly number[] = [
    0x000000, // flat: XDF address is the DS2 address
    0x100000, // nibble 1
    0x200000, // nibble 2 — MSS54's DataBlock
    0x500000, // nibble 5 — MSS54's ProgramBlock
    0xa00000, // nibble A — MSS54's slave DataBlock
];

/**
 * Controls this package is permitted to send.
 *
 * There is deliberately no write path in this tool. That is not caution for its own sake: the
 * SMG II is a Siemens unit and the bench programmer available here (R270 1.20) covers only
 * 68HC912 / MC9S12(X) / MPC5xx. A failed erase would leave an ECU with no recovery route short of
 * replacement, so the safe state is that the bytes to erase it cannot be composed at all.
 *
 * `assertReadOnly` runs at module scope in `link.ts`, so adding a write control to this set fails
 * the BUILD. A runtime check would fire on the first chunk — that is, on an already-erased ECU.
 */
export const ALLOWED_CONTROLS: ReadonlySet<number> = new Set<number>([
    0x00,                               // IDENT (SGBD-level identity read)
    Ds2Control.READ_ERROR_MEMORY,       // 0x04
    Ds2Control.READ_MEMORY,             // 0x06 — the extraction path
    Ds2Control.QUERY_ENCODING_CHECKSUM, // 0x0A
    Ds2Control.READ_IO_STATUS,          // 0x0B — live values
    Ds2Control.READ_SYSTEM_ADDRESSES,   // 0x0D
    Ds2Control.READ_SHADOW_ERROR_MEMORY,// 0x14
    0x53,                               // HERSTELLER_DATEN_LESEN (manufacturer data)
    Ds2Control.REQUEST_LOGIN_SEED,      // 0x90 — only if a plain read is refused
    Ds2Control.KEEP_ALIVE,              // 0x9E
    Ds2Control.END_DIAGNOSTIC_MODE,     // 0x9F
]);

/** Controls that erase, program, or otherwise change the ECU. Named so the guard can be explicit. */
export const FORBIDDEN_CONTROLS: ReadonlyMap<number, string> = new Map([
    [Ds2Control.CLEAR_ERROR_MEMORY, 'CLEAR_ERROR_MEMORY (0x05)'],
    [Ds2Control.WRITE_MEMORY, 'WRITE_MEMORY (0x07) — this is erase, program and finalize'],
    [Ds2Control.SET_IO_STATUS, 'SET_IO_STATUS (0x0C) — drives the hydraulic solenoids'],
    [Ds2Control.REBOOT, 'REBOOT (0x12)'],
    [Ds2Control.CLEAR_ADAPTATIONS, 'CLEAR_ADAPTATIONS (0x43) — forces a clutch re-adaptation'],
    [Ds2Control.REQUEST_BAUD_SWITCH, 'REQUEST_BAUD_SWITCH (0x91) — untested on this ECU, see below'],
]);

/**
 * Why the baud switch is on the forbidden list even though it writes nothing.
 *
 * The SGBD says a baud table read is impossible on this ECU ("KEIN BAUDRATEN LESEN MIT DIESEM SG
 * MOEGLICH"), and its `BAUDRATEN_UMSTELLUNG` template ends in 0x03 where the MSS54 tool's
 * `Ds2BaudRate` payloads all end in 0x19:
 *
 *     SMG2 SGBD   32 08 91 00 25 80 03 0d
 *     MSS54 tool  12 08 91 00 25 80 19 ..
 *
 * One of those constants is wrong for this ECU and nobody knows which. A refused switch is not
 * harmless: the MSS54 answered PARAMETER_ERROR to an unsupported rate and the host then had to
 * resynchronise. Extraction does not need it — a 24 KiB read at 9600 takes about a minute — so it
 * stays out until somebody measures it.
 */
export const BAUD_SWITCH_IS_UNRESOLVED = true;

/**
 * A conservative read chunk, used ONLY until the ECU has answered `BLOCKLAENGE_MAX`.
 *
 * BMW's own `FLASH_LESEN` job uses 120 and the DS2 frame allows up to 251 in a response, but the
 * number that matters is the one this particular ECU publishes. Asking beats inferring, so this
 * is a floor for the first exchange rather than a setting.
 */
export const FALLBACK_READ_CHUNK = 32;

/**
 * Read sizes to try, largest first, when negotiating with the ECU.
 *
 * 120 is what BMW's own `FLASH_LESEN` job uses on this family, and the DS2 frame itself allows a
 * 251-byte response — so 120 is a convention, not a ceiling. The descending steps mirror the
 * reference DME tool's `DS2_READ_BLOCK_SIZES`. Trying them is a read, so it is free of consequence.
 */
export const READ_CHUNK_CANDIDATES: readonly number[] = [120, 96, 64, 32];
