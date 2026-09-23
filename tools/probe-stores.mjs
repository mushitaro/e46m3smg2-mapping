import { readFileSync } from 'node:fs';
import { sweep } from '@tsunagi/c166';
const image = new Uint8Array(readFileSync(process.argv[2]));
const r = sweep(image);
for (const fn of r.funcs.values()) {
    for (const insn of fn.insns) {
        const d = insn.data;
        if (!d?.write || d.at === undefined || d.at < 0x320e0 || d.at >= 0x378c0) continue;
        const ctx = fn.insns.filter(x => x.at >= insn.at - 6 && x.at <= insn.at + 6)
            .map(x => `      ${x.at.toString(16).padStart(5, '0')}  ${x.text}`).join('\n');
        console.log(`fn 0x${fn.at.toString(16).toUpperCase()} -> writes 0x${d.at.toString(16).toUpperCase()}  (${d.kind}, via ${d.via})\n${ctx}\n`);
    }
}
