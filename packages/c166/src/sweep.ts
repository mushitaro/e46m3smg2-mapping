/**
 * Recursive-descent sweep: from the entry points the hardware itself names, out to every
 * function reachable from them, carrying page state along each path.
 *
 * ## Why not a linear sweep
 *
 * A linear sweep is one wrong byte away from producing fluent nonsense — it desynchronises inside
 * a jump table, decodes the rest of the island as instructions, and hands you a listing that
 * reads like code. Measured on this image: sweeping `0x400`-`0x2C000` straight through leaves
 * 257 undefined bytes, and every cluster of them sits at a regular stride, which is what a data
 * table looks like when you insist on reading it as instructions.
 *
 * Following control flow instead means a byte is only ever decoded because something branched to
 * it. Bytes nothing reaches stay unclassified, which is the honest answer for them.
 *
 * ## Where the sweep starts
 *
 * From the two vector tables, which `docs/full-image-analysis.md` §2.2 established by
 * measurement: the hardware table at `0x00000` has five entries that go straight into segment 0
 * and 123 that forward to a second table at `0x10000`, of which 19 hold live handlers and 109
 * hold a jump to themselves — the C166 idiom for "let the watchdog deal with it".
 *
 * Nothing is seeded on a guess. If a function is only ever reached through a computed jump, it
 * will not appear, and it not appearing is information.
 *
 * ## The DPP shadow stack
 *
 * §2.5 warns that no single DPP mapping holds, and the way the code actually behaves is
 * `PUSH DPP0` / `MOV DPP0,#000Ch` / ... / `POP DPP0` — 18 push sites, and 13 of the 24
 * `MOV DPP0,#000Ch` sit directly after one. So the sweep keeps a small value stack: a push
 * records what was known, a pop restores it exactly. That is not a heuristic, it is what the
 * instruction pair does, and it means page state survives the idiom instead of being thrown away
 * at every call boundary.
 */

import { decode, resolve, RESET_DPP, type DataRef, type Dpp, type Insn, type PageValue } from './decode';

export interface FuncInfo {
    /** Entry point, as an image offset. */
    readonly at: number;
    /** One past the highest byte any path reached. */
    end: number;
    readonly insns: Insn[];
    /** Callee entry points, deduplicated, in address order. */
    readonly calls: number[];
    /** Targets of a jump that leaves this function without returning. */
    readonly tails: number[];
    /** Resolved loads, strongest justification first. */
    readonly reads: DataRef[];
    readonly writes: DataRef[];
    /** True when at least one path ends in RET/RETS/RETI. */
    returns: boolean;
    /** Instructions whose page could not be justified, so their operand went unresolved. */
    unresolved: number;
    /** Bytes decoded as `DB` because the opcode is not in the table. */
    undef: number;
}

export interface SweepResult {
    readonly funcs: Map<number, FuncInfo>;
    /** Entry points the sweep was seeded with, and why. */
    readonly seeds: { readonly at: number; readonly why: string }[];
    /** Every call edge, as `caller -> callee`. */
    readonly edges: { readonly from: number; readonly to: number }[];
}

/** A pending path inside one function: where to resume, and what the pages held on arrival. */
interface Path {
    at: number;
    dpp: Dpp;
    stack: (PageValue | undefined)[];
    /** Constants known to be in R0-R15 here. `undefined` means "not tracked", never "zero". */
    regs: (number | undefined)[];
}

const MAX_INSNS_PER_FUNC = 20000;

/**
 * Where instructions can be, per `docs/full-image-analysis.md` §5.2, which settled every one of
 * these ranges by measurement — segment self-reference for the code, and byte profile plus the
 * checksum descriptors for the rest.
 *
 * This is a **guard, not a hint**. Without it the sweep followed one bad jump into `0x306B2` and
 * produced two "functions" of 971 and 964 instructions sitting in the middle of the calibration
 * window — a region `docs/vehicle-session.md` records as containing not one byte of instruction.
 * A decoder will always find something to decode; the map says where finding something means
 * anything.
 */
export const EXEC_RANGES: readonly (readonly [number, number])[] = [
    /**
     * Starts at 0x400, not 0. `0x00000-0x001FF` is the hardware vector table — 128 `JMPS` slots,
     * which `vectorSeeds` reads directly from the bytes and does not need to reach by branching —
     * and §5.2 puts the first code at `0x00400`. Leaving the table in let a stray target land at
     * `0x229` and decode the slots as instructions.
     */
    [0x00400, 0x02c2a],
    // 0x08000-0x08238 is deliberately absent. It is a CRC-16/ARC lookup table followed by two
    // `$Revision` strings, and including it produced four stores into flash — `SUB 7665h, FEA4h`
    // is the letters "ev" of "Revision". The impossible write is what caught it.
    //
    /**
     * `0x08240-0x0FFFF` — the region §5.2's table does not mention, and §2.2 proves is code.
     *
     * This was missing, and the cost was not subtle: `0x00AD30` is where §2.2 identified the ASC0
     * receive interrupt, *by name*, from the `MOVB RL4, S0RBUF` at `0x00AD3A` — and the sweep
     * could not reach it, so the entire serial path was invisible. Every DS2 telegram this ECU
     * has ever answered is handled by code that was outside the range table.
     *
     * §5.1's density test could not have found it. That test asks how often `F2`/`F6` appear:
     * 5.59% / 4.24% in segment 4, 0.07% / 0.13% in calibration. Here it is 0.64% / 0.57%, because
     * the region is **code islands in mostly-erased flash** — 42.7% of it is `0xFF`. A density
     * measure averages that away.
     *
     * What settles it instead is decoding the four addresses §2.2 named. All four are textbook
     * C166 interrupt prologues (`MOV F64Ah, R0` / `SCXT CP, #F64Ah`), `0x00AD30` reads `S0RBUF`
     * ten bytes in exactly as documented, `0x00B0B4` opens with the `BFLDL`/`BFLDH` on `S0CON`
     * §2.2 describes, and `0x009478` sets `DPP0 = 0x000C` and `DPP2 = 0x000B` — the values §2.5
     * infers, here being written by a handler.
     *
     * Including a sparse region is safe **because the sweep is recursive**: a byte is decoded only
     * if something branched to it, so the erased stretches are never read as instructions. A
     * linear sweep could not be given this range.
     */
    [0x08240, 0x10000],
    [0x10000, 0x10200],
    [0x40000, 0x5fb90],
    [0x6d000, 0x6f574],
    [0x70000, 0x7bfea],
];

export function isExecutable(at: number): boolean {
    for (const [lo, hi] of EXEC_RANGES) if (at >= lo && at < hi) return true;
    return false;
}

/**
 * Ranges dense enough that a linear scan for call sites is safe.
 *
 * `callSiteSeeds` reads every `CALLS`/`CALLA` byte pattern it can find, which works because a
 * false hit has to point at an even address inside a code range and then decode cleanly. In
 * segment 4 that filter is strong: 0.31% of the region is `0xFF` and there is almost nothing for
 * a `DA` byte to be part of except a real call.
 *
 * `0x08240-0x0FFFF` is 42.73% erased, with code in islands. There, a `DA` byte in a data island
 * points at padding, and padding decodes **without a single undefined opcode** — `00 00` is
 * `ADD R0, R0` — so the junk filter downstream cannot see it either. One such seed produced a
 * function that appeared to store into flash, which is the only reason it was noticed.
 *
 * So the sparse region is reached the way it is actually entered: by following control flow from
 * the interrupt vectors. That is not a weaker method, it is the correct one — `0x00AD30` is a
 * handler, and a handler is reached from its vector.
 */
const DENSE_RANGES: readonly (readonly [number, number])[] = [
    [0x00400, 0x02c2a],
    [0x40000, 0x5fb90],
    [0x6d000, 0x6f574],
    [0x70000, 0x7bfea],
];

/** The two vector tables are jump slots, not function bodies; nothing should be seeded into them. */
function isEntryCandidate(at: number): boolean {
    return isCodeAddress(at) && at >= 0x400 && !(at >= 0x10000 && at < 0x10200);
}

/**
 * A C166 instruction is two-byte aligned. Always — the core cannot fetch from an odd address.
 *
 * So an odd branch target is not a branch target, it is a byte that was read as one, and following
 * it produces a listing out of phase with the instruction stream. This was found the way the other
 * range mistake was found: a "function" appeared at `0x1`, which is not an address any C166 can
 * execute, and it reported stores into flash.
 */
function isCodeAddress(at: number): boolean {
    return at % 2 === 0 && isExecutable(at);
}

/**
 * Every `CALLS` and `CALLA` in the image, read as a seed.
 *
 * There is a bootstrapping problem otherwise. §5.1 counted the segment byte after `CALLS`/`JMPS`
 * across the code regions and found thousands — 594 self-references in segment 5 alone — but the
 * reset path reaches none of them, because the dispatch into segments 4-7 is table-driven. A
 * sweep that only follows control flow from the vectors therefore sees about 9,000 instructions
 * of a 185 KB program and stops.
 *
 * So the call sites are harvested by a linear scan first, and the sweep starts from all of them.
 * A `DA` byte inside data will occasionally look like a call; the guard is that its target must
 * be even and inside a measured executable range, and that the function it opens must then decode
 * cleanly — `sweep` drops any body whose undefined-opcode ratio says it was never code. Junk
 * seeds are cheap and detectable; missing 175 KB of program is neither.
 */
export function callSiteSeeds(img: Uint8Array): { at: number; why: string }[] {
    const out: { at: number; why: string }[] = [];
    const seen = new Set<number>();
    for (const [lo, hi] of DENSE_RANGES) {
        for (let a = lo; a + 4 <= hi; a += 2) {
            const op = img[a];
            let target: number | undefined;
            if (op === 0xda) target = (img[a + 1] << 16) | img[a + 2] | (img[a + 3] << 8);
            else if (op === 0xca) target = (a & 0xff0000) | img[a + 2] | (img[a + 3] << 8);
            if (target === undefined || seen.has(target) || !isEntryCandidate(target)) continue;
            seen.add(target);
            out.push({ at: target, why: `called from 0x${a.toString(16).toUpperCase()}` });
        }
    }
    return out;
}

/**
 * Function pointers, found by looking for them rather than by being told where they are.
 *
 * §5.1 records that the bulk of the program — segments 4, 5, 6 and 7, about 185 KB — is reached
 * from somewhere, and that the reset path does not `CALLS` into it. §8 item 10 names two
 * candidate tables at `0x2DC28` and `0x2F056` and says a disassembly could confirm they are
 * jump tables. This function is that confirmation, done generically: any run of four or more
 * consecutive little-endian u32 that all land on an even address inside an executable range is
 * a table of code pointers, and four in a row is far past coincidence for values whose targets
 * occupy 23% of a 512 KiB space.
 *
 * The run length is the whole guard. Three would admit accidental triples; this reports the runs
 * it found so the count can be checked against the two the analysis predicted.
 */
export function pointerSeeds(img: Uint8Array, from = 0x2c000, to = 0x2f998): { at: number; why: string }[] {
    const out: { at: number; why: string }[] = [];
    const u32 = (o: number) => img[o] | (img[o + 1] << 8) | (img[o + 2] << 16) | (img[o + 3] << 24);
    const ok = (v: number) => v % 2 === 0 && isExecutable(v);
    let i = from;
    while (i + 4 <= to) {
        if (!ok(u32(i))) { i += 2; continue; }
        let j = i;
        while (j + 4 <= to && ok(u32(j))) j += 4;
        const count = (j - i) / 4;
        if (count >= 4) {
            for (let k = i; k < j; k += 4) {
                out.push({ at: u32(k), why: `pointer table 0x${i.toString(16).toUpperCase()} [${(k - i) / 4}/${count}]` });
            }
        }
        i = j >= i + 4 ? j : i + 2;
    }
    return out;
}

/**
 * Read the two vector tables and return the handler addresses that are actually live.
 *
 * A slot whose `JMPS` targets its own address is the deliberate hang, not a handler, and is
 * excluded — 109 of them, which is most of the table. Counting those as entry points would
 * manufacture 109 one-instruction functions and bury the 19 real ones.
 */
export function vectorSeeds(img: Uint8Array): { at: number; why: string }[] {
    const out: { at: number; why: string }[] = [];
    const readSlot = (slotAt: number): number | null => {
        if (img[slotAt] !== 0xfa) return null;
        return (img[slotAt + 1] << 16) | img[slotAt + 2] | (img[slotAt + 3] << 8);
    };
    for (let v = 0; v < 128; v++) {
        const slot = v * 4;
        const first = readSlot(slot);
        if (first === null) continue;
        // A forward into the second table is not itself a handler; follow it one hop.
        const second = first >= 0x10000 && first < 0x10200 ? readSlot(first) : null;
        const target = second ?? first;
        if (target === null) continue;
        if (second !== null && target === first) continue; // the self-jump: a deliberate hang
        if (target === slot) continue;
        out.push({ at: target, why: v === 0 ? 'reset vector' : `interrupt vector ${v}` });
    }
    return out;
}

export function sweep(img: Uint8Array, extraSeeds: { at: number; why: string }[] = []): SweepResult {
    const seeds = [...vectorSeeds(img), ...pointerSeeds(img), ...callSiteSeeds(img), ...extraSeeds]
        .filter(s => isEntryCandidate(s.at) || s.at === 0x44e);
    const funcs = new Map<number, FuncInfo>();
    const edges: { from: number; to: number }[] = [];
    const queue: number[] = [];
    const queued = new Set<number>();

    for (const s of seeds) {
        if (!queued.has(s.at)) { queued.add(s.at); queue.push(s.at); }
    }

    while (queue.length) {
        const entry = queue.shift()!;
        if (funcs.has(entry)) continue;
        const fn = walk(img, entry);
        // A body that is one third undefined opcodes was never code; the seed that opened it was
        // a data byte that happened to spell CALLS. Dropping it also drops its call edges, so a
        // junk seed cannot recruit more junk.
        if (fn.insns.length >= 4 && fn.undef / fn.insns.length > 0.25) continue;
        funcs.set(entry, fn);
        for (const callee of fn.calls) {
            edges.push({ from: entry, to: callee });
            if (!queued.has(callee)) { queued.add(callee); queue.push(callee); }
        }
        for (const tail of fn.tails) {
            edges.push({ from: entry, to: tail });
            if (!queued.has(tail)) { queued.add(tail); queue.push(tail); }
        }
    }

    return { funcs, seeds, edges };
}

/** Walk one function to exhaustion, following every path, and report what it touched. */
export function walk(img: Uint8Array, entry: number): FuncInfo {
    const fn: FuncInfo = {
        at: entry, end: entry, insns: [], calls: [], tails: [],
        reads: [], writes: [], returns: false, unresolved: 0, undef: 0,
    };
    const seen = new Set<number>();
    const callSet = new Set<number>();
    const tailSet = new Set<number>();
    const paths: Path[] = [{ at: entry, dpp: { ...RESET_DPP }, stack: [], regs: new Array(16).fill(undefined) }];

    while (paths.length) {
        const path = paths.pop()!;
        let { at } = path;
        let dpp = { ...path.dpp };
        const stack = [...path.stack];
        const regs = [...path.regs];
        /** An `EXT*` prefix in force, and how many instructions it still covers. */
        let ext: Insn['ext'] | undefined;
        let extLeft = 0;

        for (;;) {
            if (at < 0 || at + 1 >= img.length || !isCodeAddress(at)) break;
            if (seen.has(at)) break;
            if (fn.insns.length >= MAX_INSNS_PER_FUNC) break;
            seen.add(at);

            const i = decode(img, at, dpp, extLeft > 0 ? ext : undefined);
            fn.insns.push(i);
            if (at + i.len > fn.end) fn.end = at + i.len;
            if (i.undef) fn.undef++;

            if (i.data) {
                if (i.data.at === undefined) fn.unresolved++;
                else (i.data.write ? fn.writes : fn.reads).push(i.data);
            }

            // A base-plus-displacement access resolves only when this path loaded the base with
            // a constant. A call in between drops it: the callee may use any register, and
            // guessing that it did not is exactly how a table gets attributed to the wrong code.
            if (i.indexed) {
                // Prefer a base this path actually loaded; fall back to reading the displacement
                // as the base, which is the compiler's ordinary shape for `table[i]`.
                const held = regs[i.indexed.base];
                const mem = held !== undefined ? (held + i.indexed.disp) & 0xffff : i.indexed.disp;
                const r = mem === 0 ? {} : resolve(mem, dpp, extLeft > 0 ? ext : undefined);
                if (r.at === undefined) fn.unresolved++;
                else {
                    const ref: DataRef = {
                        kind: held !== undefined ? 'direct' : 'indexed',
                        mem, ...r, write: i.indexed.write, width: i.indexed.width,
                    };
                    (i.indexed.write ? fn.writes : fn.reads).push(ref);
                }
            }

            // Page bookkeeping, in the order the hardware would see it.
            if (extLeft > 0) extLeft--;
            if (i.ext) { ext = i.ext; extLeft = i.ext.count; }
            if (i.setsDpp) dpp = { ...dpp, [i.setsDpp.n]: { page: i.setsDpp.page, via: 'set' } };
            if (i.killsReg) for (const n of i.killsReg) regs[n] = undefined;
            if (i.setsReg) regs[i.setsReg.n] = i.setsReg.value;
            if (i.text.startsWith('PUSH ') && /PUSH\s+DPP([0-3])/.test(i.text)) {
                const n = Number(/PUSH\s+DPP([0-3])/.exec(i.text)![1]);
                stack.push(dpp[n as 0 | 1 | 2 | 3]);
            }
            if (i.clobbersDpp !== undefined) {
                const restored = stack.pop();
                dpp = { ...dpp, [i.clobbersDpp]: restored };
            }

            if (i.flow === 'ret') { fn.returns = true; break; }
            if (i.flow === 'call') {
                if (i.target !== undefined && isCodeAddress(i.target)) callSet.add(i.target);
                // Registers do not survive a call. C166 has no callee-saved GPR convention this
                // sweep can rely on, and a stale base would attribute a table read to whichever
                // constant happened to be left over.
                regs.fill(undefined);
                at += i.len;
                continue;
            }
            if (i.flow === 'jmp') {
                if (i.target === undefined) break;
                // A jump backwards inside what we have already walked is a loop; forward and far
                // is a tail call into another function. The boundary is the entry we started at.
                if (!isCodeAddress(i.target)) break;
                if (i.target < entry || i.target > fn.end + 0x4000) { tailSet.add(i.target); break; }
                at = i.target;
                continue;
            }
            if (i.flow === 'cjmp') {
                if (i.target !== undefined && isCodeAddress(i.target)) {
                    paths.push({ at: i.target, dpp: { ...dpp }, stack: [...stack], regs: [...regs] });
                }
                at += i.len;
                continue;
            }
            if (i.flow === 'indirect') break;
            at += i.len;
        }
    }

    fn.insns.sort((a, b) => a.at - b.at);
    fn.calls.push(...[...callSet].sort((a, b) => a - b));
    fn.tails.push(...[...tailSet].sort((a, b) => a - b));
    return fn;
}
