import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@tsunagi/c166': r('./packages/c166/src/index.ts'),
            '@tsunagi/ds2-core': r('./packages/ds2-core/src/index.ts'),
            '@tsunagi/ds2-smg2': r('./packages/ds2-smg2/src/index.ts'),
            '@tsunagi/ds2-smg2-write': r('./packages/ds2-smg2-write/src/index.ts'),
            '@tsunagi/ds2-transport': r('./packages/ds2-transport/src/index.ts'),
            '@tsunagi/xdf-engine': r('./packages/xdf-engine/src/index.ts'),
            '@': r('./src'),
        },
    },
    test: {
        include: ['packages/**/*.test.ts', 'src/**/*.test.ts'],
        environment: 'node',
    },
});
