/**
 * The image, read as a program.
 *
 * ## Nothing is shipped
 *
 * There is no disassembly artifact in `public/`. The sweep runs in the browser, on the bytes the
 * user just read off their own car, and takes about sixty-five milliseconds. That is not a
 * performance note — it is the difference between showing someone their ECU and showing them a
 * picture of somebody else's that happens to carry the same part number. A 24 KiB calibration
 * window contains no instructions at all, and this module says so rather than inventing any.
 *
 * ## What a name is allowed to claim
 *
 * A function gets a label from evidence, or it gets its address:
 *
 * | Label | What justifies it |
 * |---|---|
 * | `RESET` | vector 0 targets it |
 * | `IRQ 50h` | a live interrupt vector targets it |
 * | `ASC0 RX` / `ASC0 TX` / `ASC0 ERR` | §2.2 identified these three by the registers they touch |
 * | `FN 51B1A` | nothing above applies |
 *
 * **No function is named after what it looks like it does.** `calc_shift_point` would be a guess
 * wearing the costume of a fact, and the whole value of this view is that the reader can trust
 * what it says. What the tool offers instead is the one thing it can prove: the calibration each
 * function reads. "The function at 0x51B1A reads AUTO: A3 Speed Thresholds" is checkable; a name
 * is not.
 */

import { sweep, type FuncInfo, type SweepResult, type Via } from '@tsunagi/c166';
import type { XdfDefinition, XdfItem } from '@tsunagi/xdf-engine';

/** How strongly a data reference is founded. Mirrors `Via`, collapsed to what a reader needs. */
export type RefTier = 'stated' | 'inferred';

export function tierOf(via: Via | undefined): RefTier {
    return via === 'set' || via === 'extp' || via === 'exts' ? 'stated' : 'inferred';
}

export interface ItemRef {
    /** `uniqueId` of the calibration item. */
    readonly id: string;
    readonly title: string;
    /** Distinct addresses inside that item this function touches. */
    readonly addresses: readonly number[];
    readonly tier: RefTier;
    /** `walks` when the access indexes off the item's base; `reads` when it names one word. */
    readonly how: 'reads' | 'walks';
}

export interface CodeFunction {
    readonly at: number;
    readonly end: number;
    readonly label: string;
    /** Why it is called that, in one clause. Empty for an address-only label. */
    readonly labelWhy: string;
    readonly insnCount: number;
    readonly returns: boolean;
    readonly calls: readonly number[];
    readonly callers: readonly number[];
    /** Calibration items this function reads, most-referenced first. */
    readonly items: readonly ItemRef[];
    /** Addresses inside the calibration body that no item covers. */
    readonly unnamed: readonly number[];
    readonly undef: number;
}

export interface CodeModel {
    readonly funcs: ReadonlyMap<number, CodeFunction>;
    /** Functions in address order, for the list. */
    readonly ordered: readonly CodeFunction[];
    /** Which functions read a given item. */
    readonly readersOf: ReadonlyMap<string, readonly number[]>;
    /** Calibration addresses that are read and that no definition names, with a read count. */
    readonly unnamedReads: readonly { readonly at: number; readonly count: number }[];
    readonly stats: {
        readonly funcs: number;
        readonly insns: number;
        readonly undef: number;
        readonly coveredBytes: number;
        readonly execBytes: number;
        readonly calAccesses: number;
        readonly itemsWithReader: number;
        readonly itemsTotal: number;
    };
}

/** The calibration body, per `docs/full-image-analysis.md` §5.2. The CRC-protected span. */
const CAL_LO = 0x320e0;
const CAL_HI = 0x378c0;

/**
 * The three handlers §2.2 identified by the registers they touch, and nothing else.
 *
 * `0x009478` is deliberately absent. The analysis calls reading it as a periodic timer an
 * inference with insufficient grounds, and a label here would quietly promote that to a fact.
 */
const NAMED_HANDLERS: Readonly<Record<number, [string, string]>> = {
    0x00ad30: ['ASC0 RX', 'reads S0RBUF at 0x00AD3A'],
    /**
     * These two are NOT labelled TX and ERR, and the reason is worth stating.
     *
     * §2.2 identifies them together — "0x00B0B4 / 0x00ACF0 — S0CON bits 8-10 cleared with BFLDH,
     * S0RBUF read twice, S0TIC/S0RIC/S0EIC cleared and re-enabled = 送信/エラー割込み" — as a
     * pair, without saying which is which. An earlier version of this file called `0x00B0B4` TX
     * and `0x00ACF0` ERR, which reads as a fact and is a coin toss. `ASC0 RESET` is what both
     * demonstrably do.
     */
    0x00b0b4: ['ASC0 RESET', 'clears S0CON bits 8-10 and re-enables S0TIC/S0RIC/S0EIC; §2.2 pairs it with 0x00ACF0 as transmit-or-error without distinguishing them'],
    0x00acf0: ['ASC0 RESET', 'clears S0CON bits 8-10 and re-enables S0TIC/S0RIC/S0EIC; §2.2 pairs it with 0x00B0B4 as transmit-or-error without distinguishing them'],
};

interface Span {
    readonly at: number;
    readonly len: number;
    readonly id: string;
    readonly title: string;
}

/** Every byte range a definition names, so a read can be attributed or reported as unnamed. */
export function spansOf(def: XdfDefinition): Span[] {
    const out: Span[] = [];
    const push = (
        data: { address: number | null; bits: number; rows: number; cols: number } | null | undefined,
        item: XdfItem,
    ) => {
        if (!data || data.address === null) return;
        out.push({
            at: data.address,
            len: Math.max(1, (data.bits / 8) * data.rows * data.cols),
            id: item.uniqueId,
            title: item.title,
        });
    };
    for (const item of def.items) {
        if (item.kind === 'constant') push(item.data, item);
        else {
            push(item.z.data, item);
            push(item.x?.data, item);
            push(item.y?.data, item);
        }
    }
    return out.sort((a, b) => a.at - b.at);
}

export function buildCodeModel(image: Uint8Array, def: XdfDefinition, result?: SweepResult): CodeModel {
    const swept = result ?? sweep(image);
    const spans = spansOf(def);
    const vectorLabels = new Map<number, [string, string]>();
    for (const seed of swept.seeds) {
        if (vectorLabels.has(seed.at)) continue;
        if (seed.why === 'reset vector') vectorLabels.set(seed.at, ['RESET', seed.why]);
        else if (seed.why.startsWith('interrupt vector ')) {
            const n = Number(seed.why.slice('interrupt vector '.length));
            vectorLabels.set(seed.at, [`IRQ ${(n * 4).toString(16).toUpperCase()}h`, seed.why]);
        }
    }

    const callers = new Map<number, Set<number>>();
    for (const e of swept.edges) {
        const set = callers.get(e.to) ?? new Set<number>();
        set.add(e.from);
        callers.set(e.to, set);
    }

    const funcs = new Map<number, CodeFunction>();
    const readersOf = new Map<string, Set<number>>();
    const unnamedCount = new Map<number, number>();
    let calAccesses = 0;

    for (const [at, fn] of swept.funcs) {
        const byItem = new Map<string, { title: string; addrs: Set<number>; tier: RefTier; how: 'reads' | 'walks' }>();
        const unnamed: number[] = [];
        for (const ref of fn.reads) {
            const a = ref.at;
            if (a === undefined || a < CAL_LO || a >= CAL_HI) continue;
            calAccesses++;
            const span = findSpan(spans, a);
            if (!span) {
                unnamed.push(a);
                unnamedCount.set(a, (unnamedCount.get(a) ?? 0) + 1);
                continue;
            }
            const bucket = byItem.get(span.id)
                ?? { title: span.title, addrs: new Set<number>(), tier: 'inferred' as RefTier, how: 'reads' as const };
            bucket.addrs.add(a);
            // One stated reference is enough to make the whole attribution stated, and one
            // indexed access is enough to say the function walks the table rather than reads a
            // single word out of it.
            if (tierOf(ref.via) === 'stated') bucket.tier = 'stated';
            if (ref.kind === 'indexed') bucket.how = 'walks';
            byItem.set(span.id, bucket);
            const set = readersOf.get(span.id) ?? new Set<number>();
            set.add(at);
            readersOf.set(span.id, set);
        }

        const [label, why] = labelFor(at, fn, vectorLabels);
        funcs.set(at, {
            at,
            end: fn.end,
            label,
            labelWhy: why,
            insnCount: fn.insns.length,
            returns: fn.returns,
            calls: fn.calls,
            callers: [...(callers.get(at) ?? [])].sort((x, y) => x - y),
            items: [...byItem]
                .map(([id, b]) => ({ id, title: b.title, addresses: [...b.addrs].sort((x, y) => x - y), tier: b.tier, how: b.how }))
                .sort((x, y) => y.addresses.length - x.addresses.length),
            unnamed: [...new Set(unnamed)].sort((x, y) => x - y),
            undef: fn.undef,
        });
    }

    const ordered = [...funcs.values()].sort((a, b) => a.at - b.at);
    let insns = 0;
    let undef = 0;
    let coveredBytes = 0;
    for (const f of swept.funcs.values()) {
        insns += f.insns.length;
        undef += f.undef;
        for (const i of f.insns) coveredBytes += i.len;
    }

    return {
        funcs,
        ordered,
        readersOf: new Map([...readersOf].map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
        unnamedReads: [...unnamedCount]
            .map(([at, count]) => ({ at, count }))
            .sort((a, b) => b.count - a.count || a.at - b.at),
        stats: {
            funcs: funcs.size,
            insns,
            undef,
            coveredBytes,
            execBytes: 0,
            calAccesses,
            itemsWithReader: readersOf.size,
            itemsTotal: def.items.length,
        },
    };
}

function labelFor(
    at: number,
    fn: FuncInfo,
    vectors: ReadonlyMap<number, [string, string]>,
): [string, string] {
    const named = NAMED_HANDLERS[at];
    if (named) return named;
    const vector = vectors.get(at);
    if (vector) return vector;
    return [`FN ${at.toString(16).toUpperCase().padStart(5, '0')}`, ''];
}

/** Binary search over the span list. */
function findSpan(spans: readonly Span[], at: number): Span | undefined {
    let lo = 0;
    let hi = spans.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = spans[mid];
        if (at < s.at) hi = mid - 1;
        else if (at >= s.at + s.len) lo = mid + 1;
        else return s;
    }
    // Overlapping spans mean the binary search can land past a container; check the neighbour.
    for (let i = Math.max(0, lo - 2); i < Math.min(spans.length, lo + 2); i++) {
        const s = spans[i];
        if (at >= s.at && at < s.at + s.len) return s;
    }
    return undefined;
}
