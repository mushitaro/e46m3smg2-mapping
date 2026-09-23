import { describe, expect, it } from 'vitest';
import { Ds2Link } from './link';
import { WebSerialTransport } from './transport';
import { simulatedPort } from './simulator';
import { Ds2Address, Ds2Control } from './frame';

/**
 * A telemetry loop against a synchronous device must not starve the event loop.
 *
 * When the device answers in-process, every await inside an exchange resolves as
 * a MICROTASK, and microtasks do not yield to the macrotask queue. A `while`
 * loop built only from those never lets a timer, a render or an input event run
 * — in a browser the tab simply stops responding, and no error is logged
 * because nothing crashed.
 *
 * Real hardware hides it: a ~197 ms round trip is a genuine wait. So does an
 * accidental one — a 30 ms settle inside the retry wrapper was keeping this
 * alive until it was (correctly) removed.
 *
 * The probe below is a plain setTimeout. If the loop yields, it fires.
 */
async function connectedLink() {
    const { requestPort } = simulatedPort({ address: Ds2Address.DME });
    const transport = new WebSerialTransport({ requestPort });
    const link = new Ds2Link(transport, { address: Ds2Address.DME });
    await link.connect();
    return link;
}

describe('a poll loop against a synchronous device', () => {
    it('starves timers when it only awaits microtasks', async () => {
        const link = await connectedLink();
        let timerFired = false;
        setTimeout(() => {
            timerFired = true;
        }, 0);

        // Deliberately no yield — this is the shape that hung the tab.
        for (let i = 0; i < 200; i++) {
            await link.exchange(Ds2Control.READ_IO_STATUS, new Uint8Array([3]));
        }
        expect(timerFired).toBe(false);
    });

    it('lets timers run when it yields once per iteration', async () => {
        const link = await connectedLink();
        let ticks = 0;
        const id = setInterval(() => {
            ticks++;
        }, 1);

        try {
            for (let i = 0; i < 50; i++) {
                await link.exchange(Ds2Control.READ_IO_STATUS, new Uint8Array([3]));
                await yieldToEventLoop();
            }
        } finally {
            clearInterval(id);
        }
        expect(ticks).toBeGreaterThan(0);
    });
});

function yieldToEventLoop(): Promise<void> {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (typeof s?.yield === 'function') return s.yield();
    return new Promise((r) => setTimeout(r, 0));
}
