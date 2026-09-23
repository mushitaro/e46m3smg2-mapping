/** Shown in the header. Bumped by hand; a build that cannot be named cannot be reported against. */
export const APP_VERSION = '0.3.0';

/**
 * Which build this page's code came from.
 *
 * NOT the service worker's id. The worker's id names the bytes it precached, and it is fetched and
 * activated asynchronously — so after a deploy the page can be running build N+1's JavaScript while
 * the worker still reports N, and the stamp on screen is then one build behind the code beside it.
 * Measured: the screen said `f2df783a179b` while running `08414e53de0a`.
 *
 * This is inlined by the bundler at build time from a hash of the SOURCE, so it travels with the
 * code it names. It is computed BEFORE `next build` for the same reason `gen-sw.mjs` runs after it:
 * a stamp written into the output after the output is hashed would change bytes the hash already
 * described.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

/**
 * What this build can and cannot do, stated once so no screen has to remember.
 *
 * Each `false` is false for a different reason, and each reason is worth keeping written down.
 */
export const CAPABILITIES = {
    /**
     * No write path exists in this build, and the reason is now specific rather than general.
     *
     * Everything *knowable* is now known. `docs/smg2-write-protocol.md` transcribes the erase,
     * write and finish telegrams from BMW's own SGBD; `docs/smg2-flash-driver.md` reads the ECU's
     * own erase tables and finds the calibration sector at `0x30000-0x3FFFF`, cross-checked
     * against the start addresses of BMW's `.0PA` and `.0DA` files; and
     * `@tsunagi/ds2-smg2-write` builds the telegrams and derives the sector map, both tested
     * against the real dump.
     *
     * What is missing is the **code that sends them**, and that is deliberate. `preflight` now
     * passes on knowledge and blocks only on facts about the moment — which ECU is in front of
     * you, and what the battery is doing. The FLASH window states exactly what an erase would
     * clear, which is the sentence that could not be written before the driver was read.
     */
    canWriteToEcu: false,
    /**
     * The SMG2 checksum IS identified: reflected CRC-16 / 0xA001, block ranges read from a
     * descriptor, seeds fetched through far pointers. Found in the program area of the first real
     * 512 KiB dump, so it could not have been settled before one existed. See
     * `@tsunagi/ds2-smg2` -> checksum.ts.
     *
     * This does NOT make an export flashable — `canWriteToEcu` is still false for its own
     * separate reason, and nothing here has ever been written to an ECU. It means an exported
     * file is self-consistent rather than knowingly corrupt.
     */
    canChecksum: true,
    /** Live-value block offsets are not derived yet; the datalog surface arrives with them. */
    canDatalog: false,
    /**
     * A full 512 KiB image is disassembled in the browser, from the bytes the user read.
     *
     * `@tsunagi/c166` decodes C16x/ST10 and sweeps by recursive descent from the vector tables,
     * the rodata pointer tables and every call site. On this car's image: 942 functions, 56,135
     * instructions, 72.4% of the measured code regions, five undefined opcodes. Nothing is
     * shipped — there is no disassembly artifact in `public/`, only the decoder.
     *
     * The coverage figure went DOWN from an earlier 80.6% while the function count went up,
     * because the denominator grew: `0x08240-0x0FFFF` was added to the code ranges after the
     * serial handlers were found outside them. A percentage of an incomplete map was the more
     * flattering number and the less true one.
     */
    canDisassemble: true,

    /** Installable, offline-capable, and usable from a phone. */
    isPwa: true,
    /** Android reaches the cable over WebUSB; desktop over Web Serial. iOS can do neither. */
    canReadFromMobile: true,
    /** An extraction can be handed to D1 for analysis. */
    canShareToD1: true,
} as const;
