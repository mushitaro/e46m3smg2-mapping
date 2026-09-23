/**
 * Web Serial API types, as explicit exports rather than ambient globals.
 *
 * The tuner declares these in a .d.ts that augments the global `Navigator`.
 * That is fine inside one app and wrong in a package: a consumer that has its
 * own Web Serial declarations (or a future TypeScript DOM lib that ships them)
 * would collide with ours, and the failure is a confusing duplicate-identifier
 * error in someone else's build.
 *
 * Covers only what this package uses.
 */

export interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
}

export interface SerialOptions {
    baudRate: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
}

/** Output control lines. Both default to asserted in Chromium; native tools de-assert both. */
export interface SerialOutputSignals {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
}

export interface SerialPortLike {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    getInfo?(): SerialPortInfo;
    setSignals?(signals: SerialOutputSignals): Promise<void>;
}

export interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
}

export interface SerialLike {
    requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPortLike>;
    getPorts(): Promise<SerialPortLike[]>;
}

/**
 * `navigator.serial` IS exposed to DedicatedWorker — only `requestPort()` is
 * Window-only. If the link ever moves off the main thread, move the WHOLE link,
 * not just the transport: one exchange is a write plus several reads, so a
 * remote transport puts main-thread jank back into the per-exchange critical
 * path. Do not transfer `port.readable` either — transferred streams clone
 * every chunk through a MessagePort, which is strictly worse.
 */
export function getSerial(): SerialLike | undefined {
    if (typeof navigator === 'undefined') return undefined;
    return (navigator as Navigator & { serial?: SerialLike }).serial;
}

export function isWebSerialSupported(): boolean {
    return getSerial() !== undefined;
}
