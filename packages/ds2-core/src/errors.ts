/**
 * DS2 error taxonomy.
 *
 * Two apps consume this package and they localise differently, so an error
 * carries a machine-readable `code` and structured `detail` — the `message` is
 * a developer-facing English default, not the string a user should ever see.
 * A UI cannot branch on a sentence.
 *
 * This is a deliberate change from the tuner, whose link throws English prose
 * and whose dialogs then re-derive meaning from `errorKind`. Keeping the two in
 * sync there was manual; here the code IS the contract.
 */

export type Ds2ErrorCode =
    // --- framing / codec (pure, raised without a port) ---
    | 'FRAME_TOO_LONG'
    | 'FRAME_TOO_SHORT'
    | 'FRAME_LENGTH_INVALID'
    | 'CHECKSUM_MISMATCH'
    | 'ADDRESS_MISMATCH'
    | 'PAYLOAD_TOO_SHORT'
    | 'WRITE_COUNT_TOO_LARGE'
    | 'SEED_LENGTH_INVALID'
    // --- transport ---
    /** The BROWSER cannot do this. Prescription: use a different browser. */
    | 'PORT_UNSUPPORTED'
    /**
     * The CABLE cannot do this — an H-series FTDI part, or something with no bulk endpoint
     * pair. Prescription: use a different cable; changing browser cannot help.
     *
     * Separate from PORT_UNSUPPORTED because the two prescriptions are opposite and a user
     * given the wrong one spends the afternoon on the thing that was already fine.
     */
    | 'DEVICE_UNSUPPORTED'
    | 'PORT_NOT_OPEN'
    | 'READ_TIMEOUT'
    | 'READ_FAILED'
    | 'WRITE_FAILED'
    // --- link ---
    | 'ECHO_MISMATCH'
    | 'NEGATIVE_RESPONSE'
    | 'GATE_HELD'
    | 'NOT_CONNECTED';

/**
 * How a failure should be *acted on*, which is not the same as what went wrong.
 *
 * The distinction that matters is `electrical` vs `desync`: they need opposite
 * advice. Retrying a desync is correct and usually works; retrying an
 * electrical fault cannot work, and telling a user to "check the connection and
 * try again" sends them into an afternoon of retries that were never going to
 * succeed. See classifyEchoMismatch in echo.ts for how the two are told apart.
 */
export type Ds2ErrorKind =
    | 'electrical'
    | 'desync'
    | 'protocol'
    | 'timeout'
    | 'refused'
    | 'unclassified';

export class Ds2Error extends Error {
    readonly code: Ds2ErrorCode;
    readonly kind: Ds2ErrorKind;
    /** Structured payload for the UI and for failure reports. Never a string blob. */
    readonly detail: Readonly<Record<string, unknown>>;

    constructor(
        code: Ds2ErrorCode,
        message: string,
        options: { kind?: Ds2ErrorKind; detail?: Record<string, unknown>; cause?: unknown } = {},
    ) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'Ds2Error';
        this.code = code;
        this.kind = options.kind ?? 'protocol';
        this.detail = Object.freeze({ ...options.detail });
    }
}

export function isDs2Error(e: unknown): e is Ds2Error {
    return e instanceof Ds2Error;
}
