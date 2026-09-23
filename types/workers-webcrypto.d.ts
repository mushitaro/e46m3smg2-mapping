/**
 * WebCrypto's `KeyUsage` union, for the Functions type-check only.
 *
 * `@cloudflare/workers-types` (v5) declares `crypto.subtle` but does not export this name, and the
 * canonical owner gate (`functions/_owner-gate/gate.ts`, a byte-for-byte copy that must not be
 * edited here) uses it in one signature. The browser build gets it from the DOM lib, so the root
 * tsconfig excludes this file — declaring it twice would be a duplicate identifier.
 */
type KeyUsage = 'encrypt' | 'decrypt' | 'sign' | 'verify' | 'deriveKey' | 'deriveBits' | 'wrapKey' | 'unwrapKey';
