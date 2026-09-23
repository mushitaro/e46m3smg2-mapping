/**
 * An FTDI cable driven over WebUSB, as a byte transport.
 *
 * **Why it exists.** Chrome for Android exposes `navigator.serial`, but that implementation
 * enumerates only Bluetooth RFCOMM ports — a USB K+DCAN cable never appears in its picker. WebUSB
 * plus the FTDI vendor protocol is the only route to the cable on a phone.
 *
 * **Why it is a `BufferedByteTransport` and not an adapter.** An earlier version of this app wrapped
 * the chip as a `SerialPortLike` and fed it to a stream-based transport. It worked, and it meant the
 * phone and the laptop had different buffering, different fault propagation and different recovery
 * for the same protocol. The Tuner's answer — one contract, two backends, the shared half in the
 * base class — is the one that has vehicle hours on it.
 *
 * **The trap that does not announce itself.** Every bulk IN *packet* — not every transfer — carries
 * two status bytes, so with a multi-packet transfer the headers are *interior*. Stripping only at
 * offset 0 yields a dump with two bytes of garbage every packet: it opens, it decodes, and it is
 * wrong. `pump()` strips per packet.
 *
 * Constants and their reasoning are carried over from the Tuner's `webUsbFtdiTransport.ts`, which
 * was written against a real FT232R and a real car.
 */

import type { Ds2ByteTransport } from '@tsunagi/ds2-core';

import { BufferedByteTransport, TransportError } from './bufferedByteTransport';
import { getUsb, type UsbDeviceLike } from './webusb';

export const FTDI_VENDOR_ID = 0x0403;

const SIO_RESET = 0x00;
const SIO_SET_MODEM_CTRL = 0x01;
const SIO_SET_FLOW_CTRL = 0x02;
const SIO_SET_BAUD_RATE = 0x03;
const SIO_SET_DATA = 0x04;
const SIO_SET_LATENCY_TIMER = 0x09;

const SIO_RESET_SIO = 0;
/**
 * Purge RX.
 *
 * The polarity is a known trap: libftdi <= 1.4 exposed `PURGE_RX = 1`, and 1.5 swapped the two after
 * matching them against the real chip. 2 is the value that actually empties the receive FIFO.
 */
const SIO_RESET_PURGE_RX = 2;

const FTDI_PORT_INDEX = 1;

/**
 * 8 data bits, even parity, 1 stop bit.
 *
 * Bits 0-7 data bits, 8-10 parity (0=N 1=O 2=E), 11-13 stop (0 = one), 14 TX break.
 *
 * **8E1 is mandatory — do not "simplify" it to 8N1 while chasing line errors.** DS2 is even-parity;
 * an 8N1 receiver samples the parity bit where the stop bit belongs, so every frame reads as a
 * framing error. The predecessor PWA opened 8N1 and that is recorded upstream as a bug.
 */
const FTDI_DATA_8E1 = 0x0208;

/** DTR low + RTS low, both with their write-enable bits set. Matches what native tools do. */
const FTDI_MODEM_DTR_LOW_RTS_LOW = 0x0300;

/**
 * Latency timer, in milliseconds.
 *
 * The chip sends a status packet every time this expires whether or not there is traffic, so it is
 * both the worst-case added delay on a short response and the rate at which the pump wakes with
 * nothing to do. 16 is the FTDI default and is well under the DS2 response timeout.
 */
const FTDI_LATENCY_MS = 16;

const LSR_OVERRUN = 0x02;
const LSR_PARITY = 0x04;
const LSR_FRAMING = 0x08;
const LSR_BREAK = 0x10;
const LSR_ANY_ERROR = LSR_OVERRUN | LSR_PARITY | LSR_FRAMING | LSR_BREAK;

/**
 * Chip families whose divisors follow the 3 MHz / fractional encoding below (AM=2, BM=4, R=6).
 *
 * H-series and FT-X parts run a 12 MHz base and pack the index differently, so they are REFUSED
 * rather than silently mis-clocked. A wrong divisor on a cable that talks to an ECU is not subtle.
 */
const SUPPORTED_CHIP_VERSIONS = new Set([2, 4, 6]);

/**
 * Baud divisors, precomputed and audited.
 *
 *     d8       = 24_000_000 / baud          (eighths; 24 MHz = 3 MHz x 8)
 *     fracCode = [0,3,2,4,1,5,6,7][d8 & 7]
 *     encoded  = (d8 >> 3) | (fracCode << 14)
 *
 * A three-entry table rather than a general converter: DS2 implements exactly these three rates, and
 * three audited constants cannot be subtly wrong where a converter can. 0x4138 and 0xC04E match
 * FTDI's published AN232B-05 table, which is the independent check on the derivation.
 */
const FTDI_DIVISORS: Readonly<Record<number, { value: number; index: number }>> = {
    9600: { value: 0x4138, index: 0 },   // d8=2500 -> int 312, frac 4/8 -> code 1
    38400: { value: 0xc04e, index: 0 },  // d8=625  -> int 78,  frac 1/8 -> code 3
    125000: { value: 0x0018, index: 0 }, // d8=192  -> int 24,  frac 0
};

/** Recompute at module load: a constant only checked when used gets checked on the wire. */
(function assertDivisorTable(): void {
    const FRAC_CODE = [0, 3, 2, 4, 1, 5, 6, 7];
    for (const [baudText, expected] of Object.entries(FTDI_DIVISORS)) {
        const baud = Number(baudText);
        const d8 = 24_000_000 / baud;
        if (!Number.isInteger(d8)) throw new Error(`FTDI divisor table: ${baud} is not an exact 1/8 divisor`);
        const encoded = (d8 >> 3) | (FRAC_CODE[d8 & 7] << 14);
        if ((encoded & 0xffff) !== expected.value || encoded >>> 16 !== expected.index) {
            throw new Error(`FTDI divisor table wrong for ${baud}`);
        }
    }
    if (FTDI_DATA_8E1 !== 0x0208) throw new Error('FTDI 8E1 constant is wrong');
    if (FTDI_MODEM_DTR_LOW_RTS_LOW !== 0x0300) throw new Error('FTDI modem-control constant is wrong');
})();

/** A line fault. The NAMES match what Web Serial produces, so handling above does not branch. */
export class FtdiLineError extends Error {
    constructor(name: string, message: string) {
        super(message);
        this.name = name;
    }
}

export class WebUsbFtdiTransport extends BufferedByteTransport implements Ds2ByteTransport {
    private device: UsbDeviceLike | null = null;
    private interfaceNumber = 0;
    private inEndpoint = 0;
    private outEndpoint = 0;
    private packetSize = 64;
    private pumpExited: Promise<void> | null = null;
    /**
     * The first status header after a reset reports the line state from before we touched it, so a
     * break left over from a previous session would be reported as a fault on a healthy link.
     */
    private skipLineStatusOnce = true;
    private baudRate: number;

    constructor(baudRate = 9600) {
        super();
        this.baudRate = baudRate;
    }

    static isSupported(): boolean {
        return getUsb() !== undefined;
    }

    /**
     * Open the cable.
     *
     * Must be reached synchronously from a user gesture: `requestDevice` needs the transient
     * activation from the tap, and an await before it loses the prompt. Already-granted devices are
     * preferred so a return visit does not prompt at all.
     */
    async open(): Promise<void> {
        const usb = getUsb();
        if (!usb) {
            throw new TransportError(
                'WebUSB is not available in this browser. On a phone this needs Chrome for Android; ' +
                'iOS supports neither WebUSB nor Web Serial.');
        }
        const granted = (await usb.getDevices()).filter(d => d.vendorId === FTDI_VENDOR_ID);
        // requestDevice's rejection is deliberately not wrapped: dismissing the chooser rejects with
        // a NotFoundError the caller should show as "cancelled", not as a driver failure.
        const device = granted[0] ?? await usb.requestDevice({ filters: [{ vendorId: FTDI_VENDOR_ID }] });
        this.device = device;

        if (!device.opened) await device.open();
        if (!device.configuration) await device.selectConfiguration(1);

        this.selectEndpoints();
        this.assertSupportedChipFamily();
        await device.claimInterface(this.interfaceNumber);

        // Order matters: SIO_RESET clears modem-control state, so DTR/RTS must follow it.
        await this.sio(SIO_RESET, SIO_RESET_SIO);
        await this.setBaudRate(this.baudRate);
        await this.sio(SIO_SET_LATENCY_TIMER, FTDI_LATENCY_MS);
        await this.sio(SIO_SET_FLOW_CTRL, 0, 0x0000 | FTDI_PORT_INDEX); // mode 0 = none, in the high byte
        await this.sio(SIO_SET_DATA, FTDI_DATA_8E1);
        await this.sio(SIO_SET_MODEM_CTRL, FTDI_MODEM_DTR_LOW_RTS_LOW);
        await this.flushReceive();

        this.clearBuffer();
        this.pumpError = null;
        this.skipLineStatusOnce = true;
        this.pumpActive = true;
        this.startPump();
    }

    async close(): Promise<void> {
        this.pumpActive = false;
        this.releaseWaiter();
        try { await this.pumpExited; } catch { /* the pump's error already latched */ }
        this.pumpExited = null;
        const device = this.device;
        this.device = null;
        if (!device) return;
        try { await device.releaseInterface(this.interfaceNumber); } catch { /* already gone */ }
        try { await device.close(); } catch { /* already gone */ }
    }

    /**
     * Change the baud rate on the OPEN handle.
     *
     * The one place the WebUSB path is genuinely better than Web Serial, which has no in-place baud
     * change and must close and reopen — moving the control lines across the transition. Nothing
     * here disturbs the line and the pump does not even stop.
     */
    async reopen(baudRate: number): Promise<void> {
        if (!this.device) throw new TransportError('USB device is not open');
        this.baudRate = baudRate;
        await this.setBaudRate(baudRate);
        await this.flushReceive();
        this.clearBuffer();
        this.pumpError = null;
        this.skipLineStatusOnce = true;
    }

    /** True: the divisor is assigned on the open handle, exactly as `FT_SetBaudRate` does. */
    reopenIsInPlace(): boolean {
        return true;
    }

    async write(bytes: Uint8Array): Promise<void> {
        const device = this.device;
        if (!device) throw new TransportError('USB device is not open');
        this.timing?.writeStart(performance.now());
        const result = await device.transferOut(this.outEndpoint, bytes);
        this.timing?.writeEnd(performance.now());
        if (result.status !== 'ok') {
            throw new TransportError(`USB write failed (${result.status})`);
        }
    }

    /**
     * Empties the JS buffer and, unlike a Web Serial backend, the chip's own FIFO too.
     *
     * Stays synchronous by contract, so the driver flush is fire-and-forget. Safe because purge runs
     * *between* exchanges under the link's command gate: there is no in-flight frame for a
     * late-landing flush to eat.
     */
    purge(): void {
        super.purge();
        void this.flushReceive().catch(() => { });
    }

    /**
     * Clears a latched fault without closing the device.
     *
     * Simpler and stronger than the Web Serial equivalent: there is no reader to re-acquire, and the
     * flush reaches the chip's FIFO rather than only the bytes already handed to us. `settleMs` is
     * sized to the break/idle condition on the wire, not to anything about the host API.
     */
    async recoverRead(settleMs = 100): Promise<void> {
        if (!this.device) throw new TransportError('USB device is not open');
        this.pumpActive = false;
        this.releaseWaiter();
        try { await this.pumpExited; } catch { /* expected */ }
        await new Promise(r => setTimeout(r, settleMs));
        await this.flushReceive();
        this.clearBuffer();
        this.pumpError = null;
        this.skipLineStatusOnce = true;
        this.pumpActive = true;
        this.startPump();
    }

    private selectEndpoints(): void {
        // Endpoint numbers are never hardcoded. They are 0x81/0x02 on every FT232R seen so far, and
        // a wrong guess is a silent dead link rather than an error.
        for (const iface of this.device?.configuration?.interfaces ?? []) {
            const inEp = iface.alternate.endpoints.find(e => e.direction === 'in' && e.type === 'bulk');
            const outEp = iface.alternate.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
            if (inEp && outEp) {
                this.interfaceNumber = iface.interfaceNumber;
                this.inEndpoint = inEp.endpointNumber;
                this.outEndpoint = outEp.endpointNumber;
                this.packetSize = inEp.packetSize || 64;
                return;
            }
        }
        throw new TransportError('No bulk endpoint pair on this USB device — is it really an FTDI cable?');
    }

    private assertSupportedChipFamily(): void {
        const version = this.device?.deviceVersionMajor ?? 0;
        if (!SUPPORTED_CHIP_VERSIONS.has(version)) {
            throw new TransportError(
                `Unsupported FTDI chip (bcdDevice major ${version}). This driver implements the 3 MHz ` +
                `divisor encoding used by FT232AM/BM/R; H-series and FT-X parts clock differently and ` +
                `would be mis-clocked rather than refused.`);
        }
    }

    private async sio(request: number, value: number, index = FTDI_PORT_INDEX): Promise<void> {
        const device = this.device;
        if (!device) throw new TransportError('USB device is not open');
        const result = await device.controlTransferOut({
            requestType: 'vendor', recipient: 'device', request, value, index,
        });
        if (result.status !== 'ok') {
            throw new TransportError(
                `FTDI control request 0x${request.toString(16)} failed (${result.status})`);
        }
    }

    private async setBaudRate(baudRate: number): Promise<void> {
        const divisor = FTDI_DIVISORS[baudRate];
        if (!divisor) {
            throw new TransportError(
                `Unsupported baud rate ${baudRate} (audited divisors exist for ` +
                `${Object.keys(FTDI_DIVISORS).join(', ')} only)`);
        }
        await this.sio(SIO_SET_BAUD_RATE, divisor.value, divisor.index);
    }

    private async flushReceive(): Promise<void> {
        await this.sio(SIO_RESET, SIO_RESET_PURGE_RX);
    }

    /**
     * The read loop.
     *
     * Exactly one transfer in flight at a time. Queueing several is the usual WebUSB throughput
     * trick and they almost certainly complete in order — but "almost certainly" reorders bytes
     * inside a telegram.
     *
     * There is nothing to cancel on shutdown: `transferIn` stays pending until the chip sends
     * something, and the chip sends a status packet on every latency-timer expiry regardless of
     * traffic, so clearing `pumpActive` ends this loop within one latency period.
     */
    private startPump(): void {
        const device = this.device!;
        this.pumpExited = (async () => {
            const scratch = new Uint8Array(8 * this.packetSize);
            while (this.pumpActive) {
                let result;
                try {
                    result = await device.transferIn(this.inEndpoint, 8 * this.packetSize);
                } catch (e) {
                    if (!this.pumpActive) return;
                    this.latch(e instanceof Error ? e : new Error(String(e)));
                    return;
                }
                if (!this.pumpActive) return;

                if (result.status === 'stall') {
                    try { await device.clearHalt('in', this.inEndpoint); continue; }
                    catch (e) { this.latch(e instanceof Error ? e : new Error(String(e))); return; }
                }
                if (result.status === 'babble') {
                    this.latch(new FtdiLineError('BabbleError', 'The USB device returned more data than requested'));
                    return;
                }

                const view = result.data;
                if (!view) continue;

                // Per PACKET, not per transfer. Stripping only at offset 0 leaves two bytes of
                // garbage every `packetSize` in an otherwise valid dump.
                let payload = 0;
                let fault: number | null = null;
                for (let offset = 0; offset + 2 <= view.byteLength; offset += this.packetSize) {
                    const lineStatus = view.getUint8(offset + 1);
                    if ((lineStatus & LSR_ANY_ERROR) !== 0 && !this.skipLineStatusOnce) {
                        fault = lineStatus;
                        break;
                    }
                    const available = Math.min(this.packetSize, view.byteLength - offset) - 2;
                    for (let i = 0; i < available; i++) scratch[payload++] = view.getUint8(offset + 2 + i);
                }
                this.skipLineStatusOnce = false;

                // Deliver before latching: bytes that arrived cleanly ahead of the fault in the same
                // transfer are real, and dropping them desyncs the frame being read.
                if (payload > 0) this.receive(scratch.subarray(0, payload));
                if (fault !== null) { this.latch(classifyLineStatus(fault)); return; }
            }
        })();
    }
}

/** Line-status bits mapped onto the error names Web Serial uses. Break first: it implies the
 *  framing garbage that accompanies it. */
function classifyLineStatus(lineStatus: number): Error {
    if (lineStatus & LSR_BREAK) return new FtdiLineError('BreakError', 'Break received');
    if (lineStatus & LSR_FRAMING) return new FtdiLineError('FramingError', 'Framing error');
    if (lineStatus & LSR_PARITY) return new FtdiLineError('ParityError', 'Parity error');
    return new FtdiLineError('BufferOverrunError', 'Receive buffer overrun');
}
