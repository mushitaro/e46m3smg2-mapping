/**
 * Route selection, pinned.
 *
 * Every case here exists because getting it wrong produces the same user-visible symptom — "the
 * K+DCAN cable is not recognised" — from four different causes. The Android one is not
 * hypothetical: this app shipped preferring Web Serial wherever it existed, and on a phone that
 * opened a picker listing only Bluetooth serial ports while the cable sat in the OTG adapter.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectTransportKind, describeTransport, isAndroidPlatform, transportAvailability } from '@tsunagi/ds2-transport';

/** Install a fake `navigator` and `location`, since neither exists in the Node test environment. */
function stubEnvironment(options: {
    serial?: boolean;
    usb?: boolean;
    userAgent?: string;
    uaDataPlatform?: string;
    search?: string;
}) {
    const navigator: Record<string, unknown> = {
        userAgent: options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140',
    };
    if (options.serial) navigator.serial = {};
    if (options.usb) navigator.usb = {};
    if (options.uaDataPlatform) navigator.userAgentData = { platform: options.uaDataPlatform };

    vi.stubGlobal('navigator', navigator);
    vi.stubGlobal('location', { search: options.search ?? '' });
}

afterEach(() => vi.unstubAllGlobals());

describe('Android', () => {
    /**
     * The regression this file was written for.
     *
     * Chrome for Android 138+ has `navigator.serial`, and it enumerates ONLY Bluetooth RFCOMM.
     * There is no feature test that tells the two Web Serial implementations apart, so preferring
     * it "because it is available" routes a phone into a chooser the cable can never appear in.
     */
    it('routes to WebUSB even though Web Serial is present', () => {
        stubEnvironment({
            serial: true,
            usb: true,
            uaDataPlatform: 'Android',
            userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile',
        });
        expect(isAndroidPlatform()).toBe(true);
        expect(detectTransportKind()).toBe('web-usb-ftdi');
    });

    it('is detected from the UA string when userAgentData is absent', () => {
        stubEnvironment({ serial: true, usb: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140' });
        expect(isAndroidPlatform()).toBe(true);
        expect(detectTransportKind()).toBe('web-usb-ftdi');
    });

    it('trusts userAgentData over the UA string', () => {
        // A desktop Chrome whose UA string mentions Android (extensions and devtools emulation both
        // do this) must not be routed to WebUSB on the strength of a string.
        stubEnvironment({
            serial: true, usb: true,
            uaDataPlatform: 'Windows',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140 android-ish',
        });
        expect(isAndroidPlatform()).toBe(false);
        expect(detectTransportKind()).toBe('web-serial');
    });

    it('says none when an Android browser has no WebUSB', () => {
        stubEnvironment({ serial: true, usb: false, uaDataPlatform: 'Android' });
        expect(detectTransportKind()).toBe('none');
        expect(describeTransport(transportAvailability())).toMatch(/no WebUSB/);
    });
});

describe('desktop', () => {
    it('uses Web Serial', () => {
        stubEnvironment({ serial: true, usb: true, uaDataPlatform: 'Windows' });
        expect(detectTransportKind()).toBe('web-serial');
    });

    it('reports none on a browser with neither, and names iOS', () => {
        stubEnvironment({ serial: false, usb: false, userAgent: 'Mozilla/5.0 (iPhone) Safari' });
        expect(detectTransportKind()).toBe('none');
        expect(describeTransport(transportAvailability())).toMatch(/iOS supports neither/);
    });
});

describe('?transport override', () => {
    it('forces WebUSB on a desktop bench rig', () => {
        // The reason this exists: the alternative to testing a byte transport on a desktop is
        // testing it for the first time in a car.
        stubEnvironment({ serial: true, usb: true, uaDataPlatform: 'Windows', search: '?transport=webusb' });
        expect(detectTransportKind()).toBe('web-usb-ftdi');
        expect(describeTransport(transportAvailability())).toMatch(/forced/i);
    });

    it('forces Web Serial on Android', () => {
        stubEnvironment({ serial: true, usb: true, uaDataPlatform: 'Android', search: '?transport=webserial' });
        expect(detectTransportKind()).toBe('web-serial');
    });

    it('does not invent a capability the browser lacks', () => {
        stubEnvironment({ serial: false, usb: false, search: '?transport=webusb' });
        expect(detectTransportKind()).toBe('none');
        expect(describeTransport(transportAvailability())).toMatch(/not available/);
    });
});

describe('prerender', () => {
    it('answers none without baking an unsupported-browser notice into the export', () => {
        // `navigator` does not exist while Next prerenders. The value must not be read at module
        // scope anywhere; callers resolve it after mount.
        vi.stubGlobal('navigator', undefined);
        vi.stubGlobal('location', undefined);
        expect(detectTransportKind()).toBe('none');
        expect(isAndroidPlatform()).toBe(false);
    });
});
