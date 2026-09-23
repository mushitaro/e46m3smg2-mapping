/**
 * Let plain Node run this repo's TypeScript without a bundler.
 *
 * `node --experimental-strip-types` removes the types but does not resolve extensionless
 * relative imports, which is how every module here is written (the bundler and vitest both
 * resolve them). Rather than put `.ts` on 40 import lines — which then needs
 * `allowImportingTsExtensions` and changes how the app itself compiles — the resolution happens
 * here, in the one place that needs it.
 *
 * `@tsunagi/*` and `@/*` are mapped to the same paths `tsconfig.json` declares, so a tool and the
 * app cannot disagree about what a package name means.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ALIASES = [
    ['@tsunagi/c166', 'packages/c166/src/index.ts'],
    ['@tsunagi/ds2-core', 'packages/ds2-core/src/index.ts'],
    ['@tsunagi/ds2-smg2', 'packages/ds2-smg2/src/index.ts'],
    ['@tsunagi/ds2-smg2-write', 'packages/ds2-smg2-write/src/index.ts'],
    ['@tsunagi/ds2-transport', 'packages/ds2-transport/src/index.ts'],
    ['@tsunagi/xdf-engine', 'packages/xdf-engine/src/index.ts'],
];

export function resolve(specifier, context, next) {
    for (const [name, target] of ALIASES) {
        if (specifier === name) return next(pathToFileURL(resolvePath(ROOT, target)).href, context);
    }
    if (specifier.startsWith('@/')) {
        return next(pathToFileURL(resolvePath(ROOT, 'src', specifier.slice(2))).href, context);
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
        for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
            if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
        }
    }
    return next(specifier, context);
}
