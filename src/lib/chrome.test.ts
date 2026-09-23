import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { C } from './chrome';

const SRC = join(__dirname, '..');
const i18nSource = readFileSync(join(SRC, 'lib', 'i18n.ts'), 'utf8');

/**
 * The ///M copy rule, made mechanical.
 *
 * "Chrome stays out of the language switch" is the kind of rule that holds for exactly as long as
 * someone remembers it. It did not hold here: all three tabs, every section heading, every hub
 * verb and every field label had been given a Japanese translation, so the control a reader
 * learned as `チューン` was `Tune` in the file they exported.
 *
 * These assertions are what makes the rule survive the next contributor.
 */
describe('the instrument vocabulary', () => {
    it('carries no Japanese — that is the thing this file exists to prevent', () => {
        for (const [key, value] of Object.entries(C)) {
            if (typeof value !== 'string') continue;
            expect(value, `${key} = ${value}`).not.toMatch(/[぀-ヿ一-龯]/);
        }
    });

    it('is uppercase — shorthand read by shape, except where it quotes a hex literal', () => {
        // `0x53` is data, and data keeps its case: `0X53` is not how the ECU's own documentation
        // writes it. The first cut of this test uppercased the whole string, which would have
        // enforced exactly that mistake — so it is exempted here rather than obeyed.
        for (const [key, value] of Object.entries(C)) {
            if (typeof value !== 'string') continue;
            const withoutHex = value.replace(/0x[0-9a-fA-F]+/g, '');
            expect(withoutHex, `${key} = ${value}`).toBe(withoutHex.toUpperCase());
        }
    });

    it('quotes no hex literal — every one of these is rendered inside `uppercase`', () => {
        // The exemption in the test above is not enough on its own: `MicroLabel` is
        // `text-transform: uppercase`, so a correctly-lowercased `0x53` in the string still
        // reached the screen as `0X53`. The rule that actually holds is that a hex literal is
        // data and does not belong in the chrome string at all — render it beside the label, in
        // mono, with `normal-case`.
        for (const [key, value] of Object.entries(C)) {
            if (typeof value !== 'string') continue;
            expect(value, `${key} = ${value}`).not.toMatch(/0x/i);
        }
    });

    it('is a label, not a sentence', () => {
        for (const [key, value] of Object.entries(C)) {
            if (typeof value !== 'string') continue;
            expect(value.length, `${key} = ${value}`).toBeLessThanOrEqual(30);
            expect(value, `${key} = ${value}`).not.toMatch(/[.。]$/);
        }
    });

    it('does not overlap the translated catalog — one word has one home', () => {
        const overlapping = Object.keys(C).filter(key =>
            new RegExp(`^    ${key}:`, 'm').test(i18nSource));
        expect(overlapping).toEqual([]);
    });
});

describe('the translated catalog', () => {
    it('holds prose, not labels — every entry earns its second language', () => {
        // A one-word, capitalised, untranslated-looking entry in i18n is the shape the migration
        // was about. Anything matching it is a label that belongs in chrome.ts.
        const suspects: string[] = [];
        const en = i18nSource.split('const EN')[1].split('const JA')[0];
        for (const match of en.matchAll(/^ {4}(\w+): '([^']*)',$/gm)) {
            const [, key, value] = match;
            const words = value.split(/\s+/).length;
            if (words === 1 && /^[A-Z]/.test(value) && !value.endsWith('.')) suspects.push(key);
        }
        expect(suspects).toEqual([]);
    });

    it('says the same things in both languages', () => {
        const keysOf = (block: string) =>
            [...block.matchAll(/^ {4}(\w+):/gm)].map(m => m[1]).sort();
        const en = i18nSource.split('const EN')[1].split('const JA')[0];
        const ja = i18nSource.split('const JA')[1];
        expect(keysOf(en)).toEqual(keysOf(ja));
    });
});
