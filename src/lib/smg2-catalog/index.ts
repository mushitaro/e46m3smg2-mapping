/**
 * What this project knows about the SMG II 510 that the community definition does not.
 *
 * Every entry here was established against the real dump `5c5a0c857acd` and, where it touches a
 * factory file, against BMW's own programming data. Nothing is here on a hunch: an entry that
 * cannot name its evidence does not belong in a file that changes where bytes are read from.
 *
 * The `was:` on every patch is the guard. If MS4X publishes a corrected XDF, `applyOverlay`
 * refuses and names the entry rather than "correcting" something that is already right.
 */

import type { Overlay } from '@tsunagi/xdf-engine';

/** Bumped when an entry changes. Recorded in the export manifest so a file can be traced. */
export const CATALOG_VERSION = '2026-09-04.1';

const DUMP = 'dump 5c5a0c857acd (E46 M3, ZB 7843255, calibration-stock)';

export const SMG2_OVERLAY: Overlay = {
    version: CATALOG_VERSION,
    entries: [
        /**
         * Speed thresholds, in km/h.
         *
         * The vendor file already labels nine `X/16` items `kmh` — `FAULT: Upshift Speed
         * Thresholds` and the six `SPORT/RACE: * Speed * Thresholds` among them — and leaves
         * thirty-two more with the identical conversion carrying nothing. Every one of the
         * thirty-two has "Speed" in its title. The unit is not being invented here; it is being
         * read off the vendor's own siblings, and `was: null` is the guard that notices if MS4X
         * ever labels them itself.
         */
        {
            op: 'units',
            uniqueId: '0x7695',
            title: 'AUTO: A1 Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x27FB',
            title: 'AUTO: A2 Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x6E91',
            title: 'AUTO: A3 Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x6373',
            title: 'AUTO: A4 Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x2DEB',
            title: 'AUTO: A5 Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x210A',
            title: 'AUTO: FGR Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x1D23',
            title: 'AUTO: MODE7 Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x3BAB',
            title: 'AUTO: MODE8 Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x4590',
            title: 'AUTO: MODE9 Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x777A',
            title: 'AUTO: WARMUP Speed Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x1CA4',
            title: 'AUTO: A1 Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x68ED',
            title: 'AUTO: A2 Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x4791',
            title: 'AUTO: A3 Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x62C0',
            title: 'AUTO: A4 Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x5780',
            title: 'AUTO: A5 Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x6916',
            title: 'AUTO: FGR Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x1754',
            title: 'AUTO: MODE7 Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x1A50',
            title: 'AUTO: MODE8 Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x1F19',
            title: 'AUTO: MODE9 Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x2291',
            title: 'AUTO: WARMUP Speed Thresholds, Braking',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x744C',
            title: 'SPORT: Upshift Speed Thresholds, High/Part Load',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x60E1',
            title: 'SPORT: Downshift Speed Thresholds, High/Part Load',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x7B8',
            title: 'SPORT: Upshift Speed Thresholds, Low Load',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x5288',
            title: 'SPORT: Downshift Speed Thresholds, Low Load',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x45A0',
            title: 'SPORT: Downshift Low Temperature Speed Offsets',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x1DB0',
            title: 'SPORT: Upshift Low Temperature Speed Offsets',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x20F4',
            title: 'SPORT: Downshift High Load Speed Offsets',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x5DA',
            title: 'SPORT: Downshift Part Load Speed Offsets',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x245A',
            title: 'SPORT: Upshift High Load Speed Offsets',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x409A',
            title: 'SPORT: Upshift Part Load Speed Offsets',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: '0x10B2',
            title: 'SPORT: Downshift Low Load Speed Offsets',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },
        {
            op: 'units',
            uniqueId: 'smg2/auto-36240',
            title: 'AUTO: Speed Thresholds @0x36240 (undeclared)',
            target: 'value',
            was: { units: null },
            now: { units: 'kmh', decimals: 1 },
            why: 'Nine items in the same file with the same X/16 conversion are labelled kmh; these carry the same conversion and "Speed" in the title, and no unit at all.',
            provenance: { kind: 'measured', evidence: `${DUMP}: decoded through X/16 these read 0-250, which is a road speed in km/h `
                    + `and is not a plausible range for any other quantity a shift table holds.` },
        },

        /**
         * Engine speed, in rpm.
         *
         * Same argument, different pair: nine items in this file carry `X` + `rpm`, including
         * `SPORT/RACE: Upshift RPM Low Thresholds`. These seven have `X`, say RPM in their title,
         * and carry no unit.
         */
        {
            op: 'units',
            uniqueId: '0x6895',
            title: 'DWF: RPM Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'rpm', decimals: 0 },
            why: 'Nine items in the same file with the same X conversion are labelled rpm; these say RPM in their own titles and carry no unit.',
            provenance: { kind: 'measured', evidence: `${DUMP}: values fall between 1,000 and 8,000, which is this engine's range.` },
        },
        {
            op: 'units',
            uniqueId: '0x6593',
            title: 'RPM Thresholds',
            target: 'value',
            was: { units: null },
            now: { units: 'rpm', decimals: 0 },
            why: 'Nine items in the same file with the same X conversion are labelled rpm; these say RPM in their own titles and carry no unit.',
            provenance: { kind: 'measured', evidence: `${DUMP}: values fall between 1,000 and 8,000, which is this engine's range.` },
        },
        {
            op: 'units',
            uniqueId: '0x1F99',
            title: 'Braking: RPM Thresholds per Gear, Threshold 5',
            target: 'value',
            was: { units: null },
            now: { units: 'rpm', decimals: 0 },
            why: 'Nine items in the same file with the same X conversion are labelled rpm; these say RPM in their own titles and carry no unit.',
            provenance: { kind: 'measured', evidence: `${DUMP}: values fall between 1,000 and 8,000, which is this engine's range.` },
        },
        {
            op: 'units',
            uniqueId: '0x786B',
            title: 'Braking: RPM Thresholds per Gear, Threshold 4',
            target: 'value',
            was: { units: null },
            now: { units: 'rpm', decimals: 0 },
            why: 'Nine items in the same file with the same X conversion are labelled rpm; these say RPM in their own titles and carry no unit.',
            provenance: { kind: 'measured', evidence: `${DUMP}: values fall between 1,000 and 8,000, which is this engine's range.` },
        },
        {
            op: 'units',
            uniqueId: '0x1B6A',
            title: 'Braking: RPM Thresholds per Gear, Threshold 3',
            target: 'value',
            was: { units: null },
            now: { units: 'rpm', decimals: 0 },
            why: 'Nine items in the same file with the same X conversion are labelled rpm; these say RPM in their own titles and carry no unit.',
            provenance: { kind: 'measured', evidence: `${DUMP}: values fall between 1,000 and 8,000, which is this engine's range.` },
        },
        {
            op: 'units',
            uniqueId: '0x18A0',
            title: 'Braking: RPM Thresholds per Gear, Threshold 2',
            target: 'value',
            was: { units: null },
            now: { units: 'rpm', decimals: 0 },
            why: 'Nine items in the same file with the same X conversion are labelled rpm; these say RPM in their own titles and carry no unit.',
            provenance: { kind: 'measured', evidence: `${DUMP}: values fall between 1,000 and 8,000, which is this engine's range.` },
        },
        {
            op: 'units',
            uniqueId: '0x53D4',
            title: 'Braking: RPM Thresholds per Gear, Threshold 1',
            target: 'value',
            was: { units: null },
            now: { units: 'rpm', decimals: 0 },
            why: 'Nine items in the same file with the same X conversion are labelled rpm; these say RPM in their own titles and carry no unit.',
            provenance: { kind: 'measured', evidence: `${DUMP}: values fall between 1,000 and 8,000, which is this engine's range.` },
        },

        /**
         * The threshold block is a 14-byte grid of 7-element records, and the XDF starts FAULT
         * four bytes late. Read as the vendor declares it, its last element is byte-identical to
         * the first element of the table next door — the two definitions physically share a word.
         *
         *   0x36ED8 x7   0, 0, 0, 22, 30, 38, 48   km/h   monotone
         *   0x36EE6 x7   18, 18, 32, 46, 64, 78, 90 km/h  monotone, adjacent, no overlap
         *
         * Declared as 0x36EDC x6 it reads 0, 22, 30, 38, 48, 18 — which is not monotone, and the
         * trailing 18 is the neighbour's first gear.
         */
        {
            op: 'patch',
            uniqueId: '0x5C5C',
            title: 'FAULT: Upshift Speed Thresholds',
            target: 'value',
            was: { address: 0x36edc, cols: 6 },
            now: { address: 0x36ed8, cols: 7 },
            why: 'Starts four bytes late and swallows the first word of SPORT/RACE: Upshift Speed '
                + 'Low Thresholds. On the 14-byte record grid the run is 0x36ED8 x7, which is '
                + 'monotone and sits flush against its neighbour.',
            provenance: {
                kind: 'measured',
                evidence: `${DUMP}: u16 from 0x36ED8 are [0,0,0,352,480,608,768] = 0/0/0/22/30/38/48 `
                    + `km/h at X/16, and 0x36ED8+14 = 0x36EE6 is exactly where the next record starts.`,
            },
        },
        {
            op: 'patch',
            uniqueId: '0x7E29',
            title: 'SPORT/RACE: Upshift Speed Low Thresholds',
            target: 'value',
            was: { address: 0x36ee6, cols: 6 },
            now: { address: 0x36ee6, cols: 7 },
            why: 'Six of a seven-element record. The seventh (90 km/h) is orphaned by the vendor '
                + 'declaration, and the family it belongs to — the SPORT offsets — is 1x7 throughout.',
            provenance: {
                kind: 'measured',
                evidence: `${DUMP}: u16 from 0x36EE6 are [288,288,512,736,1024,1248,1440] = `
                    + `18/18/32/46/64/78/90 km/h, monotone across all seven.`,
            },
        },

        /**
         * Not a collision. `Rear, Neutral or 1st Gear` and `RPM Thresholds`[0] are the same two
         * bytes on purpose — the constant names cell 0 of the table. The validator reports this
         * as an error, which trains a reader to skip the findings list.
         *
         * It is still worth saying out loud, because editing either one silently changes the
         * other, and nothing on screen would say so.
         */
        {
            op: 'alias',
            uniqueIds: ['0x7E66', '0x6593'],
            why: 'Both address 0x36F94. The constant is a name for cell 0 of the table; editing '
                + 'either changes both.',
            provenance: {
                kind: 'measured',
                evidence: `${DUMP}: u16 at 0x36F94 is 5800, which is what both items decode to.`,
            },
        },

        /**
         * The AUTO family's real shape. The y-axis labels already say it — `0-1-R, 2>3, 3>4,
         * 4>5, 5>6` then `0-1-R, 3>2, 4>3, 5>4, 6>5` — but nothing groups them, so "row 7" reads
         * as the seventh row of one table rather than as third-gear DOWNSHIFT.
         */
        ...['0x7695', '0x27FB', '0x6E91', '0x6373', '0x2DEB',
            '0x210A', '0x1D23', '0x3BAB', '0x4590', '0x777A'].map((uniqueId): Overlay['entries'][number] => ({
            op: 'note',
            uniqueId,
            rowGroups: [
                { label: 'UPSHIFT', rows: [0, 1, 2, 3, 4] },
                { label: 'DOWNSHIFT', rows: [5, 6, 7, 8, 9] },
            ],
            prose: {
                en: 'Two stacked 5x16 blocks: rows 0-4 are the upshift speeds for gears 1-5, rows '
                    + '5-9 the downshift speeds for the same gears. The band between a pair is the '
                    + 'hysteresis. Editing "row 7" edits third-gear DOWNSHIFT.',
                ja: '5x16 のブロックが 2 枚重なっています。0–4 行が 1–5 速のアップシフト速度、'
                    + '5–9 行が同じギアのダウンシフト速度で、対の間の帯がヒステリシスです。'
                    + '「7 行目」を編集すると 3 速のダウンシフトを触ることになります。',
            },
            provenance: {
                kind: 'measured',
                evidence: `${DUMP}: upshift exceeds downshift in 800 of 800 gear x throttle cells `
                    + `across all ten declared tables, with zero violations. The y-axis labels agree.`,
            },
        })),

        /**
         * The eleventh AUTO block, which the definition omits entirely.
         *
         * The series runs on a 0x160 stride from 0x35A00. The XDF declares ten and skips index 6.
         * The skipped block holds 352 bytes with not one 0xFF among them — live calibration —
         * and it sits INSIDE the CRC-protected range, so a checksum-correcting writer saves it
         * silently as "unedited".
         *
         * Named by address, not MODE6. The dispatcher at 0x40406 references only ten blocks, so
         * this may be a slot the software never reads: an edit here may change nothing at all.
         * Calling it MODE6 would promise a program we have not established exists.
         */
        {
            op: 'add',
            uniqueId: 'smg2/auto-36240',
            title: 'AUTO: Speed Thresholds @0x36240 (undeclared)',
            modelledOn: '0x777A',
            address: 0x36260,
            description:
                'The eleventh block of the AUTO series. The definition declares ten and skips this '
                + 'one. Its x axis is the WARMUP variant, making it WARMUP’s sibling [inferred]. '
                + 'The program dispatcher names only ten blocks, so an edit here may change '
                + 'nothing — the way to find out is to move one cell, flash, and drive each mode.',
            why: 'Live shift-point calibration that no definition names, inside the checksummed '
                + 'range, therefore invisible to any tool that trusts the XDF.',
            provenance: {
                kind: 'measured',
                evidence: `${DUMP}: 0x36240-0x3639F is 352 bytes with zero 0xFF; the AUTO series is `
                    + `0x35A00 + n*0x160 for n=0..10 and the XDF covers every n but 6; the block's `
                    + `own cells satisfy up > down in 80 of 80.`,
            },
        },
        {
            op: 'note',
            uniqueId: 'smg2/auto-36240',
            rowGroups: [
                { label: 'UPSHIFT', rows: [0, 1, 2, 3, 4] },
                { label: 'DOWNSHIFT', rows: [5, 6, 7, 8, 9] },
            ],
            prose: {
                en: 'Undeclared by the definition. Same two-block shape as its siblings, and its '
                    + 'own cells satisfy the hysteresis rule independently — but nothing establishes '
                    + 'which Drivelogic program reads it, or whether anything does.',
                ja: '定義が名指ししていないブロックです。兄弟と同じ 2 枚構造で、この中だけでも'
                    + 'ヒステリシスの条件を満たしています。ただし、どのドライブロジックが'
                    + 'これを読むのか、そもそも読まれるのかは何も裏づけがありません。',
            },
            provenance: {
                kind: 'inferred',
                confidence: 'strong',
                evidence: `${DUMP}: up > down in 80 of 80 cells within this block alone.`,
            },
        },

        /**
         * The three bitfields. Transcribed from the XDF's own `<description>` rather than parsed
         * from it: the notation is seven characters wide for a sixteen-bit field, and a regex
         * mis-read would put a checkbox on the wrong bit of a live logic register.
         *
         * All sixteen bits are listed. Showing only the documented seven would imply the other
         * nine are zero — they read 1.
         */
        {
            op: 'note',
            uniqueId: '0x3EFB',
            prose: {
                en: 'A bitfield, not a number. 0xFFFF is the documented default: every logic '
                    + 'branch enabled. Bit 4 is the sub-18 km/h first-gear crawl logic, which is the '
                    + 'coarsest lever available for low-speed snatch — it switches a whole branch off '
                    + 'and cannot be graded, so try the shift schedule first.',
                ja: '数値ではなくビットフィールドです。0xFFFF は文書化された既定値で、全ロジックが'
                    + '有効という意味です。bit 4 が 18 km/h 未満・1 速の徐行ロジックで、'
                    + '低速のギクシャクに対して最も粗いレバーです。枝ごと切るため段階を付けられません。'
                    + '先に変速スケジュール側を試してください。',
            },
            bits: [
                { bit: 0, label: 'Lateral acceleration AND throttle-difference logic', labelJa: '横加速度 AND スロットル差ロジック', documented: true },
                { bit: 1, label: 'Lateral acceleration logic', labelJa: '横加速度ロジック', documented: true },
                { bit: 2, label: 'Zero throttle / FGR logic', labelJa: '全閉スロットル／FGR ロジック', documented: true },
                { bit: 3, label: 'Longitudinal acceleration logic', labelJa: '前後加速度ロジック', documented: true },
                { bit: 4, label: 'Below 18 km/h, gear 1 slow-moving logic', labelJa: '18 km/h 未満・1 速の徐行ロジック', documented: true },
                { bit: 5, label: 'FGR, gear 6 logic', labelJa: 'FGR・6 速ロジック', documented: true },
                { bit: 6, label: 'Upshift pending logic', labelJa: 'アップシフト保留ロジック', documented: true },
                ...Array.from({ length: 9 }, (_, i) => ({
                    bit: i + 7,
                    label: 'undocumented, stock 1 — no predicted effect and no way to tell whether it worked',
                    labelJa: '未文書、ストック 1 —— 予測できる効果がなく、効いたかを確かめる手段もありません',
                    documented: false,
                })),
            ],
            provenance: { kind: 'documented', source: "the XDF's own <description> for CFG: Logic" },
        },
        {
            op: 'note',
            uniqueId: '0xB54',
            prose: {
                en: 'A bitfield. Stock 0x0B = bits 0, 1 and 3 set.',
                ja: 'ビットフィールドです。ストックの 0x0B は bit 0・1・3 が立った状態です。',
            },
            bits: [
                { bit: 0, label: 'Skip the SportComfort-1 / A-mode check; clutch from torque rather than engine speed', labelJa: 'SportComfort-1／A モードの判定を飛ばし、エンジン回転ではなくトルクからクラッチを決める', documented: true },
                { bit: 1, label: 'Use torque available at the clutch rather than at the motor', labelJa: 'モータ側ではなくクラッチ側で使えるトルクを使う', documented: true },
                { bit: 2, label: 'Use the engine-speed threshold for torque-offset calculations', labelJa: 'トルクオフセットの計算にエンジン回転しきい値を使う', documented: true },
                { bit: 3, label: 'Skip the SportComfort-1 / A-mode check when the clutch is halted, to reset hill-climb assist', labelJa: 'クラッチ停止時に SportComfort-1／A モード判定を飛ばし、坂道発進アシストをリセットする', documented: true },
                { bit: 4, label: 'Use filtered engine and idle target speed for the base clutch calculation', labelJa: 'クラッチ基本計算にフィルタ後のエンジン回転とアイドル目標回転を使う', documented: true },
                { bit: 5, label: 'Use the 3000 rpm kickdown check for pre-racestart clutch calculations', labelJa: 'プリレーススタートのクラッチ計算に 3000 rpm キックダウン判定を使う', documented: true },
                ...Array.from({ length: 2 }, (_, i) => ({
                    bit: i + 6, label: 'undocumented', labelJa: '未文書', documented: false,
                })),
            ],
            provenance: { kind: 'documented', source: "the XDF's own <description> for RACESTART: Clutch Config" },
        },
    ],
};
