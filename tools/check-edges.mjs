import { readFileSync } from 'node:fs';
import { sweep } from '@tsunagi/c166';
const image = new Uint8Array(readFileSync(process.argv[2]));
const r = sweep(image);
const hex = (n) => '0x' + n.toString(16).toUpperCase();
for (const pair of [[0x00ad30, 0x01c2a], [0x01c2a, 0x02212], [0x02212, 0x00ffe], [0x00ffe, 0x014b4], [0x014b4, 0x00af8], [0x00af8, 0x0097e]]) {
    const fn = r.funcs.get(pair[0]);
    const direct = fn ? [...fn.calls, ...fn.tails].includes(pair[1]) : false;
    console.log(`${hex(pair[0])} -> ${hex(pair[1])}: ${fn ? (direct ? 'DIRECT CALL EDGE' : 'no direct edge') : 'caller not in sweep'}`);
}
console.log('\ncallers of 0x1C2A:', (r.funcs.get(0x01c2a)?.callers ?? []).length === 0 ? '(field not on FuncInfo)' : '');
const callers = r.edges.filter(e => e.to === 0x01c2a).map(e => hex(e.from));
console.log('  edges into 0x1C2A:', callers.length ? callers.join(' ') : '(none — nothing in the sweep calls it)');
console.log('  edges into 0x2212:', r.edges.filter(e => e.to === 0x02212).map(e => hex(e.from)).join(' ') || '(none)');
console.log('  edges out of 0x0AD30:', (r.funcs.get(0x00ad30)?.calls ?? []).map(hex).join(' ') || '(none)');
