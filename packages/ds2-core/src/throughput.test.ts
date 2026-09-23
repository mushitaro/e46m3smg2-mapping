import { describe, expect, it } from 'vitest';
import { Ds2Link } from './link';
import { WebSerialTransport } from './transport';
import { simulatedPort } from './simulator';
import { Ds2Address, Ds2Control } from './frame';

/**
 * Guards the loop against accidental per-exchange latency.
 *
 * Against a simulator that answers synchronously, the only time an exchange can
 * cost is time WE added. This caught a real one: the retry wrapper paid its
 * resync settle before every attempt including the first, so a clean exchange
 * carried a deliberate delay meant for recovering a disturbed line.
 *
 * It is not a benchmark and says nothing about the wire — on a car the round
 * trip is ~197 ms of which ~141 is wire and ~53 is the ECU thinking, and no
 * host-side change touches either.
 */
describe('exchange overhead against a synchronous device', () => {
    it('does not add a fixed delay to a clean exchange', async () => {
        const { requestPort } = simulatedPort({ address: Ds2Address.DME });
        const transport = new WebSerialTransport({ requestPort });
        const link = new Ds2Link(transport, { address: Ds2Address.DME });
        await link.connect();

        const N = 20;
        const started = Date.now();
        for (let i = 0; i < N; i++) {
            await link.exchangeWithRetry(Ds2Control.READ_IO_STATUS, new Uint8Array([3]));
        }
        const perExchange = (Date.now() - started) / N;

        // The resync settle is 30 ms and exists for the attempt AFTER a failure.
        // Paying it on a clean first attempt would put a floor here.
        expect(perExchange).toBeLessThan(20);
    });

    it('a plain exchange is faster still', async () => {
        const { requestPort } = simulatedPort({ address: Ds2Address.DME });
        const transport = new WebSerialTransport({ requestPort });
        const link = new Ds2Link(transport, { address: Ds2Address.DME });
        await link.connect();

        const N = 20;
        const started = Date.now();
        for (let i = 0; i < N; i++) {
            await link.exchange(Ds2Control.KEEP_ALIVE);
        }
        expect((Date.now() - started) / N).toBeLessThan(5);
    });
});
