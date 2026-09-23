/**
 * Link instrumentation seam.
 *
 * Only the interface lives here for now; the concrete recorder follows. The
 * call sites exist from the start because retro-fitting them is how you end up
 * measuring the instrument instead of the link.
 *
 * Rules the concrete implementation must obey (all of them paid for on a real
 * vehicle):
 *
 * - **Stay out of your own measurement.** Preallocate typed-array lanes sized
 *   from the known exchange count. No push, no object literals, no string
 *   formatting during a transfer. Everything stays numeric until a single
 *   report() after the last exchange, which is the only place allowed to
 *   allocate.
 * - **One boolean compare first in every method**, so the disabled path is free.
 * - **Separate "enabled" from "collecting."** Enabled is policy; collecting is
 *   true only between begin() and end() of the operation being measured.
 *   Without that split an instrument wired into a shared exchange() stays live
 *   during a flash write. Nothing here can alter control flow — every method
 *   returns void and never throws — but *inert outside its window* is a
 *   property you can check, and *harmless everywhere* is one you have to argue.
 * - **Report medians, not means.** One retried exchange carries the entire
 *   deliberate settle (hundreds of ms to seconds); a mean turns "clean run" and
 *   "run with three faults" into the same number.
 * - **Sample head and middle separately.** The ECU has a warm-up: ~110 ms
 *   turnaround at the head of a read, ~40 ms once settled. A whole-run median
 *   is a blend of the two, and comparing a partial run's median against a whole
 *   run's produced a confident, wrong finding that survived two commits.
 * - **Do not gate collection behind a toggle.** A few ms across a two-minute
 *   operation saves nothing measurable and costs an entire trip to the hardware
 *   every time someone forgets to arm it. Collect always; make *saving* the
 *   deliberate act.
 *
 * The two numbers that end most arguments:
 *   - measured wire time vs theoretical `(frameBytes * bitsPerByte * 1000) / baud`
 *   - `parked / total` — if it is ~99%, host-side work is not the problem and
 *     no amount of threading, batching or buffer tuning will help. Stop.
 */
export interface LinkTiming {
    /** A byte chunk arrived from the port. Timestamped in the pump, never in readExact —
     *  readExact only ever learns that enough bytes exist, never when each arrived. */
    rx(now: number): void;
    writeStart(now: number): void;
    writeEnd(now: number): void;
    /** Entering the park in readExact. Parked/total is the honest accounting of
     *  "waiting for the wire" versus "us being slow". */
    parkStart(now: number): void;
    parkEnd(now: number): void;
    /** A new request/response exchange began. */
    exchangeStart(now: number): void;
    /** The echo has been fully read — the boundary between our transmission and the ECU thinking. */
    echoComplete(now: number): void;
    /** The response has been fully read. */
    exchangeEnd(now: number): void;
}
