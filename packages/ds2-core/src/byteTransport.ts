import type { LinkTiming } from './timing';

/**
 * The contract `Ds2Link` needs from whatever moves bytes.
 *
 * It was `WebSerialTransport` — the concrete class — for as long as there was only one. There is a
 * second backend now: Android Chrome exposes a `navigator.serial` that enumerates only Bluetooth
 * RFCOMM ports, so a USB K+DCAN cable is unreachable there and has to be driven over WebUSB with
 * the FTDI vendor protocol instead. Naming the contract is what lets a second backend exist without
 * `Ds2Link` knowing which one it has.
 *
 * **This is deliberately a description of the surface `Ds2Link` already calls, not a redesign of
 * it.** Every member below appears in link.ts today; nothing in that file changes.
 *
 * `setTiming` is OPTIONAL rather than required. The link attaches an instrument when it is given
 * one, but a backend that cannot measure — or that measures with its own instrument type — should
 * not have to supply a stub that lies about what it recorded. The call site uses `?.` accordingly.
 *
 * `reopen` / `reopenIsInPlace` are deliberately absent: baud switching is a capability of some
 * transports and a destructive-path concern of the caller. `Ds2Link` never initiates it.
 */
export interface Ds2ByteTransport {
    open(): Promise<void>;
    close(): Promise<void>;
    write(bytes: Uint8Array): Promise<void>;
    /** Reads exactly `length` bytes, waiting up to `timeoutMs`. Surplus stays buffered. */
    readExact(length: number, timeoutMs: number): Promise<Uint8Array>;
    /**
     * Discards buffered received bytes. **Synchronous by contract** — `resync` calls it without
     * awaiting and reads `bufferedLength()` immediately afterwards expecting zero.
     */
    purge(): void;
    bufferedLength(): number;
    hasReadError(): boolean;
    /** The latched error WITHOUT clearing it, so a caller can name the cause in its own message. */
    peekReadError(): Error | null;
    /**
     * Clears a latched read fault and restarts the receive path.
     *
     * `settleMs` is optional so a backend with nothing to settle — the FTDI path restarts its pump
     * without a port transition — can ignore it rather than pretend to honour it.
     */
    recoverRead(settleMs?: number): Promise<void>;
    /**
     * Attach a timing instrument, if this backend can drive one.
     *
     * Optional because the two backends do not measure the same thing — only the FTDI path has a
     * latency timer — so their reported sample rates are not directly comparable, and a backend
     * with no instrument should say so by not implementing this rather than by recording zeros.
     */
    setTiming?(timing: LinkTiming | null): void;
}
