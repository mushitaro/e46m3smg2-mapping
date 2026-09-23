/**
 * The C16x / ST10 instruction set, as a table.
 *
 * ## Why this exists at all
 *
 * Every open question left in `docs/full-image-analysis.md` §8 ends with the same sentence:
 * "逆アセンブルで確認できる". Ten of eleven. The tool could read the car, name the checksum and
 * decode 111 calibration items, and still could not answer the one question a tuner actually
 * asks — **who reads this table?** A number you can edit and cannot trace is a number you are
 * guessing at.
 *
 * **Ghidra is not the reason this exists — the C166 is.** Ghidra 12.1.3 and a JDK are installed
 * (in WSL, alongside a working `mss54-ghidra` project), and the sibling CSL project runs a full
 * headless pipeline through them. That works because the MSS54 is an MC68376: CPU32, which the
 * stock 68000 module covers once it is topped up from upstream. **Ghidra ships no C166/ST10
 * language at all** — the processor list goes 6502, 68000, 8048, 8051 … Z80, tricore, x86, and
 * C16x is nowhere in it.
 *
 * That is one reason. The other is architectural and does not go away if a SLEIGH module appears:
 * the CODE tab disassembles **in the browser, on the bytes the user just read off their own car**.
 * A headless tool cannot do that. Ghidra's place is offline analysis — where its decompiler gives
 * C, which this decoder never will — and the two are complements, not alternatives.
 *
 * ## What is asserted and what is inferred
 *
 * Opcode-to-mnemonic is a **fact about the silicon**, not an opinion, and the table below is
 * checked against the five encodings this project had already established by hand from the real
 * dump before any of this was written:
 *
 *   `FA 00 4E 04`  JMPS 00:044E        the reset vector, image offset 0
 *   `EC 00`        PUSH DPP0           18 sites
 *   `E6 00 0C 00`  MOV DPP0, #000Ch    24 sites
 *   `D7 40 0C 00`  EXTP #000Ch, #1
 *   `F3 F8 B2 FE`  MOVB RL4, S0RBUF    at 0x00AD3A, the ASC0 receive handler
 *
 * Those live in `c166.test.ts`. They are not a spot check — they are five independent points
 * that a wrong table cannot pass, one from each of five different instruction formats
 * (`segaddr`, `reg`, `reg16`, `extimm`, `regmem`).
 *
 * Undefined opcodes are **left undefined**. A decoder that invents a plausible mnemonic for a
 * byte it does not know produces a listing that reads correctly and is wrong, which is the one
 * outcome worse than a gap. `UNDEF` is a first-class result and the sweep counts it.
 */

/** How the bytes after the opcode are laid out. Determines instruction length. */
export type Fmt =
    /** 2B `op nm` — two 4-bit GPR numbers. */
    | 'nm'
    /** 2B `op n#` — GPR and a 4-bit immediate. */
    | 'n4'
    /** 2B `op n-` — one GPR, low nibble unused. */
    | 'n0'
    /** 2B `op n:mode:i` — `[Rwi]`, `[Rwi+]`, `[-Rwi]` or `#data3`. */
    | 'idx'
    /** 4B `op RR LL HH` — `reg, mem`. */
    | 'regmem'
    /** 4B `op RR LL HH` — `mem, reg` (same bytes, operands printed the other way round). */
    | 'memreg'
    /** 4B `op RR LL HH` — `reg, #data16`. */
    | 'reg16'
    /** 4B `op RR DD --` — `reg, #data8`. */
    | 'reg8'
    /** 4B `op nm LL HH` — `Rwn, [Rwm + #data16]`. */
    | 'nm16'
    /** 4B `op 0n LL HH` — `[Rwn], mem` or `mem, [Rwn]`. */
    | 'imem'
    /** 2B `op QQ` — a bit in `bitoffQ`; the bit number is the opcode's high nibble. */
    | 'bitq'
    /** 4B `op QQ MM DD` — bit field, mask and data. */
    | 'bfld'
    /** 4B `op QQ ZZ qz` — bit to bit. */
    | 'bitbit'
    /** 4B `op QQ rr qz` — bit-conditional relative jump. */
    | 'bitrel'
    /** 2B `op rr` — relative jump, condition from the opcode's high nibble. */
    | 'ccrel'
    /** 2B `op rr` — unconditional relative call. */
    | 'rel'
    /** 4B `op c0 LL HH` — condition and a 16-bit code address. */
    | 'ccaddr'
    /** 4B `op SS LL HH` — segment and a 16-bit code address. */
    | 'segaddr'
    /** 2B `op cn` — condition and an indirect target. */
    | 'ccind'
    /** 2B `op RR` — one `reg`. */
    | 'reg'
    /** 2B `op tt` — `#trap7`. */
    | 'trap'
    /** 2B `op --` — no operands. */
    | 'none'
    /** 2B `op ii` — `#irang2`, plus the ATOMIC/EXTR selector. */
    | 'extr'
    /** 2B `op im` — `Rwm, #irang2`, plus the EXTP/EXTS selector. */
    | 'extreg'
    /** 4B `op ii pp pp` — `#pag10` or `#seg8`, plus `#irang2`. */
    | 'extimm'
    /** 4B, fixed byte pattern — the protected system instructions. */
    | 'sys';

/** What this instruction does to control flow, which is all the sweep needs to know. */
export type Flow =
    | 'seq'
    /** Falls through OR branches. */
    | 'cjmp'
    /** Never falls through. */
    | 'jmp'
    /** Falls through; the target is a new function. */
    | 'call'
    /** Never falls through; ends a function. */
    | 'ret'
    /** Target is not statically known. */
    | 'indirect';

export interface OpDef {
    readonly m: string;
    readonly f: Fmt;
    readonly flow: Flow;
    /** True for the byte-wide member of a pair, so the formatter picks `Rb` over `Rw`. */
    readonly b?: true;
    /**
     * Operand spelling, when the format alone does not fix it.
     *
     * Ten opcodes share the `nm` shape — two GPR nibbles — and mean ten different things by it:
     * `MOV Rwn, Rwm` and `MOV [-Rwm], Rwn` are the same two nibbles read in opposite directions.
     * `%n` and `%m` are the two registers; everything else is literal.
     */
    readonly pat?: string;
}

/** Instruction length in bytes, from the format alone. C166 has only 2 and 4. */
export function lengthOf(f: Fmt): 2 | 4 {
    switch (f) {
        case 'regmem':
        case 'memreg':
        case 'reg16':
        case 'reg8':
        case 'nm16':
        case 'imem':
        case 'bfld':
        case 'bitbit':
        case 'bitrel':
        case 'ccaddr':
        case 'segaddr':
        case 'extimm':
        case 'sys':
            return 4;
        default:
            return 2;
    }
}

const T: (OpDef | undefined)[] = new Array(256).fill(undefined);

function put(op: number, m: string, f: Fmt, flow: Flow = 'seq', b?: true, pat?: string) {
    T[op] = { m, f, flow, b, pat };
}

/**
 * The eight two-operand groups. Each occupies a row of sixteen and lays its forms out in the
 * same order, which is why this is a loop and not eighty lines: the regularity is the ISA's,
 * and writing it out by hand would only create eighty chances to mistype one.
 *
 * CMP is the exception — it has no destination, so the `mem, reg` pair is not defined for it.
 */
const GROUPS: readonly [number, string][] = [
    [0x00, 'ADD'],
    [0x10, 'ADDC'],
    [0x20, 'SUB'],
    [0x30, 'SUBC'],
    [0x40, 'CMP'],
    [0x50, 'XOR'],
    [0x60, 'AND'],
    [0x70, 'OR'],
];

for (const [base, name] of GROUPS) {
    put(base + 0x0, name, 'nm');
    put(base + 0x1, name + 'B', 'nm', 'seq', true);
    put(base + 0x2, name, 'regmem');
    put(base + 0x3, name + 'B', 'regmem', 'seq', true);
    if (name !== 'CMP') {
        put(base + 0x4, name, 'memreg');
        put(base + 0x5, name + 'B', 'memreg', 'seq', true);
    }
    put(base + 0x6, name, 'reg16');
    put(base + 0x7, name + 'B', 'reg8', 'seq', true);
    put(base + 0x8, name, 'idx');
    put(base + 0x9, name + 'B', 'idx', 'seq', true);
}

/** `xD` is JMPR for all sixteen conditions. `cc_UC` never falls through; the rest do. */
for (let cc = 0; cc < 16; cc++) {
    put((cc << 4) | 0x0d, 'JMPR', 'ccrel', cc === 0 ? 'jmp' : 'cjmp');
}

/** `xE` clears and `xF` sets bit `x` of the byte-addressed bit word in the operand. */
for (let q = 0; q < 16; q++) {
    put((q << 4) | 0x0e, 'BCLR', 'bitq');
    put((q << 4) | 0x0f, 'BSET', 'bitq');
}

// --- bit-manipulation and bit-conditional branches (the `xA` column) -----------------------
put(0x0a, 'BFLDL', 'bfld');
put(0x1a, 'BFLDH', 'bfld');
put(0x2a, 'BCMP', 'bitbit');
put(0x3a, 'BMOVN', 'bitbit');
put(0x4a, 'BMOV', 'bitbit');
put(0x5a, 'BOR', 'bitbit');
put(0x6a, 'BAND', 'bitbit');
put(0x7a, 'BXOR', 'bitbit');
put(0x8a, 'JB', 'bitrel', 'cjmp');
put(0x9a, 'JNB', 'bitrel', 'cjmp');
put(0xaa, 'JBC', 'bitrel', 'cjmp');
put(0xba, 'JNBS', 'bitrel', 'cjmp');
put(0xca, 'CALLA', 'ccaddr', 'call');
put(0xda, 'CALLS', 'segaddr', 'call');
put(0xea, 'JMPA', 'ccaddr', 'cjmp');
put(0xfa, 'JMPS', 'segaddr', 'jmp');

// --- multiply, divide, and the call/return column (`xB`) ------------------------------------
put(0x0b, 'MUL', 'nm');
put(0x1b, 'MULU', 'nm');
put(0x2b, 'PRIOR', 'nm');
put(0x4b, 'DIV', 'n0');
put(0x5b, 'DIVU', 'n0');
put(0x6b, 'DIVL', 'n0');
put(0x7b, 'DIVLU', 'n0');
put(0x9b, 'TRAP', 'trap', 'call');
put(0xab, 'CALLI', 'ccind', 'indirect');
put(0xbb, 'CALLR', 'rel', 'call');
put(0xcb, 'RET', 'none', 'ret');
put(0xdb, 'RETS', 'none', 'ret');
put(0xeb, 'RETP', 'reg', 'ret');
put(0xfb, 'RETI', 'none', 'ret');

// --- shifts, and the stack/page column (`xC`) -----------------------------------------------
put(0x0c, 'ROL', 'nm');
put(0x1c, 'ROL', 'n4');
put(0x2c, 'ROR', 'nm');
put(0x3c, 'ROR', 'n4');
put(0x4c, 'SHL', 'nm');
put(0x5c, 'SHL', 'n4');
put(0x6c, 'SHR', 'nm');
put(0x7c, 'SHR', 'n4');
put(0x9c, 'JMPI', 'ccind', 'indirect');
put(0xac, 'ASHR', 'nm');
put(0xbc, 'ASHR', 'n4');
put(0xcc, 'NOP', 'none');
put(0xdc, 'EXT', 'extreg');
put(0xec, 'PUSH', 'reg');
put(0xfc, 'POP', 'reg');

// --- data movement ---------------------------------------------------------------------------
// The `nm` opcodes below all carry two GPR nibbles and disagree about what they mean by them,
// so each states its own spelling. Getting one of these backwards would silently reverse the
// direction of a memory access, which is the difference between "reads the table" and
// "writes the table" in every cross-reference downstream.
put(0xf0, 'MOV', 'nm', 'seq', undefined, '%n, %m');
put(0xf1, 'MOVB', 'nm', 'seq', true, '%n, %m');
put(0xe0, 'MOV', 'n4', 'seq', undefined, '%n, #%d');
put(0xe1, 'MOVB', 'n4', 'seq', true, '%n, #%d');
put(0xe6, 'MOV', 'reg16');
put(0xe7, 'MOVB', 'reg8', 'seq', true);
put(0xf2, 'MOV', 'regmem');
put(0xf3, 'MOVB', 'regmem', 'seq', true);
put(0xf6, 'MOV', 'memreg');
put(0xf7, 'MOVB', 'memreg', 'seq', true);
put(0xa8, 'MOV', 'nm', 'seq', undefined, '%n, [%m]');
put(0xa9, 'MOVB', 'nm', 'seq', true, '%n, [%m]');
put(0x98, 'MOV', 'nm', 'seq', undefined, '%n, [%m+]');
put(0x99, 'MOVB', 'nm', 'seq', true, '%n, [%m+]');
put(0xb8, 'MOV', 'nm', 'seq', undefined, '[%m], %n');
put(0xb9, 'MOVB', 'nm', 'seq', true, '[%m], %n');
put(0x88, 'MOV', 'nm', 'seq', undefined, '[-%m], %n');
put(0x89, 'MOVB', 'nm', 'seq', true, '[-%m], %n');
put(0xc8, 'MOV', 'nm', 'seq', undefined, '[%n], [%m]');
put(0xc9, 'MOVB', 'nm', 'seq', true, '[%n], [%m]');
put(0xd8, 'MOV', 'nm', 'seq', undefined, '[%n+], [%m]');
put(0xd9, 'MOVB', 'nm', 'seq', true, '[%n+], [%m]');
put(0xe8, 'MOV', 'nm', 'seq', undefined, '[%n], [%m+]');
put(0xe9, 'MOVB', 'nm', 'seq', true, '[%n], [%m+]');
put(0xd4, 'MOV', 'nm16', 'seq', undefined, '%n, [%m+#%d]');
put(0xc4, 'MOV', 'nm16', 'seq', undefined, '[%m+#%d], %n');
put(0xf4, 'MOVB', 'nm16', 'seq', true, '%n, [%m+#%d]');
put(0xe4, 'MOVB', 'nm16', 'seq', true, '[%m+#%d], %n');
put(0x84, 'MOV', 'imem', 'seq', undefined, '[%n], %M');
put(0x94, 'MOV', 'imem', 'seq', undefined, '%M, [%n]');
put(0xa4, 'MOVB', 'imem', 'seq', true, '[%n], %M');
put(0xb4, 'MOVB', 'imem', 'seq', true, '%M, [%n]');
put(0xc0, 'MOVBZ', 'nm', 'seq', undefined, '%n, %m');
put(0xc2, 'MOVBZ', 'regmem');
put(0xc5, 'MOVBZ', 'memreg');
put(0xd0, 'MOVBS', 'nm', 'seq', undefined, '%n, %m');
put(0xd2, 'MOVBS', 'regmem');
put(0xd5, 'MOVBS', 'memreg');

/**
 * The four loop-control compares. Each increments or decrements its GPR by one or two and then
 * compares, which is how a C `for` over a table becomes two instructions — so these are dense in
 * exactly the code that walks calibration arrays.
 *
 * They were found by census rather than recalled: a linear sweep of the program region left 529
 * undefined bytes, and the six most common were 0x80, 0xB2, 0xB6, 0x86, 0x92, 0xA2 — an even-only
 * pattern across four rows whose odd slots were already NEG/CPL. That shape only fits a
 * three-form group repeated four times.
 */
const STEPS: readonly [number, string][] = [[0x80, 'CMPI1'], [0x90, 'CMPI2'], [0xa0, 'CMPD1'], [0xb0, 'CMPD2']];
for (const [base, name] of STEPS) {
    put(base + 0x0, name, 'n4', 'seq', undefined, '%n, #%d');
    put(base + 0x2, name, 'regmem');
    put(base + 0x6, name, 'reg16');
}

// --- the rest --------------------------------------------------------------------------------
put(0x81, 'NEG', 'n0');
put(0xa1, 'NEGB', 'n0', 'seq', true);
put(0x91, 'CPL', 'n0');
put(0xb1, 'CPLB', 'n0', 'seq', true);
put(0xe2, 'PCALL', 'reg16', 'call');
put(0xc6, 'SCXT', 'reg16');
put(0xd6, 'SCXT', 'regmem');
put(0xd1, 'ATOMIC', 'extr');
put(0xd7, 'EXT', 'extimm');
put(0x87, 'IDLE', 'sys');
put(0x97, 'PWRDN', 'sys');
put(0xa7, 'SRVWDT', 'sys');
put(0xb7, 'SRST', 'sys');
put(0xa5, 'DISWDT', 'sys');
put(0xb5, 'EINIT', 'sys');

export const ISA: readonly (OpDef | undefined)[] = T;

/** The sixteen condition codes, in encoding order. */
export const CC = [
    'cc_UC', 'cc_NET', 'cc_Z', 'cc_NZ', 'cc_V', 'cc_NV', 'cc_N', 'cc_NN',
    'cc_ULT', 'cc_UGE', 'cc_SGT', 'cc_SLE', 'cc_SLT', 'cc_SGE', 'cc_UGT', 'cc_ULE',
] as const;

/**
 * The special-function registers this project has already had to name by hand, plus the ones a
 * reader of THIS image will meet.
 *
 * Deliberately not the whole C166 SFR map. Every entry here was reached from evidence in
 * `docs/full-image-analysis.md` §2, and an SFR named from a datasheet the ECU may not match
 * would be exactly the kind of confident wrongness the decoder refuses elsewhere.
 */
export const SFR: Readonly<Record<number, string>> = {
    0xfe00: 'DPP0', 0xfe02: 'DPP1', 0xfe04: 'DPP2', 0xfe06: 'DPP3',
    0xfe08: 'CSP', 0xfe0c: 'MDH', 0xfe0e: 'MDL', 0xfe10: 'CP', 0xfe12: 'SP',
    0xfe14: 'STKOV', 0xfe16: 'STKUN', 0xfe18: 'ADDRSEL1', 0xfe1a: 'ADDRSEL2',
    0xff10: 'MDC', 0xff12: 'SYSCON', 0xff0c: 'PSW', 0xff1c: 'BUSCON1',
    0xfeb0: 'S0TBUF', 0xfeb2: 'S0RBUF', 0xfeb4: 'S0BG', 0xffb0: 'S0CON',
    0xff6e: 'S0TIC', 0xff6c: 'S0RIC', 0xff70: 'S0EIC',
    0xffb2: 'SSCCON', 0xfeb6: 'SSCBR',
    0xff60: 'T2IC', 0xff62: 'T3IC', 0xff64: 'T4IC', 0xff66: 'T5IC', 0xff68: 'T6IC',
    0xfe40: 'T0', 0xfe42: 'T1', 0xfe44: 'T2', 0xfe46: 'T3', 0xfe48: 'T4',
    0xffac: 'WDTCON', 0xfeae: 'WDT',
};
