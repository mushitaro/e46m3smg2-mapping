/**
 * @tsunagi/ds2-transport — byte transports for DS2.
 *
 * One contract (`Ds2ByteTransport`, declared in @tsunagi/ds2-core), two backends, and the rule that
 * picks between them. The shared half — buffering, the parked waiter, readExact, fault latching —
 * lives in `BufferedByteTransport` so the phone and the laptop cannot drift on it.
 *
 * This replaced a `SerialPortLike` adapter that fed the WebUSB cable into a stream-based transport.
 * That arrangement gave the two platforms different buffering and different recovery, and shipped a
 * routing bug that sent Android to a Web Serial implementation which cannot see a USB cable.
 */

export { BufferedByteTransport, TransportError } from './bufferedByteTransport';
export { WebUsbFtdiTransport, FtdiLineError, FTDI_VENDOR_ID } from './webUsbFtdiTransport';
export {
    createDs2Transport,
    describeTransport,
    detectTransportKind,
    isAndroidPlatform,
    transportAvailability,
    type TransportAvailability,
    type TransportKind,
} from './select';
export {
    TracingTransport,
    formatTrace,
    type TraceEntry,
    type TraceSnapshot,
    type TracingOptions,
} from './tracingTransport';
export { getUsb, isWebUsbSupported, type UsbDeviceLike, type UsbLike } from './webusb';
