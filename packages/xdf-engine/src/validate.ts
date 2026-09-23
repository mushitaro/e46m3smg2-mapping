/**
 * Load-time validation of a definition.
 *
 * This runs before a definition is allowed to describe any bytes, for the reason the DME tuner's
 * `validateCatalog` exists: a definition is the thing that decides which bytes mean what, so a
 * defect in it is invisible in the output. Every finding below was chosen because a real
 * definition trips it.
 *
 * The hard part is telling a genuine collision from a shared axis. Eleven tables in
 * Siemens SMG2 510 legitimately point their x axis at `0x36D40` or `0x36E00`, and they do not all
 * read the same LENGTH from it: the 8-point run at `0x36D40` is also read as 7 points by the
 * tables that have seven columns. Sharing a breakpoint run and taking a prefix of it is ordinary
 * TunerPro practice, so the rule is **same start address between axes is sharing; an axis overlap
 * at a DIFFERENT start is misalignment and worth a warning.**
 *
 * A validator that flags the ordinary case gets muted, and a muted validator protects nothing.
 */

import { spansOf, type ByteSpan } from './codec';
import { unmodelledTags } from './parse';
import type { XdfDefinition, XdfItem } from './types';

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface XdfFinding {
    readonly severity: FindingSeverity;
    /** Stable kebab-case kind, so the UI can group and the tests can assert without matching prose. */
    readonly kind: string;
    readonly message: string;
    readonly items: readonly string[];
}

export interface ValidateOptions {
    /**
     * The byte window the loaded image represents, in FILE offsets. When given, items outside it
     * are reported — that is how a 512 KiB definition applied to a 24 KiB partial is caught before
     * it reads garbage.
     */
    readonly imageLength?: number;
    /** The raw document, if you want unmodelled element kinds counted. */
    readonly source?: string;
}

function overlaps(a: ByteSpan, b: ByteSpan): boolean {
    return a.start < b.end && b.start < a.end;
}

/**
 * Two axes are the same breakpoint run when they begin at the same address. One may be shorter:
 * a seven-column table reads seven points of an eight-point run. Requiring equal ends would flag
 * that ordinary case, so only the start is compared.
 */
function sameRun(a: ByteSpan, b: ByteSpan): boolean {
    return a.start === b.start;
}

function describe(span: ByteSpan, def: XdfDefinition): string {
    const addr = def.xdfAddressOf(span.start).toString(16).toUpperCase();
    return `"${span.itemTitle}" ${span.role} @0x${addr} (${span.end - span.start}B)`;
}

export function validateXdf(def: XdfDefinition, options: ValidateOptions = {}): readonly XdfFinding[] {
    const findings: XdfFinding[] = [];
    const spans: ByteSpan[] = [];

    for (const item of def.items) {
        try {
            spans.push(...spansOf(def, item));
        } catch (error) {
            findings.push({
                severity: 'error',
                kind: 'unreadable-layout',
                message: `"${item.title}": ${(error as Error).message}`,
                items: [item.uniqueId],
            });
        }
        findings.push(...perItemFindings(item));
    }

    spans.sort((a, b) => a.start - b.start || a.end - b.end);

    // Sweep for overlaps. Sorted by start, so a span only has to be compared with those still
    // "open" — but the counts here are in the hundreds, and a clear O(n^2) inner loop bounded by
    // the sort is easier to be sure about than an interval tree.
    for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length && spans[j].start < spans[i].end; j++) {
            const a = spans[i];
            const b = spans[j];
            if (!overlaps(a, b)) continue;
            if (a.itemId === b.itemId) continue;

            const bothAxes = a.role !== 'value' && b.role !== 'value';
            if (bothAxes && sameRun(a, b)) continue; // shared breakpoint run, possibly a prefix

            findings.push({
                severity: bothAxes ? 'warning' : 'error',
                kind: bothAxes ? 'misaligned-axis-overlap' : 'value-overlap',
                message: bothAxes
                    ? `two axes overlap but do not start at the same address: ` +
                      `${describe(a, def)} and ${describe(b, def)}`
                    : `these occupy the same bytes: ${describe(a, def)} and ${describe(b, def)}`,
                items: [a.itemId, b.itemId],
            });
        }
    }

    // Anything sitting on the stored checksum is a defect with teeth: editing that item would
    // rewrite the checksum with data, and the ECU would then reject an otherwise good image.
    const checksumSpans = spans.filter(s => /checksum/i.test(s.itemTitle) && s.role === 'value');
    for (const cs of checksumSpans) {
        for (const other of spans) {
            if (other.itemId === cs.itemId || !overlaps(cs, other)) continue;
            findings.push({
                severity: 'error',
                kind: 'overlaps-checksum',
                message: `${describe(other, def)} overlaps the stored checksum ${describe(cs, def)}`,
                items: [cs.itemId, other.itemId],
            });
        }
    }

    if (options.imageLength !== undefined) {
        for (const span of spans) {
            if (span.start >= 0 && span.end <= options.imageLength) continue;
            findings.push({
                severity: 'error',
                kind: 'outside-image',
                message: `${describe(span, def)} maps to file offsets ` +
                    `0x${span.start.toString(16)}..0x${span.end.toString(16)}, outside the ` +
                    `${options.imageLength}-byte image. Wrong definition variant for this file?`,
                items: [span.itemId],
            });
        }
    }

    if (options.source !== undefined) {
        for (const [tag, count] of Object.entries(unmodelledTags(options.source))) {
            findings.push({
                severity: 'info',
                kind: 'unmodelled-element',
                message: `${count} <${tag}> element(s) are present but not modelled by this engine`,
                items: [],
            });
        }
    }

    return findings;
}

function perItemFindings(item: XdfItem): readonly XdfFinding[] {
    const out: XdfFinding[] = [];

    const noteScaling = (title: string, math: string, inverse: string, id: string) => {
        if (inverse === 'none') {
            out.push({
                severity: 'info',
                kind: 'read-only-scaling',
                message: `"${title}" uses MATH ${JSON.stringify(math)}, which cannot be inverted safely; ` +
                    `it can be read but not written`,
                items: [id],
            });
        }
    };

    if (item.kind === 'constant') {
        noteScaling(item.title, item.scaling.math, item.scaling.inverse, item.uniqueId);
        if (item.data.address === null) {
            out.push({
                severity: 'error',
                kind: 'no-address',
                message: `constant "${item.title}" has no mmedaddress`,
                items: [item.uniqueId],
            });
        }
        return out;
    }

    noteScaling(item.title, item.z.scaling.math, item.z.scaling.inverse, item.uniqueId);

    for (const axis of [item.x, item.y]) {
        if (!axis) continue;
        if (axis.data.address === null && axis.labels === null) {
            out.push({
                severity: 'warning',
                kind: 'empty-axis',
                message: `"${item.title}" ${axis.id} axis has neither an address nor labels; ` +
                    `it will render as bare indices`,
                items: [item.uniqueId],
            });
        }
        if (axis.labels && axis.labels.length !== axis.indexCount) {
            out.push({
                severity: 'warning',
                kind: 'label-count-mismatch',
                message: `"${item.title}" ${axis.id} axis declares ${axis.indexCount} points but carries ` +
                    `${axis.labels.length} label(s)`,
                items: [item.uniqueId],
            });
        }
        if (axis.labelHoles.length > 0) {
            out.push({
                severity: 'warning',
                kind: 'label-hole',
                message: `"${item.title}" ${axis.id} axis supplies no LABEL for ` +
                    `index ${axis.labelHoles.join(', ')}`,
                items: [item.uniqueId],
            });
        }
    }

    // The grid's shape must agree with the axes it is drawn against, or the table renders with
    // headings that belong to different cells than the ones under them.
    const rows = Math.max(1, item.z.data.rows);
    const cols = Math.max(1, item.z.data.cols);
    if (item.x && item.x.indexCount !== cols) {
        out.push({
            severity: 'warning',
            kind: 'axis-shape-mismatch',
            message: `"${item.title}" has ${cols} column(s) but an x axis of ${item.x.indexCount} point(s)`,
            items: [item.uniqueId],
        });
    }
    if (item.y && item.y.indexCount !== rows) {
        out.push({
            severity: 'warning',
            kind: 'axis-shape-mismatch',
            message: `"${item.title}" has ${rows} row(s) but a y axis of ${item.y.indexCount} point(s)`,
            items: [item.uniqueId],
        });
    }

    return out;
}

/** Convenience: does this definition have anything that should stop it being used to edit bytes? */
export function hasBlockingFindings(findings: readonly XdfFinding[]): boolean {
    return findings.some(f => f.severity === 'error');
}
