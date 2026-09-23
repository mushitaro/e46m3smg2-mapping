/**
 * BMW's programming files, as bytes.
 *
 * `.0DA` (calibration data) and `.0PA` (program) are Intel HEX with a long `;`-comment header and
 * `$`-directives. Two things about them are not standard and both matter:
 *
 *   1. **Record type 0x10 carries data.** A parser that handles only type 0x00 silently drops
 *      208 bytes of a `.0DA` — including the padding at 0x32010 and the `--+` terminator at
 *      0x37FFC. Those are real bytes in the flash, and a "factory reference" missing them would
 *      disagree with the car for reasons nobody could see.
 *   2. **`;$CARB_MODE_9_CVN` is the checksum BMW computed** for that file. It is how the CRC
 *      identified from the dump gets confirmed against a source that is not the dump.
 *
 * The header is worth keeping: `ZL_REFERENZ` is the same string the flash holds at 0x2FF70, and
 * `Z_Stand` is the software level. Provenance in the file itself beats provenance in a comment.
 */

export interface FactoryFile {
    /** Sparse: only the addresses the file actually programs. */
    readonly bytes: ReadonlyMap<number, number>;
    readonly lowAddress: number;
    readonly highAddress: number;
    /** `$REFERENZ` — the identity string this data belongs to. */
    readonly reference: string | null;
    /** `;$CARB_MODE_9_CVN` — the checksum BMW recorded for this file, or null. */
    readonly declaredChecksum: number | null;
    /** Header fields, `;;KEY: value`, verbatim. */
    readonly header: ReadonlyMap<string, string>;
    /** Record types seen, so an unexpected one is visible rather than silently skipped. */
    readonly recordTypes: readonly number[];
}

export class FactoryParseError extends Error {
    constructor(message: string) { super(message); this.name = 'FactoryParseError'; }
}

function checksumOf(raw: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < raw.length - 1; i++) sum += raw[i];
    return (-sum) & 0xff;
}

export function parseFactoryFile(text: string): FactoryFile {
    const bytes = new Map<number, number>();
    const header = new Map<string, string>();
    const types = new Set<number>();
    let reference: string | null = null;
    let declaredChecksum: number | null = null;
    let base = 0;

    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith(';;')) {
            const m = /^;;\s*([A-Za-z0-9_]+):?\s+(.*)$/.exec(line);
            if (m) header.set(m[1], m[2].trim());
            // A directive can be commented out; `;$CARB_MODE_9_CVN` is exactly that.
            const cvn = /^;\$CARB_MODE_9_CVN\s+([0-9A-Fa-f]+)/.exec(line.slice(1));
            if (cvn) declaredChecksum = parseInt(cvn[1], 16) & 0xffff;
            continue;
        }
        if (line.startsWith(';$')) {
            const cvn = /^;\$CARB_MODE_9_CVN\s+([0-9A-Fa-f]+)/.exec(line);
            if (cvn) declaredChecksum = parseInt(cvn[1], 16) & 0xffff;
            continue;
        }
        if (line.startsWith('$')) {
            const ref = /^\$REFERENZ\s+(\S+)/.exec(line);
            if (ref) reference = ref[1];
            continue;
        }
        if (!line.startsWith(':')) continue;

        const body = line.slice(1).trim();
        if (body.length < 10 || body.length % 2 !== 0) {
            throw new FactoryParseError(`record is not a whole number of bytes: ${line.slice(0, 24)}`);
        }
        let raw: Uint8Array;
        try {
            raw = Uint8Array.from(body.match(/../g)!.map(h => parseInt(h, 16)));
        } catch {
            throw new FactoryParseError(`record is not hex: ${line.slice(0, 24)}`);
        }
        if (raw.some(Number.isNaN)) throw new FactoryParseError(`record is not hex: ${line.slice(0, 24)}`);
        if (checksumOf(raw) !== raw[raw.length - 1]) {
            throw new FactoryParseError(`record checksum is wrong: ${line.slice(0, 24)}`);
        }

        const length = raw[0];
        const address = (raw[1] << 8) | raw[2];
        const type = raw[3];
        const data = raw.subarray(4, 4 + length);
        types.add(type);

        switch (type) {
            // 0x10 is BMW's own, and it carries payload exactly like 0x00. Dropping it loses real
            // flash bytes — see the file comment.
            case 0x00:
            case 0x10:
                for (let i = 0; i < data.length; i++) bytes.set(base + address + i, data[i]);
                break;
            case 0x01: break;                                       // end of file
            case 0x02: base = ((data[0] << 8) | data[1]) << 4; break; // extended segment
            case 0x04: base = ((data[0] << 8) | data[1]) << 16; break; // extended linear
            default:
                throw new FactoryParseError(
                    `record type 0x${type.toString(16)} is not modelled; refusing rather than ` +
                    `dropping bytes that may be real`);
        }
    }

    if (bytes.size === 0) throw new FactoryParseError('no data records');
    // A loop, not `Math.min(...addresses)`. The program file programs 258,304 addresses and
    // spreading that many arguments into a call overflows the stack — a crash that only ever
    // appears on the real data, never on a fixture.
    let lowAddress = Infinity;
    let highAddress = -Infinity;
    for (const address of bytes.keys()) {
        if (address < lowAddress) lowAddress = address;
        if (address > highAddress) highAddress = address;
    }
    return {
        bytes,
        lowAddress,
        highAddress,
        reference,
        declaredChecksum,
        header,
        recordTypes: [...types].sort((a, b) => a - b),
    };
}

/**
 * Overlay a factory file onto an image, leaving everything it does not program untouched.
 *
 * `imageBase` is the address the first byte of `into` has in the ECU — 0x32000 for a
 * calibration-window read. Addresses outside the image are skipped rather than wrapped, because
 * a `.0PA` programs 0x08000-0x7BFFF and a window read holds none of it.
 */
export function overlayFactory(
    into: Uint8Array, file: FactoryFile, imageBase = 0,
): { bytes: Uint8Array; applied: number; skipped: number } {
    const out = Uint8Array.from(into);
    let applied = 0;
    let skipped = 0;
    for (const [address, value] of file.bytes) {
        const at = address - imageBase;
        if (at < 0 || at >= out.length) { skipped++; continue; }
        out[at] = value;
        applied++;
    }
    return { bytes: out, applied, skipped };
}

/** How many of a factory file's bytes the image already agrees with. */
export function compareToImage(
    image: Uint8Array, file: FactoryFile, imageBase = 0,
): { same: number; differ: number; outside: number; firstDifference: number | null } {
    let same = 0;
    let differ = 0;
    let outside = 0;
    let firstDifference: number | null = null;
    for (const [address, value] of file.bytes) {
        const at = address - imageBase;
        if (at < 0 || at >= image.length) { outside++; continue; }
        if (image[at] === value) same++;
        else {
            differ++;
            if (firstDifference === null || address < firstDifference) firstDifference = address;
        }
    }
    return { same, differ, outside, firstDifference };
}
