/**
 * The mobile path, driven end to end against a simulated FTDI chip.
 *
 * A fake `UsbDeviceLike` behaving like an FT232R with a DS2 slave behind it, with the REAL
 * `WebUsbFtdiTransport`, `Ds2Link` and `Smg2ReadLink` on top. If a phone reads a different 24 KiB
 * than a laptop does, it is because of something in this file's subject matter, and a mock of the
 * transport would prove nothing about any of it.
 *
 * The packet size is deliberately tiny (8 bytes) so a single DS2 response spans several bulk
 * packets. That is what exercises the interior status headers — the failure that produces a
 * plausible dump with two bytes of garbage every packet.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';

import {
    Ds2Address,
    Ds2Control,
    Ds2Link,
    buildDs2Frame,
    parseDs2Frame,
    type Ds2Frame,
} from '@tsunagi/ds2-core';
import { Smg2ReadLink } from '@tsunagi/ds2-smg2';

import { WebUsbFtdiTransport } from './webUsbFtdiTransport';
import type { UsbConfiguration, UsbDeviceLike, UsbInTransferResult, UsbOutTransferResult } from './webusb';

const PACKET_SIZE = 8;

interface ControlCall { request: number; value: number; index: number }

class FakeFtdi implements UsbDeviceLike {
    readonly vendorId = 0x0403;
    readonly productId = 0x6001;
    deviceVersionMajor = 6; // FT232R
    opened = false;
    configuration: UsbConfiguration | null = null;

    readonly control: ControlCall[] = [];
    readonly requests: Uint8Array[] = [];
    claimed: number | null = null;

    /** Bytes waiting to go up to the host, in FTDI order (echo first, then response). */
    private rx: number[] = [];
    private lineStatus = 0;

    constructor(private readonly respond: (request: Ds2Frame) => Uint8Array | null) {}

    async open(): Promise<void> { this.opened = true; }
    async close(): Promise<void> { this.opened = false; }
    async selectConfiguration(): Promise<void> {
        this.configuration = {
            interfaces: [{
                interfaceNumber: 0,
                alternate: {
                    endpoints: [
                        { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: PACKET_SIZE },
                        { endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: PACKET_SIZE },
                    ],
                },
            }],
        };
    }
    async claimInterface(n: number): Promise<void> { this.claimed = n; }
    async releaseInterface(): Promise<void> {}
    async clearHalt(): Promise<void> {}

    async controlTransferOut(setup: { request: number; value: number; index: number }): Promise<UsbOutTransferResult> {
        this.control.push({ request: setup.request, value: setup.value, index: setup.index });
        if (setup.request === 0x00 && setup.value === 2) this.rx = []; // SIO_RESET purge RX
        return { bytesWritten: 0, status: 'ok' };
    }

    async transferOut(_ep: number, data: ArrayBufferView | ArrayBufferLike): Promise<UsbOutTransferResult> {
        const view = data as ArrayBufferView;
        const bytes = ArrayBuffer.isView(data)
            ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
            : new Uint8Array(data as ArrayBuffer);
        this.requests.push(Uint8Array.from(bytes));
        this.rx.push(...bytes); // the K-line echoes everything transmitted
        const frame = parseDs2Frame(bytes);
        if (frame) {
            const payload = this.respond(frame);
            if (payload) this.rx.push(...buildDs2Frame(frame.address, 0xa0, payload));
        }
        return { bytesWritten: bytes.length, status: 'ok' };
    }

    /**
     * One transfer, made of whole packets, each carrying two status bytes.
     *
     * A real chip emits a status-only packet on every latency-timer expiry even with no traffic,
     * which is what lets the pump exit without a cancel. The idle case is modelled the same way.
     */
    async transferIn(_ep: number, length: number): Promise<UsbInTransferResult> {
        const maxPackets = Math.floor(length / PACKET_SIZE);
        const out: number[] = [];
        let packets = 0;
        while (packets < maxPackets && this.rx.length > 0) {
            out.push(0x01, this.lineStatus, ...this.rx.splice(0, PACKET_SIZE - 2));
            packets++;
        }
        if (packets === 0) {
            await new Promise(r => setTimeout(r, 1));
            out.push(0x01, this.lineStatus); // status-only keepalive
        }
        const buffer = Uint8Array.from(out);
        return { data: new DataView(buffer.buffer), status: 'ok' };
    }

    raiseLineStatus(bits: number): void { this.lineStatus = bits; }
}

/** A 512 KiB image whose bytes depend on position, so a chunking error cannot look like data. */
function makeImage(): Uint8Array {
    const image = new Uint8Array(0x80000);
    for (let i = 0; i < image.length; i++) image[i] = (i * 31 + (i >> 8)) & 0xff;
    return image;
}

function memoryResponder(image: Uint8Array) {
    return (request: Ds2Frame): Uint8Array | null => {
        if (request.controlOrStatus !== Ds2Control.READ_MEMORY) return new Uint8Array(0);
        const [, a2, a1, a0, count] = request.payload;
        const address = (a2 << 16) | (a1 << 8) | a0;
        return Uint8Array.from(image.subarray(address, address + count));
    };
}

/** `WebUsbFtdiTransport.open()` reaches for `navigator.usb`, so the fake is installed there. */
function installUsb(device: FakeFtdi) {
    vi.stubGlobal('navigator', {
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140',
        usb: {
            getDevices: async () => [device],
            requestDevice: async () => device,
        },
    });
}

afterEach(() => vi.unstubAllGlobals());

async function connect(device: FakeFtdi) {
    installUsb(device);
    const transport = new WebUsbFtdiTransport();
    const link = new Ds2Link(transport, {
        address: Ds2Address.SMG,
        timings: { responseTimeoutMs: 500 },
    });
    await link.connect();
    return { transport, link };
}

describe('chip setup', () => {
    it('configures 8E1, the audited 9600 divisor, and de-asserts DTR/RTS after the reset', async () => {
        const device = new FakeFtdi(memoryResponder(makeImage()));
        await connect(device);

        const byRequest = (r: number) => device.control.filter(c => c.request === r);
        // SIO_RESET(0) sub-command 0 = full reset, then purge RX (2 — the post-libftdi-1.5 polarity).
        expect(byRequest(0x00).map(c => c.value)).toEqual([0, 2]);
        expect(byRequest(0x03)).toEqual([{ request: 0x03, value: 0x4138, index: 0 }]);
        // 8 data bits, even parity, 1 stop. 8N1 would be 0x0008 and would make every DS2 frame a
        // framing error.
        expect(byRequest(0x04).map(c => c.value)).toEqual([0x0208]);
        expect(byRequest(0x09).map(c => c.value)).toEqual([16]);

        // Order matters: the reset clears modem-control state, so DTR/RTS must come after it.
        const resetIndex = device.control.findIndex(c => c.request === 0x00 && c.value === 0);
        const modemIndex = device.control.findIndex(c => c.request === 0x01);
        expect(modemIndex).toBeGreaterThan(resetIndex);
        expect(device.claimed).toBe(0);
    });

    it('refuses an H-series chip rather than mis-clocking it', async () => {
        const device = new FakeFtdi(memoryResponder(makeImage()));
        device.deviceVersionMajor = 7; // FT232H
        installUsb(device);
        await expect(new WebUsbFtdiTransport().open()).rejects.toThrow(/Unsupported FTDI chip/);
    });

    it('says plainly that iOS cannot do this', async () => {
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone) Safari' });
        await expect(new WebUsbFtdiTransport().open()).rejects.toThrow(/iOS supports neither/);
    });

    it('changes baud on the open handle, unlike Web Serial', async () => {
        const device = new FakeFtdi(memoryResponder(makeImage()));
        const { transport } = await connect(device);
        expect(transport.reopenIsInPlace()).toBe(true);
        await transport.reopen(125000);
        expect(device.control.filter(c => c.request === 0x03).map(c => c.value))
            .toEqual([0x4138, 0x0018]);
    });
});

describe('status-byte stripping', () => {
    it('reads a DS2 exchange whose response spans many bulk packets', async () => {
        const image = makeImage();
        const device = new FakeFtdi(memoryResponder(image));
        const { link } = await connect(device);
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });

        // 64 payload bytes at a packet size of 8 means 6 usable bytes per packet: the response is
        // spread over ~12 packets and every one carries an interior status header.
        const block = await smg2.readBlock(0x00, 0x32000, 64);
        expect(Array.from(block)).toEqual(Array.from(image.subarray(0x32000, 0x32000 + 64)));
    });

    it('reads the whole calibration window byte-exactly over WebUSB', async () => {
        const image = makeImage();
        const device = new FakeFtdi(memoryResponder(image));
        const { link } = await connect(device);
        const smg2 = new Smg2ReadLink(link, { chunkSize: 120 });

        const result = await smg2.readCalibrationWindow(0x00, 0x32000);

        expect(result.bytes).toHaveLength(0x6000);
        expect(Array.from(result.bytes)).toEqual(Array.from(image.subarray(0x32000, 0x38000)));
        expect(result.exchanges).toBe(205);
        const controls = device.requests.map(r => parseDs2Frame(r)?.controlOrStatus);
        expect(new Set(controls)).toEqual(new Set([Ds2Control.READ_MEMORY]));
    }, 30_000);
});

describe('line faults', () => {
    it('surfaces a parity error under the name Web Serial uses', async () => {
        const image = makeImage();
        const device = new FakeFtdi(memoryResponder(image));
        const { link, transport } = await connect(device);
        const smg2 = new Smg2ReadLink(link, { chunkSize: 32 });

        // One clean read first: the very first status header after a reset reports the pre-existing
        // line state and is skipped by design, so a fault raised before it would be swallowed.
        await smg2.readBlock(0x00, 0x32000, 32);

        device.raiseLineStatus(0x04); // LSR parity
        await expect(smg2.readBlock(0x00, 0x32000, 32)).rejects.toThrow();
        expect(transport.hasReadError()).toBe(true);
        expect(transport.peekReadError()?.name).toBe('ParityError');
    }, 20_000);
});
