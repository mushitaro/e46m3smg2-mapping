/**
 * One instruction in, one instruction out — plus, where it can be justified, the physical
 * address the instruction touches.
 *
 * ## The part that matters: resolving `mem`
 *
 * A C166 `mem` operand is sixteen bits. Its top two bits pick one of four DPP registers and the
 * remaining fourteen are an offset inside the 16 KB page that register names. So the physical
 * address is `(DPP[mem >> 14] << 14) | (mem & 0x3FFF)` — and the whole question of "which
 * function reads this calibration table" is the question of what DPP held at that instant.
 *
 * `docs/full-image-analysis.md` §2.5 is emphatic that **no single mapping holds** across the
 * image, and it is right: DPP0 is caller-saved, it is pushed and popped around call sites, and
 * the live SFR dump caught it holding 3 while twenty-four separate `MOV DPP0,#000Ch` sites exist.
 * A resolver that assumed 0x0C globally would produce a cross-reference table that looked
 * complete and was fiction.
 *
 * So resolution is **tracked, not assumed**, and every resolved address carries how it was
 * reached:
 *
 * | `via`      | What happened | Trust |
 * |---|---|---|
 * | `extp`     | an `EXTP #pag10` immediately overrode the page | the instruction says so |
 * | `exts`     | an `EXTS #seg8` made it a plain segment offset | the instruction says so |
 * | `set`      | a `MOV DPPn,#imm` earlier in this same basic block | the code says so |
 * | `reset`    | the DPP was written at the documented init sites and never changed since | strong |
 * | `sfr`      | the operand lands in `0xFE00-0xFFFF`, the register file | definitional |
 * | *(absent)* | DPP unknown here | **not resolved, and not guessed** |
 *
 * Only `extp`, `exts` and `set` are strong enough to found a claim like "this function reads
 * `AUTO: A3`". The consumer decides; this module only refuses to lose the distinction.
 */

import { CC, ISA, SFR, lengthOf, type Flow, type OpDef } from './isa';

/** How a physical address was arrived at. See the table above. */
export type Via = 'extp' | 'exts' | 'set' | 'reset' | 'sfr';

export interface DataRef {
    /**
     * How the address was formed.
     *
     * `direct` is the whole address in the instruction — how a scalar is read. `indexed` is a
     * base-plus-register access, where the **displacement is the base and the register is the
     * subscript**, which is how a table is read. The distinction is the difference between "this
     * function reads this number" and "this function walks this table", and only the second one
     * can explain a 10x16 grid.
     *
     * Reading the displacement as the base is a claim, and it was tested before being made: of
     * 173 base-plus-displacement accesses whose displacement lands in the calibration body, 171
     * land on a programmed byte. 54.2% of that region is programmed, so chance predicts 94.
     */
    readonly kind: 'direct' | 'indexed';
    /** The 16-bit operand as encoded. */
    readonly mem: number;
    /** Physical address, when it could be justified. */
    readonly at?: number;
    readonly via?: Via;
    /** True when the instruction stores to it rather than loads from it. */
    readonly write: boolean;
    /** 1 for the `B` forms, 2 otherwise. */
    readonly width: 1 | 2;
}

export interface Insn {
    /** Image offset of the opcode byte. */
    readonly at: number;
    readonly len: 2 | 4;
    readonly text: string;
    readonly flow: Flow;
    /** Branch or call destination, as an image offset, when statically known. */
    readonly target?: number;
    readonly data?: DataRef;
    /** Set when the opcode is not in the table. `text` is then `DB <bytes>`. */
    readonly undef?: boolean;
    /** `MOV DPPn, #imm` — the sweep needs this to keep tracking. */
    readonly setsDpp?: { readonly n: number; readonly page: number };
    /**
     * `MOV Rwn, #data16` / `#data4` — a constant landing in a general register.
     *
     * This is how a table is reached. A constant is read with the address in the instruction, so
     * a static `mem` operand names it; a table is walked, so the code loads its base into a
     * register once and then indexes off it. Measured on this image: tracking only static
     * operands attributed 44 of 112 items and **not one of the twenty AUTO shift tables**, which
     * are the tables this tool exists to edit.
     */
    readonly setsReg?: { readonly n: number; readonly value: number };
    /** GPRs this instruction overwrites, so a tracked constant is dropped rather than trusted. */
    readonly killsReg?: readonly number[];
    /** `POP DPPn`, or any other write that makes the page unknowable here. */
    readonly clobbersDpp?: number;
    /** An `EXT*` prefix and how many instructions it covers. */
    readonly ext?: { readonly kind: 'p' | 's'; readonly value?: number; readonly count: number };
    /**
     * A base-plus-displacement access, left for the sweep to finish.
     *
     * The decoder sees `[R5+#0240h]` and cannot know what R5 holds; the sweep does, because it
     * has been following the path that loaded it. Splitting it this way keeps `decode` a pure
     * function of four bytes.
     */
    readonly indexed?: {
        readonly base: number;
        readonly disp: number;
        readonly write: boolean;
        readonly width: 1 | 2;
    };
}

/**
 * One page register's contents, and where that knowledge came from.
 *
 * Provenance is **per register**, and it has to be. The first version of this carried one
 * `seeded` flag for the whole set, so the moment any `MOV DPPn,#imm` executed, every subsequent
 * access through any of the four was labelled as if an instruction had established it. The
 * measurable consequence: all 1,865 calibration reads came back at the same confidence, four of
 * them were stores into flash — which cannot happen — and seventeen were repeat reads of
 * `FF FF FF FF`. Merging four registers' provenance into one boolean is how a resolver launders
 * an assumption into a citation.
 */
export interface PageValue {
    readonly page: number;
    readonly via: Via;
}

/** DPP state during a sweep. `undefined` means "not known here", which is a real answer. */
export type Dpp = Partial<Record<0 | 1 | 2 | 3, PageValue>>;

/**
 * What the four page registers hold after reset, per §2.5.
 *
 * DPP1 and DPP2 are listed there as strong inferences: the initialisation writes at `0x000458`
 * and `0x00045C` agree with the values read out of the live register file. DPP3 = 3 is what makes
 * the SFR window addressable at all, and the dump proves the window was addressable.
 *
 * **DPP0 is deliberately absent.** It is the one this project measured disagreeing with itself.
 */
export const RESET_DPP: Dpp = {
    1: { page: 0x0d, via: 'reset' },
    2: { page: 0x0b, via: 'reset' },
    3: { page: 0x03, via: 'reset' },
};

const REG_GPR_BASE = 0xf0;

/** Spell a `reg` operand: a GPR above 0xF0, otherwise a word in the register file. */
export function regName(reg: number, byteOp: boolean): string {
    if (reg >= REG_GPR_BASE) {
        const i = reg - REG_GPR_BASE;
        return byteOp ? (i & 1 ? `RH${i >> 1}` : `RL${i >> 1}`) : `R${i}`;
    }
    const addr = 0xfe00 + reg * 2;
    return SFR[addr] ?? `${hex4(addr)}h`;
}

export function hex4(v: number): string {
    return v.toString(16).toUpperCase().padStart(4, '0');
}
function hex2(v: number): string {
    return v.toString(16).toUpperCase().padStart(2, '0');
}

/** Where a 16-bit `mem` lands, given what is known about the page registers. */
export function resolve(mem: number, dpp: Dpp, ext?: Insn['ext']): { at?: number; via?: Via } {
    if (ext?.kind === 's' && ext.value !== undefined) return { at: (ext.value << 16) | mem, via: 'exts' };
    if (ext?.kind === 'p' && ext.value !== undefined) return { at: (ext.value << 14) | (mem & 0x3fff), via: 'extp' };
    /**
     * An override is in force but its page came from a register, so the address is NOT knowable —
     * and in particular it is **not** the DPP one.
     *
     * Falling through to the DPP here was silently wrong: `EXTP Rwm` exists precisely to bypass
     * the DPP for the next instruction, so using the DPP anyway produces a confident address for
     * the one case where the code went out of its way to say the DPP does not apply.
     */
    if (ext !== undefined && ext.value === undefined) return {};
    const held = dpp[((mem >> 14) & 3) as 0 | 1 | 2 | 3];
    if (held === undefined) return {};
    const at = (held.page << 14) | (mem & 0x3fff);
    if (at >= 0xfe00 && at <= 0xffff) return { at, via: 'sfr' };
    return { at, via: held.via };
}

/** True when the group writes its `mem`/`reg` destination rather than only reading it. */
function writesDest(m: string): boolean {
    return m !== 'CMP' && m !== 'CMPB';
}

export function decode(img: Uint8Array, at: number, dpp: Dpp = {}, ext?: Insn['ext']): Insn {
    const op = img[at];
    const def: OpDef | undefined = ISA[op];
    if (!def || at + 1 >= img.length) {
        return { at, len: 2, text: `DB   ${hex2(op)}h`, flow: 'seq', undef: true };
    }
    const len = lengthOf(def.f);
    if (at + len > img.length) {
        return { at, len: 2, text: `DB   ${hex2(op)}h`, flow: 'seq', undef: true };
    }
    const b1 = img[at + 1];
    const w = len === 4 ? img[at + 2] | (img[at + 3] << 8) : 0;
    const n = b1 >> 4;
    const mLow = b1 & 0x0f;
    const byteOp = def.b === true;
    const R = (i: number) => (byteOp ? `RL${i >> 1}` : `R${i}`);
    const pad = (s: string) => s.padEnd(5, ' ');

    const mk = (text: string, extra: Partial<Insn> = {}): Insn =>
        ({ at, len, text: pad(def.m) + ' ' + text, flow: def.flow, ...extra });

    switch (def.f) {
        case 'nm': {
            const spelled = (def.pat ?? '%n, %m').replace('%n', R(n)).replace('%m', R(mLow));
            // The destination is whichever register the spelling puts first, and for the store
            // forms — `[Rwm], Rwn` — nothing in the register file changes at all.
            const pat = def.pat ?? '%n, %m';
            const kills = pat.startsWith('%n') ? [n] : pat.startsWith('[%n+]') ? [n] : [];
            return mk(spelled, { killsReg: kills.length ? kills : undefined });
        }
        case 'n4':
            return mk((def.pat ?? '%n, #%d').replace('%n', R(n)).replace('%d', `${mLow}`), {
                setsReg: def.m === 'MOV' ? { n, value: mLow } : undefined,
                killsReg: def.m === 'MOV' ? undefined : [n],
            });
        case 'n0':
            return mk(R(n));
        case 'idx': {
            // The low nibble is a mode: 10ii = [Rwi], 11ii = [Rwi+], 0ddd = #data3.
            const mode = mLow >> 2;
            const i = mLow & 3;
            const operand = mode === 2 ? `[${R(i)}]` : mode === 3 ? `[${R(i)}+]` : `#${mLow & 7}`;
            return mk(`${R(n)}, ${operand}`, {
                indexed: mode >= 2 ? { base: i, disp: 0, write: false, width: byteOp ? 1 : 2 } : undefined,
                killsReg: [n],
            });
        }
        case 'regmem': {
            const r = resolve(w, dpp, ext);
            return mk(`${regName(b1, byteOp)}, ${memText(w, r)}`, {
                data: { kind: 'direct', mem: w, ...r, write: false, width: byteOp ? 1 : 2 },
                killsReg: b1 >= REG_GPR_BASE ? [b1 - REG_GPR_BASE] : undefined,
            });
        }
        case 'memreg': {
            const r = resolve(w, dpp, ext);
            return mk(`${memText(w, r)}, ${regName(b1, byteOp)}`, {
                data: { kind: 'direct', mem: w, ...r, write: writesDest(def.m), width: byteOp ? 1 : 2 },
            });
        }
        case 'reg16': {
            const target = def.m === 'PCALL' ? (at & 0xff0000) | w : undefined;
            const isDpp = def.m === 'MOV' && b1 <= 3;
            const isGpr = def.m === 'MOV' && b1 >= REG_GPR_BASE;
            return mk(`${regName(b1, false)}, #${hex4(w)}h`, {
                target,
                setsDpp: isDpp ? { n: b1, page: w & 0x3ff } : undefined,
                setsReg: isGpr ? { n: b1 - REG_GPR_BASE, value: w } : undefined,
                killsReg: def.m !== 'MOV' && b1 >= REG_GPR_BASE ? [b1 - REG_GPR_BASE] : undefined,
            });
        }
        case 'reg8':
            return mk(`${regName(b1, true)}, #${hex2(w & 0xff)}h`);
        case 'nm16': {
            const pat = def.pat ?? '%n, [%m+#%d]';
            const store = pat.startsWith('[');
            return mk(
                pat.replace('%n', R(n)).replace('%m', `R${mLow}`).replace('%d', `${hex4(w)}h`),
                {
                    indexed: { base: mLow, disp: w, write: store, width: byteOp ? 1 : 2 },
                    killsReg: store ? undefined : [n],
                },
            );
        }
        case 'imem': {
            const r = resolve(w, dpp, ext);
            const store = (def.pat ?? '').startsWith('[');
            return mk(
                (def.pat ?? '[%n], %M').replace('%n', `R${b1 & 0x0f}`).replace('%M', memText(w, r)),
                { data: { kind: 'direct', mem: w, ...r, write: !store, width: byteOp ? 1 : 2 } },
            );
        }
        case 'bitq':
            return mk(`${bitName(b1)}.${op >> 4}`);
        case 'bfld':
            return mk(`${bitName(b1)}, #${hex2(w & 0xff)}h, #${hex2(w >> 8)}h`);
        case 'bitbit': {
            const qz = w >> 8;
            return mk(`${bitName(img[at + 2])}.${qz & 0x0f}, ${bitName(b1)}.${qz >> 4}`);
        }
        case 'bitrel': {
            const qz = w >> 8;
            const rel = (img[at + 2] << 24) >> 24;
            return mk(`${bitName(b1)}.${qz >> 4}, ${hex4(rel)}h`, { target: at + 4 + rel * 2 });
        }
        case 'ccrel': {
            const rel = (b1 << 24) >> 24;
            const target = at + 2 + rel * 2;
            return mk(`${CC[op >> 4]}, ${labelOf(target)}`, { target });
        }
        case 'rel': {
            const rel = (b1 << 24) >> 24;
            const target = at + 2 + rel * 2;
            return mk(labelOf(target), { target });
        }
        case 'ccaddr': {
            const target = (at & 0xff0000) | w;
            return mk(`${CC[b1 >> 4]}, ${labelOf(target)}`, { target });
        }
        case 'segaddr': {
            const target = (b1 << 16) | w;
            return mk(`${hex2(b1)}:${hex4(w)}h`, { target });
        }
        case 'ccind':
            return mk(`${CC[n]}, [R${mLow}]`);
        case 'reg': {
            const isDpp = b1 <= 3;
            return mk(regName(b1, false), {
                clobbersDpp: def.m === 'POP' && isDpp ? b1 : undefined,
            });
        }
        case 'trap':
            return mk(`#${hex2(b1 >> 1)}h`);
        case 'none':
            return { at, len, text: def.m, flow: def.flow };
        case 'extr':
            return mk(`#${(b1 >> 4 & 3) + 1}`, {
                ext: { kind: 'p', count: (b1 >> 4 & 3) + 1 },
            });
        case 'extreg': {
            /**
             * `DC` second byte is `<irang2:2><restore:1><seg:1><reg:4>`.
             *
             * The first cut read the selector as bit 3 and the register as three bits, which
             * decoded `dc 0b` as `EXTS R3` when it is `EXTP R11`. The flash driver is what caught
             * it: at `0x017FE` it loads `R10 = #AAAAh` and `R11 = #0010h` and then does
             * `dc 0b` / `MOV [R10], R1` — an address in one register and its page in the next,
             * which only reads correctly as `EXTP R11`. Three bits cannot name R11 at all.
             */
            const kind = b1 & 0x10 ? 's' : 'p';
            const restore = (b1 & 0x20) !== 0;
            const count = (b1 >> 6) + 1;
            const name = `EXT${kind === 's' ? 'S' : 'P'}${restore ? 'R' : ''}`;
            return { at, len, text: `${pad(name)} R${b1 & 0x0f}, #${count}`,
                flow: 'seq', ext: { kind, count } };
        }
        case 'extimm': {
            // Bits 7-6 of the second byte select the flavour; 5-4 carry the range.
            const sel = b1 >> 6;
            const count = ((b1 >> 4) & 3) + 1;
            const kind = sel === 1 || sel === 3 ? 'p' : 's';
            const name = ['EXTS', 'EXTP', 'EXTSR', 'EXTPR'][sel];
            const shown = kind === 'p' ? `#${hex4(w)}h` : `#${hex2(w & 0xff)}h`;
            return { at, len, text: `${pad(name)} ${shown}, #${count}`, flow: 'seq',
                ext: { kind, value: kind === 'p' ? w & 0x3ff : w & 0xff, count } };
        }
        case 'sys':
            return { at, len, text: def.m, flow: def.m === 'SRST' ? 'ret' : 'seq' };
    }
}

function bitName(q: number): string {
    const addr = q < 0x80 ? 0xfd00 + q * 2 : 0xff00 + (q - 0x80) * 2;
    return SFR[addr] ?? `${hex4(addr)}h`;
}

function memText(mem: number, r: { at?: number; via?: Via }): string {
    if (r.via === 'sfr' && r.at !== undefined) return SFR[r.at] ?? `${hex4(r.at)}h`;
    if (r.at === undefined) return `${hex4(mem)}h`;
    return `${hex4(mem)}h`;
}

/** Code labels are image offsets, so the listing and the address bar speak the same language. */
export function labelOf(target: number): string {
    return `L_${target.toString(16).toUpperCase().padStart(5, '0')}`;
}
