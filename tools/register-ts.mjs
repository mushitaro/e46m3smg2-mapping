/**
 * Registers the resolver in `ts-resolve-hooks.mjs`.
 *
 * `--import` loads a module; it does not install loader hooks. `module.register` does, and it has
 * to happen from a separate module because hooks run on their own thread.
 */
import { register } from 'node:module';
register('./ts-resolve-hooks.mjs', import.meta.url);
