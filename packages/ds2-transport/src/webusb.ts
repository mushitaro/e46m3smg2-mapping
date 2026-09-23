/**
 * WebUSB types, as explicit exports rather than ambient globals.
 *
 * Same reasoning as `@tsunagi/ds2-core`'s `webSerialTypes`: a package that augments the global
 * `Navigator` collides with a consumer that has its own declarations, and the failure surfaces as
 * a duplicate-identifier error in someone else's build. Covers only what this package uses.
 */

export interface UsbControlTransferParameters {
    requestType: 'standard' | 'class' | 'vendor';
    recipient: 'device' | 'interface' | 'endpoint' | 'other';
    request: number;
    value: number;
    index: number;
}

export type UsbTransferStatus = 'ok' | 'stall' | 'babble';

export interface UsbInTransferResult {
    data?: DataView;
    status?: UsbTransferStatus;
}

export interface UsbOutTransferResult {
    bytesWritten: number;
    status?: UsbTransferStatus;
}

export interface UsbEndpoint {
    endpointNumber: number;
    direction: 'in' | 'out';
    type: 'bulk' | 'interrupt' | 'isochronous';
    packetSize: number;
}

export interface UsbAlternateInterface {
    endpoints: UsbEndpoint[];
}

export interface UsbInterface {
    interfaceNumber: number;
    alternate: UsbAlternateInterface;
}

export interface UsbConfiguration {
    interfaces: UsbInterface[];
}

export interface UsbDeviceLike {
    readonly vendorId: number;
    readonly productId: number;
    readonly deviceVersionMajor: number;
    readonly opened: boolean;
    readonly configuration?: UsbConfiguration | null;
    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(value: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    releaseInterface(interfaceNumber: number): Promise<void>;
    controlTransferOut(setup: UsbControlTransferParameters): Promise<UsbOutTransferResult>;
    transferIn(endpointNumber: number, length: number): Promise<UsbInTransferResult>;
    // `ArrayBufferLike` rather than `BufferSource`: a Uint8Array arriving from a stream is not
    // narrowed to ArrayBuffer-backed, and widening here is honest — WebUSB copies the bytes out.
    transferOut(endpointNumber: number, data: ArrayBufferView | ArrayBufferLike): Promise<UsbOutTransferResult>;
    clearHalt(direction: 'in' | 'out', endpointNumber: number): Promise<void>;
}

export interface UsbLike {
    getDevices(): Promise<UsbDeviceLike[]>;
    requestDevice(options: { filters: { vendorId?: number; productId?: number }[] }): Promise<UsbDeviceLike>;
}

export function getUsb(): UsbLike | undefined {
    if (typeof navigator === 'undefined') return undefined;
    return (navigator as Navigator & { usb?: UsbLike }).usb;
}

export function isWebUsbSupported(): boolean {
    return getUsb() !== undefined;
}
