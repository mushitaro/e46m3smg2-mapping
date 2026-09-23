/**
 * XDF document -> `XdfDefinition`.
 *
 * Every quirk handled here was observed in `Siemens_SMG_II_510_{24K,512K}.xdf` or in the
 * MSS54HP CSL 0401 definition, and each one is called out at the line that handles it. The
 * expensive one is `CATEGORYMEM category`: it is **1-based**, so reading it as an index shifts
 * every category by one and silently mislabels the whole definition.
 */

import { childOf, childrenOf, parseXml, textOf, type XmlNode } from './xml';
import { compileScaling, IDENTITY_MATH, type XdfScaling } from './math';
import {
    XdfTypeFlag,
    type XdfAxis,
    type XdfDefinition,
    type XdfEmbedded,
    type XdfHeader,
    type XdfItem,
    type XdfRegion,
    type XdfWidth,
} from './types';

export class XdfParseError extends Error {
    constructor(message: string) { super(message); this.name = 'XdfParseError'; }
}

/** `0x32080`, `204800`, `-32` all appear as attribute values in real definitions. */
function num(value: string | undefined, fallback: number): number {
    if (value === undefined || value.trim() === '') return fallback;
    const text = value.trim();
    const parsed = /^[-+]?0[xX]/.test(text) ? Number.parseInt(text, 16) : Number(text);
    if (!Number.isFinite(parsed)) throw new XdfParseError(`not a number: ${JSON.stringify(value)}`);
    return parsed;
}

function optNum(value: string | undefined): number | null {
    if (value === undefined || value.trim() === '') return null;
    return num(value, 0);
}

function asWidth(bits: number): XdfWidth {
    if (bits === 8 || bits === 16 || bits === 32) return bits;
    throw new XdfParseError(`unsupported element width ${bits} bits`);
}

function rawRange(bits: XdfWidth, signed: boolean): { min: number; max: number } {
    return signed
        ? { min: -(2 ** (bits - 1)), max: 2 ** (bits - 1) - 1 }
        : { min: 0, max: 2 ** bits - 1 };
}

/** The `<MATH equation>` of a node, compiled. Absent means identity, which is what TunerPro shows. */
function scalingOf(node: XmlNode, bits: XdfWidth, signed: boolean): XdfScaling {
    const math = childOf(node, 'MATH');
    const equation = math?.attrs['equation']?.trim() || IDENTITY_MATH;
    const { min, max } = rawRange(bits, signed);
    return compileScaling(equation, min, max);
}

function embeddedOf(node: XmlNode, defaults: XdfHeader['defaults']): XdfEmbedded {
    const e = childOf(node, 'EMBEDDEDDATA');
    if (!e) throw new XdfParseError('element has no <EMBEDDEDDATA>');
    const a = e.attrs;

    const bits = asWidth(num(a['mmedelementsizebits'], defaults.bits));
    const typeFlagsRaw = num(a['mmedtypeflags'], 0);

    // Unknown bits are reported, not ignored. A flag we have never seen could mean float, or a
    // stride convention we do not implement; decoding as if it were absent would produce numbers
    // that look plausible and are wrong.
    const KNOWN = XdfTypeFlag.SIGNED | XdfTypeFlag.LSB_FIRST;
    if ((typeFlagsRaw & ~KNOWN) !== 0) {
        throw new XdfParseError(
            `mmedtypeflags 0x${typeFlagsRaw.toString(16)} carries bits this engine does not understand ` +
            `(known: 0x01 signed, 0x02 lsb-first)`);
    }

    // When the attribute is absent entirely, DEFAULTS decides. When it is present, it is
    // authoritative for both bits — a present-but-zero flags attribute means unsigned MSB-first.
    const hasFlags = a['mmedtypeflags'] !== undefined;
    const signed = hasFlags ? (typeFlagsRaw & XdfTypeFlag.SIGNED) !== 0 : defaults.signed;
    const lsbFirst = hasFlags ? (typeFlagsRaw & XdfTypeFlag.LSB_FIRST) !== 0 : defaults.lsbFirst;

    return {
        address: optNum(a['mmedaddress']),
        bits,
        signed,
        lsbFirst,
        rows: num(a['mmedrowcount'], 1),
        cols: num(a['mmedcolcount'], 1),
        majorStrideBits: num(a['mmedmajorstridebits'], 0),
        minorStrideBits: num(a['mmedminorstridebits'], 0),
        typeFlagsRaw,
    };
}

function labelsOf(node: XmlNode): { labels: readonly string[] | null; holes: number[] } {
    const labels = childrenOf(node, 'LABEL');
    if (labels.length === 0) return { labels: null, holes: [] };
    const byIndex: string[] = [];
    const present = new Set<number>();
    for (const label of labels) {
        const index = num(label.attrs['index'], -1);
        if (index < 0) throw new XdfParseError('<LABEL> without a valid index');
        byIndex[index] = label.attrs['value'] ?? '';
        present.add(index);
    }
    // Absent indices become empty strings so consumers never index into a sparse array — but they
    // are also recorded, because an author who wrote `value=""` meant a blank heading and an
    // author who wrote nothing at all left a hole. Only the second is a defect.
    const holes: number[] = [];
    for (let i = 0; i < byIndex.length; i++) {
        if (!present.has(i)) { byIndex[i] = ''; holes.push(i); }
    }
    return { labels: byIndex, holes };
}

function axisOf(node: XmlNode, defaults: XdfHeader['defaults']): XdfAxis {
    const id = node.attrs['id'];
    if (id !== 'x' && id !== 'y' && id !== 'z') throw new XdfParseError(`<XDFAXIS id="${id}"> is not x, y or z`);
    const data = embeddedOf(node, defaults);
    const declared = optNum(textOf(node, 'indexcount') ?? undefined);
    // z declares its shape on EMBEDDEDDATA (rowcount x colcount); x and y declare <indexcount>.
    const indexCount = declared ?? data.rows * data.cols;
    const { labels, holes } = labelsOf(node);
    return {
        id,
        indexCount,
        data,
        labels,
        labelHoles: holes,
        units: textOf(node, 'units'),
        decimals: optNum(textOf(node, 'decimalpl') ?? undefined),
        outputType: optNum(textOf(node, 'outputtype') ?? undefined),
        scaling: scalingOf(node, data.bits, data.signed),
    };
}

/**
 * `CATEGORYMEM category` is **1-based** while `<CATEGORY index>` is 0-based.
 *
 * Proof from the file itself: the `Checksum` constant carries `category="5"`, and the categories
 * are declared 0:Pressure 1:Clutch 2:System Parameters 3:Gear Logic 4:File Data 5:RPM Limits
 * 6:Speed Limits. A checksum belongs to File Data (index 4), not RPM Limits (index 5). Reading
 * it 0-based puts every AUTO shift map under "File Data" and every RPM threshold under
 * "Speed Limits" — plausible-looking, uniformly wrong.
 */
function categoriesOf(node: XmlNode, categories: readonly string[]): readonly string[] {
    const out: string[] = [];
    for (const mem of childrenOf(node, 'CATEGORYMEM')) {
        const oneBased = num(mem.attrs['category'], 0);
        const index = oneBased - 1;
        out.push(categories[index] ?? `(unknown category ${oneBased})`);
    }
    return out;
}

function headerOf(root: XmlNode): XdfHeader {
    const h = childOf(root, 'XDFHEADER');
    if (!h) throw new XdfParseError('document has no <XDFHEADER>');

    const base = childOf(h, 'BASEOFFSET');
    const defaultsNode = childOf(h, 'DEFAULTS');

    const categories: string[] = [];
    for (const c of childrenOf(h, 'CATEGORY')) {
        categories[num(c.attrs['index'], 0)] = c.attrs['name'] ?? '';
    }
    for (let i = 0; i < categories.length; i++) if (categories[i] === undefined) categories[i] = '';

    const regions: XdfRegion[] = childrenOf(h, 'REGION').map(r => ({
        name: r.attrs['name'] ?? '',
        description: r.attrs['desc'] ?? null,
        startAddress: num(r.attrs['startaddress'], 0),
        size: num(r.attrs['size'], 0),
    }));

    return {
        title: textOf(h, 'deftitle') ?? '(untitled)',
        description: textOf(h, 'description'),
        author: textOf(h, 'author'),
        fileVersion: textOf(h, 'fileversion'),
        baseOffset: {
            offset: num(base?.attrs['offset'], 0),
            subtract: num(base?.attrs['subtract'], 0) !== 0,
        },
        defaults: {
            bits: asWidth(num(defaultsNode?.attrs['datasizeinbits'], 8)),
            signed: num(defaultsNode?.attrs['signed'], 0) !== 0,
            lsbFirst: num(defaultsNode?.attrs['lsbfirst'], 0) !== 0,
        },
        regions,
        categories,
    };
}

export function parseXdf(source: string): XdfDefinition {
    const root = parseXml(source);
    if (root.tag !== 'XDFFORMAT') throw new XdfParseError(`root element is <${root.tag}>, expected <XDFFORMAT>`);

    const header = headerOf(root);
    const items: XdfItem[] = [];

    for (const node of root.children) {
        if (node.tag === 'XDFCONSTANT') {
            const data = embeddedOf(node, header.defaults);
            items.push({
                kind: 'constant',
                uniqueId: node.attrs['uniqueid'] ?? '',
                title: textOf(node, 'title') ?? '(untitled)',
                description: textOf(node, 'description'),
                categories: categoriesOf(node, header.categories),
                data,
                units: textOf(node, 'units'),
                decimals: optNum(textOf(node, 'decimalpl') ?? undefined),
                outputType: optNum(textOf(node, 'outputtype') ?? undefined),
                scaling: scalingOf(node, data.bits, data.signed),
            });
            continue;
        }
        if (node.tag === 'XDFTABLE') {
            const axes = childrenOf(node, 'XDFAXIS').map(a => axisOf(a, header.defaults));
            const z = axes.find(a => a.id === 'z');
            if (!z) throw new XdfParseError(`<XDFTABLE> ${textOf(node, 'title')} has no z axis`);
            items.push({
                kind: 'table',
                uniqueId: node.attrs['uniqueid'] ?? '',
                title: textOf(node, 'title') ?? '(untitled)',
                description: textOf(node, 'description'),
                categories: categoriesOf(node, header.categories),
                x: axes.find(a => a.id === 'x') ?? null,
                y: axes.find(a => a.id === 'y') ?? null,
                z,
            });
            continue;
        }
        if (node.tag === 'XDFHEADER') continue;
        // Types we do not model yet (XDFFLAG, XDFPATCH, XDFCHECKSUM in other definitions) are
        // skipped rather than fatal, because refusing to open a file over an item we would not
        // have shown anyway helps nobody. The validator reports the count so it is not invisible.
    }

    const { offset, subtract } = header.baseOffset;
    const fileOffsetOf = (xdfAddress: number) => (subtract ? xdfAddress - offset : xdfAddress + offset);
    const xdfAddressOf = (fileOffset: number) => (subtract ? fileOffset + offset : fileOffset - offset);

    return { header, items, fileOffsetOf, xdfAddressOf };
}

/** Element tags present in the document that this engine does not model. For the validator. */
export function unmodelledTags(source: string): Readonly<Record<string, number>> {
    const root = parseXml(source);
    const counts: Record<string, number> = {};
    for (const node of root.children) {
        if (node.tag === 'XDFHEADER' || node.tag === 'XDFCONSTANT' || node.tag === 'XDFTABLE') continue;
        counts[node.tag] = (counts[node.tag] ?? 0) + 1;
    }
    return counts;
}
