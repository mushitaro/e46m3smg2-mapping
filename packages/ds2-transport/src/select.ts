/**
 * Which backend can reach the ECU here, and building it.
 *
 * Ported from the MSS54HP CSL Convert Tuner's `byteTransport.ts`, reasoning included, because this
 * app got it wrong by reasoning from first principles instead and the mistake reached a vehicle.
 *
 * **The rule that matters.** Chrome for Android 138+ exposes `navigator.serial`, so
 * `'serial' in navigator` is TRUE on a phone — but that implementation enumerates only Bluetooth
 * RFCOMM serial-port emulation, and a USB K+DCAN cable never appears in its picker. There is no
 * feature test that separates "Web Serial that can see USB adapters" from "Web Serial that can see
 * only Bluetooth SPP": both objects are identical. The difference shows up as an empty chooser
 * after the user has already tapped through a permission prompt.
 *
 * So **Android is asked by name and routed to WebUSB.** This is the one place in the app that looks
 * at the platform rather than at a capability, and it has to be.
 *
 * A previous version preferred Web Serial wherever it existed, on the reasoning that it was "the
 * path with vehicle hours on it". That reasoning was about the DESKTOP path and does not transfer
 * to a phone. Do not re-derive it.
 */

import { WebSerialTransport, type Ds2ByteTransport } from '@tsunagi/ds2-core';

import { WebUsbFtdiTransport } from './webUsbFtdiTransport';

/**
 * 'none' is a real answer, not an error: opening a `.bin` from disk stays fully usable with no
 * hardware transport at all, so this only gates the direct-ECU features.
 */
export type TransportKind = 'web-serial' | 'web-usb-ftdi' | 'none';

function hasWebSerial(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
}

function hasWebUsb(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
}

/**
 * True on Android, the one platform where capability detection cannot decide for us.
 *
 * `userAgentData.platform` is Chromium's structured answer and is not subject to the UA-string
 * freezing games; the regex is the fallback for engines that do not expose it.
 */
export function isAndroidPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    if (uaData?.platform) return uaData.platform === 'Android';
    return /android/i.test(navigator.userAgent);
}

/**
 * Pick the backend for this browser.
 *
 * `?transport=webusb` / `?transport=webserial` overrides the choice. It costs nothing on a static
 * export, and it is what lets the WebUSB path be driven from a desktop bench rig — which matters a
 * great deal when the alternative is testing a byte transport for the first time in a car.
 */
export function detectTransportKind(): TransportKind {
    // Static prerender: neither API can exist, and answering 'none' here would bake an
    // "unsupported browser" notice into the exported HTML. Callers must resolve this after mount.
    if (typeof navigator === 'undefined' || typeof location === 'undefined') return 'none';

    const forced = new URLSearchParams(location.search).get('transport');
    if (forced === 'webusb') return hasWebUsb() ? 'web-usb-ftdi' : 'none';
    if (forced === 'webserial') return hasWebSerial() ? 'web-serial' : 'none';

    if (isAndroidPlatform()) return hasWebUsb() ? 'web-usb-ftdi' : 'none';
    return hasWebSerial() ? 'web-serial' : 'none';
}

export interface TransportAvailability {
    readonly kind: TransportKind;
    readonly android: boolean;
    /** Both raw capabilities, for the diagnostics screen — never for the routing decision. */
    readonly hasWebSerial: boolean;
    readonly hasWebUsb: boolean;
    /** Set when `?transport=` forced the choice, so the UI can say the route was overridden. */
    readonly forced: string | null;
}

export function transportAvailability(): TransportAvailability {
    const forced = typeof location === 'undefined'
        ? null
        : new URLSearchParams(location.search).get('transport');
    return {
        kind: detectTransportKind(),
        android: isAndroidPlatform(),
        hasWebSerial: hasWebSerial(),
        hasWebUsb: hasWebUsb(),
        forced,
    };
}

/** One sentence naming the route and, where it matters, why it is not the other one. */
export function describeTransport(a: TransportAvailability): string {
    if (a.forced) {
        return a.kind === 'none'
            ? `?transport=${a.forced} was requested but that API is not available here.`
            : `Route forced to ${a.kind} by ?transport=${a.forced}.`;
    }
    switch (a.kind) {
        case 'web-usb-ftdi':
            return a.android
                ? 'Android: WebUSB + FTDI. Chrome for Android does expose Web Serial, but it lists ' +
                  'only Bluetooth serial ports — a USB K+DCAN cable never appears there.'
                : 'WebUSB + FTDI.';
        case 'web-serial':
            return 'Desktop: Web Serial. Pick the K+DCAN cable’s COM port when the chooser opens.';
        case 'none':
            return a.android
                ? 'This Android browser has no WebUSB. Chrome for Android is required.'
                : 'This browser reaches neither Web Serial nor WebUSB — iOS supports neither. ' +
                  'Use desktop Chrome/Edge, or Chrome for Android.';
    }
}

/**
 * Build the transport this browser can actually use.
 *
 * Detection happens HERE rather than being passed in, so the decision is made at connect time — a
 * phone that gains an OTG adapter between page load and the first tap does not need a reload.
 */
export function createDs2Transport(): Ds2ByteTransport {
    switch (detectTransportKind()) {
        case 'web-serial':
            return new WebSerialTransport();
        case 'web-usb-ftdi':
            return new WebUsbFtdiTransport();
        default:
            throw new Error(describeTransport(transportAvailability()));
    }
}
