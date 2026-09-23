/**
 * The decoder is checked against facts this project established BEFORE it existed.
 *
 * Every encoding below is quoted in `docs/full-image-analysis.md`, where it was worked out by
 * hand from the real dump. That ordering matters: these are not expectations recorded from the
 * decoder's own output, which would only prove it is consistent with itself. They are five
 * independent points, in four different instruction formats, that a wrong opcode table cannot
 * pass — and they are the reason the rest of the numbers in this file can be believed.
 */

import { describe as suite, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { decode, RESET_DPP } from './decode';
import { sweep, isExecutable, pointerSeeds, vectorSeeds } from './sweep';

const IMAGE = 'data/extractions/5c5a0c857acd.bin';
/**
 * The real dump is not in this repository — it is one car's ECU, and `data/` is gitignored — so
 * on a fresh clone these tests skip rather than fail.
 */
const describe = existsSync(IMAGE) ? suite : suite.skip;
const img = existsSync(IMAGE) ? new Uint8Array(readFileSync(IMAGE)) : new Uint8Array(0);
const bytes = (...b: number[]) => decode(Uint8Array.from(b), 0, RESET_DPP);
const CAL_LO = 0x320e0;
const CAL_HI = 0x378c0;

describe('the encodings the analysis established by hand', () => {
    it('decodes the reset vector at image offset 0', () => {
        // §2.2: `0x00000` = `FA 00 4E 04` = JMPS 00:044E.
        const i = decode(img, 0, RESET_DPP);
        expect(i.text).toBe('JMPS  00:044Eh');
        expect(i.target).toBe(0x0044e);
    });

    it('decodes the DPP save/set idiom', () => {
        // §2.5: `EC 00` at 18 sites, `MOV DPP0,#000Ch` at 24, 13 of them directly after a push.
        expect(bytes(0xec, 0x00).text).toBe('PUSH  DPP0');
        const set = bytes(0xe6, 0x00, 0x0c, 0x00);
        expect(set.text).toBe('MOV   DPP0, #000Ch');
        expect(set.setsDpp).toEqual({ n: 0, page: 0x0c });
    });

    it('decodes the explicit page override', () => {
        // §2.5: `D7 40 0C 00` = EXTP #000Ch,#1.
        const i = bytes(0xd7, 0x40, 0x0c, 0x00);
        expect(i.text).toBe('EXTP  #000Ch, #1');
        expect(i.ext).toEqual({ kind: 'p', value: 0x0c, count: 1 });
    });

    it('decodes the ASC0 receive handler reading S0RBUF', () => {
        // §2.2: `MOVB R8, FEB2h` at 0x00AD3A is what identifies 0x00AD30 as the receive interrupt.
        expect(decode(img, 0x00ad3a, RESET_DPP).text).toBe('MOVB  RL4, S0RBUF');
    });

    it('decodes the DS2 baud-rate constant', () => {
        // §2.3: S0BG = #0033h at 0x001BBA is one of the two legs of the fCPU = 16 MHz argument.
        expect(decode(img, 0x001bba, RESET_DPP).text).toBe('MOV   S0BG, #0033h');
    });
});

describe('what the sweep finds in the real image', () => {
    const result = sweep(img);

    it('confirms the 46-entry pointer table the analysis predicted', () => {
        // §8 item 10: "0x2DC28 の 46 個の u32 は 0x5051A-0x7BE16 を指す — ジャンプテーブルとして
        // 逆アセンブルで確認できる". Found generically, by looking for runs of code pointers.
        const runs = new Map<string, number>();
        for (const s of pointerSeeds(img)) {
            const table = s.why.split(' [')[0];
            runs.set(table, (runs.get(table) ?? 0) + 1);
        }
        expect(runs.get('pointer table 0x2DC28')).toBe(46);
    });

    it('keeps only the 19 live interrupt handlers', () => {
        // §2.2 measured 19 live and 109 self-jumps. Seeding the self-jumps would bury the real ones.
        expect(vectorSeeds(img)).toHaveLength(19);
    });

    it('decodes what it reaches, and says so when it cannot', () => {
        let insns = 0;
        let undef = 0;
        for (const f of result.funcs.values()) { insns += f.insns.length; undef += f.undef; }
        expect(result.funcs.size).toBeGreaterThan(890);
        expect(insns).toBeGreaterThan(54000);
        // A wrong opcode table cannot stay under one byte in five hundred across 50,000
        // instructions that were each reached by following a branch to them.
        expect(undef / insns).toBeLessThan(0.002);
    });

    it('never decodes an instruction outside a measured code range', () => {
        // The guard that caught the calibration window, and later the `$Revision` string.
        for (const f of result.funcs.values()) {
            for (const i of f.insns) expect(isExecutable(i.at)).toBe(true);
        }
    });

    it('reaches the ASC0 receive handler the analysis identified by name', () => {
        // §2.2 named 0x00AD30 as the DS2 receive interrupt from the S0RBUF read at 0x00AD3A. It
        // sits in 0x08240-0x0FFFF, a region §5.2's table omitted — so the sweep could not reach it
        // until that range was added, and the entire serial path (and with it the flash driver
        // trace in docs/smg2-flash-driver.md) was invisible. This is the assertion that the region
        // stays in EXEC_RANGES.
        expect(result.funcs.has(0x00ad30)).toBe(true);
        const receiver = result.funcs.get(0x00ad30)!;
        expect(receiver.reads.some(d => d.at === 0xfeb2 /* S0RBUF */)
            || receiver.insns.some(i => i.text.includes('S0RBUF'))).toBe(true);
    });

    it('never claims the program stores into flash', () => {
        // Flash is not byte-writable. A resolved store into the calibration body is therefore a
        // wrong address, not a discovery — this is the assertion that found the `$Revision`
        // string being decoded as code, and it stays here to catch the next one.
        const stores = [...result.funcs.values()]
            .flatMap(f => f.writes.filter(d => d.at! >= CAL_LO && d.at! < CAL_HI));
        expect(stores).toHaveLength(0);
    });
});

describe('the DPP1 = 0x0D inference, tested rather than assumed', () => {
    const result = sweep(img);
    const reads = [...result.funcs.values()]
        .flatMap(f => f.reads.map(d => d.at!))
        .filter(a => a >= CAL_LO && a < CAL_HI);

    /** Share of the calibration body that is programmed at all — the null hypothesis. */
    const baseRate = (() => {
        let n = 0;
        for (let a = CAL_LO; a < CAL_HI; a++) if (img[a] !== 0xff) n++;
        return n / (CAL_HI - CAL_LO);
    })();

    it('lands on programmed bytes far more often than chance allows', () => {
        // §2.5 licenses DPP1 = 0x0D as a strong inference (init write agrees with the live
        // register file) but not as a proof, and every calibration cross-reference rests on it.
        // So it gets tested the only way a page assumption can be: if the page is right the
        // reads should land on data, and if it is wrong they should land on erased flash.
        //
        // Measured: 54.2% of the body is programmed, and 94.2% of reads land on programmed bytes.
        const hit = reads.filter(a => img[a] !== 0xff).length / reads.length;
        expect(baseRate).toBeLessThan(0.6);
        expect(hit).toBeGreaterThan(0.9);
    });

    it('loses the signal when the page is moved by one', () => {
        // The control. An enrichment that survives shifting the page would be an artefact of
        // where data happens to be, not evidence about DPP1. Measured well under 70% both ways.
        for (const delta of [-0x4000, 0x4000]) {
            const moved = reads.map(a => a + delta).filter(a => a >= 0 && a < img.length);
            const hit = moved.filter(a => img[a] !== 0xff).length / moved.length;
            expect(hit).toBeLessThan(0.7);
        }
    });
});
