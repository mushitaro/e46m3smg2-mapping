/**
 * Everything that must be true before a single erase telegram leaves this machine.
 *
 * ## Why this is a type and not a checklist
 *
 * A checklist is advice. `FlashAuthorisation` cannot be constructed except by `preflight`, and
 * `flash.ts` will not accept anything else, so "we checked" is not a thing anyone can claim in a
 * comment — it is a value that either exists or does not. The list below is long because each
 * entry closes a way to brick an ECU that this project can already describe.
 *
 * ## The check that currently fails, and why it is left failing
 *
 * `eraseGranularity` is not established. BMW's own erase telegram carries a **start address and
 * no length** (docs/smg2-write-protocol.md), so the unit that disappears is the ECU flash
 * driver's choice, not the caller's. That driver has now been read (docs/smg2-flash-driver.md):
 * the calibration erase clears exactly ONE sector, identified as the calibration by the
 * `seg3:0x2000` = `0x32000` probe in the same branch. What is still unknown is **how large that
 * sector is** — the descriptors are assembled in RAM at run time rather than stored in the image,
 * so nothing static can say. "This will erase bytes X through Y" therefore cannot be written at
 * all yet, and a confirmation that cannot state the consequence is not one.
 *
 * So the gate stays shut, and it says so in those words rather than by being absent. The one
 * remaining measurement needs the car; the disassembly it used to wait on is done.
 *
 * This is deliberate and it is not a placeholder. Everything else here is finished and tested;
 * the one missing fact is a fact about the ECU, and the honest way to ship an unfinished write
 * path is with the reason on the button.
 */

import type { XdfDefinition } from '@tsunagi/xdf-engine';

export interface FlashPlan {
    /** The bytes as they would land in the ECU. */
    readonly bytes: Uint8Array;
    /** The bytes read off this ECU, unmodified. */
    readonly original: Uint8Array;
    /** SHA-256 of `original`, as read. */
    readonly originalSha256: string;
    /** The ZB the operator entered, and the one found in the image. */
    readonly declaredZb: string;
    readonly imageZb: string | null;
    /** Whether `bytes` carries a correct calibration CRC. */
    readonly checksumOk: boolean;
    /** Byte ranges the edit set touched, plus the checksum word. */
    readonly editedRanges: readonly (readonly [number, number])[];
    /** A verified full backup exists for this exact image. */
    readonly backupVerified: boolean;
    /** Battery volts, from `STAT_UBAT_WERT`, or null when it was not read. */
    readonly batteryVolts: number | null;
    /**
     * The erase unit the ECU will actually clear, in bytes, once somebody knows.
     *
     * `null` means unknown, which is the state today.
     */
    readonly eraseGranularity: number | null;
}

export interface Finding {
    readonly id: string;
    /** `blocking` stops the write. `note` is reported and does not. */
    readonly severity: 'blocking' | 'note';
    /** What is wrong, in one clause, for the app to translate around. */
    readonly detail: string;
    /** What would clear it. */
    readonly next: string;
}

/**
 * Proof that every check passed. Constructible only by `preflight`.
 *
 * The brand is not decoration: without it, a future caller can assemble the shape by hand and the
 * whole gate evaporates in one careless object literal.
 */
export interface FlashAuthorisation {
    readonly __authorised: unique symbol;
    readonly plan: FlashPlan;
    readonly notes: readonly Finding[];
}

const MIN_BATTERY_VOLTS = 12.4;

export function preflight(plan: FlashPlan, def: XdfDefinition): { ok: false; findings: Finding[] } | { ok: true; auth: FlashAuthorisation; notes: Finding[] } {
    const findings: Finding[] = [];
    const add = (id: string, severity: Finding['severity'], detail: string, next: string) =>
        findings.push({ id, severity, detail, next });

    if (plan.bytes.length !== plan.original.length) {
        add('length', 'blocking',
            `the image to write is ${plan.bytes.length} bytes and the one read off this ECU is ${plan.original.length}`,
            'load the image that was read from this car');
    }

    if (plan.imageZb === null) {
        add('zb-unknown', 'blocking',
            'the image carries no readable ZB block',
            'read the full 512 KiB image, which contains the identification block at 0x2FF94');
    } else if (plan.declaredZb.trim() === '') {
        // Distinct from a mismatch, and it has to be: "the ECU reports ZB and the image carries
        // 7843260" is what a missing value looks like when it is compared instead of checked,
        // and it reads as a fault in the image rather than a blank in the form.
        add('zb-not-declared', 'blocking',
            `the image identifies itself as ZB ${plan.imageZb}, and nothing has said which ECU this will be written to`,
            'enter the ZB this car reports, so the two can be compared');
    } else if (plan.declaredZb !== plan.imageZb) {
        add('zb-mismatch', 'blocking',
            `the ECU reports ZB ${plan.declaredZb} and the image carries ${plan.imageZb}`,
            'write the image that came off this ECU');
    }

    if (!plan.checksumOk) {
        add('checksum', 'blocking',
            'the calibration CRC of the bytes to write does not verify',
            'export again so the checksum is recomputed');
    }

    if (!plan.backupVerified) {
        add('backup', 'blocking',
            'no verified full backup exists for this image',
            'read the full 512 KiB image and keep it before writing anything');
    }

    if (plan.batteryVolts === null) {
        add('battery-unknown', 'blocking',
            'battery voltage was not read',
            'connect to the ECU so STAT_UBAT_WERT can be read');
    } else if (plan.batteryVolts < MIN_BATTERY_VOLTS) {
        add('battery-low', 'blocking',
            `battery is ${plan.batteryVolts.toFixed(1)} V, below ${MIN_BATTERY_VOLTS} V`,
            'connect a charger');
    }

    /**
     * The bytes that changed must be exactly the bytes the edit set names, plus the checksum.
     *
     * This is the same assertion `export.test.ts` makes about the exported file, applied to the
     * thing actually being burned. It is what stops a checksum recomputation from making an edit
     * to an unnamed byte look correct — the trap the plan calls "the most dangerous thing this
     * app could grow".
     */
    const claimed = new Set<number>();
    for (const [lo, hi] of plan.editedRanges) for (let a = lo; a < hi; a++) claimed.add(a);
    const surprises: number[] = [];
    for (let a = 0; a < Math.min(plan.bytes.length, plan.original.length); a++) {
        if (plan.bytes[a] !== plan.original[a] && !claimed.has(a)) surprises.push(a);
    }
    if (surprises.length > 0) {
        add('unclaimed-bytes', 'blocking',
            `${surprises.length} bytes differ that no edit accounts for, first at 0x${surprises[0].toString(16).toUpperCase()}`,
            'clear the workspace and start from a fresh read');
    }

    /** Every changed byte must sit inside something the definition names. */
    const named = namedRanges(def);
    const unnamed = [...claimed].filter(a => !named.some(([lo, hi]) => a >= lo && a < hi));
    if (unnamed.length > 0) {
        add('unnamed-edit', 'blocking',
            `${unnamed.length} edited bytes are not covered by any definition item, first at 0x${unnamed[0].toString(16).toUpperCase()}`,
            'revert the edits outside the definition');
    }

    if (plan.eraseGranularity === null) {
        // The driver is now read (docs/smg2-flash-driver.md): the calibration erase is ONE sector
        // and that sector covers the calibration region. What is not yet a fixed number is the
        // sector's exact byte boundary — whether it reaches down into the 8 KB below 0x32000 —
        // because the sector descriptors are assembled in RAM at run time, not stored in the
        // image. So this stays blocking until that one boundary is confirmed on the car, and the
        // `next` says exactly that rather than "disassemble it", which is done.
        add('erase-granularity', 'blocking',
            'the calibration erase clears exactly one flash sector, and how many bytes that sector '
            + 'holds is not established — the sector descriptors are assembled in RAM at run time, '
            + 'not stored in the image',
            'read the descriptors out of RAM after the driver has run; the erase itself does not have '
            + 'to be issued to learn this');
    }

    const blocking = findings.filter(f => f.severity === 'blocking');
    if (blocking.length > 0) return { ok: false, findings };
    return {
        ok: true,
        auth: { plan, notes: findings } as unknown as FlashAuthorisation,
        notes: findings,
    };
}

function namedRanges(def: XdfDefinition): (readonly [number, number])[] {
    const out: (readonly [number, number])[] = [];
    const push = (d: { address: number | null; bits: number; rows: number; cols: number } | null | undefined) => {
        if (!d || d.address === null) return;
        out.push([d.address, d.address + Math.max(1, (d.bits / 8) * d.rows * d.cols)] as const);
    };
    for (const item of def.items) {
        if (item.kind === 'constant') push(item.data);
        else { push(item.z.data); push(item.x?.data); push(item.y?.data); }
    }
    return out;
}
