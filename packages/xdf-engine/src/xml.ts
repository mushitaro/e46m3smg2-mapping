/**
 * A deliberately small XML reader for the TunerPro XDF subset.
 *
 * Why hand-rolled rather than a dependency: this package runs in the browser (static export)
 * and in Node (vitest), and the XDF subset is tiny and closed — elements, attributes, text,
 * self-closing tags, comments, and a handful of entity refs. A general parser would bring a
 * bundle cost and a configuration surface for no capability we use.
 *
 * The rule this file follows: **fail loudly with a position, never skip silently.** A malformed
 * definition that parses "mostly" is far worse than one that refuses to load, because the
 * numbers it produces still look like numbers.
 *
 * Not supported, on purpose: CDATA, namespaces, DTDs, and processing instructions beyond
 * skipping them. If a definition ever needs one, add it here with a test rather than by
 * loosening the error handling.
 */

export interface XmlNode {
    tag: string;
    attrs: Readonly<Record<string, string>>;
    children: readonly XmlNode[];
    /** Concatenated direct text content, entity-decoded, trimmed. */
    text: string;
}

export class XmlParseError extends Error {
    readonly index: number;
    constructor(message: string, index: number, source: string) {
        super(`${message} (at offset ${index}: ${JSON.stringify(context(source, index))})`);
        this.name = 'XmlParseError';
        this.index = index;
    }
}

function context(source: string, index: number): string {
    return source.slice(Math.max(0, index - 40), index + 40);
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
    lt: '<', gt: '>', amp: '&', quot: '"', apos: "'",
};

/**
 * Decode the entity forms TunerPro actually emits. `&#013;&#010;` appears throughout the SMG2
 * definition's <description> fields, so a reader that leaves them raw corrupts every multi-line
 * description in the UI.
 *
 * An unknown entity is an error, not a pass-through: silently emitting `&foo;` would put a
 * literal ampersand-sequence into text the author meant as a character.
 */
export function decodeEntities(raw: string): string {
    let out = '';
    let i = 0;
    while (i < raw.length) {
        const amp = raw.indexOf('&', i);
        if (amp === -1) { out += raw.slice(i); break; }
        out += raw.slice(i, amp);
        const semi = raw.indexOf(';', amp);
        if (semi === -1 || semi - amp > 12) {
            throw new XmlParseError('unterminated entity reference', amp, raw);
        }
        const body = raw.slice(amp + 1, semi);
        if (body[0] === '#') {
            const hex = body[1] === 'x' || body[1] === 'X';
            const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
            if (!Number.isFinite(code)) throw new XmlParseError(`bad numeric entity &${body};`, amp, raw);
            out += String.fromCodePoint(code);
        } else {
            const named = NAMED_ENTITIES[body];
            if (named === undefined) throw new XmlParseError(`unknown entity &${body};`, amp, raw);
            out += named;
        }
        i = semi + 1;
    }
    return out;
}

const WS = /\s/;
const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;

/** Parse a whole document and return its single root element. */
export function parseXml(source: string): XmlNode {
    const reader = new Reader(source);
    reader.skipTrivia();
    const root = reader.readElement();
    reader.skipTrivia();
    if (!reader.atEnd()) throw new XmlParseError('trailing content after the root element', reader.i, source);
    return root;
}

class Reader {
    i = 0;
    private readonly s: string;
    constructor(source: string) { this.s = source; }

    atEnd(): boolean { return this.i >= this.s.length; }

    private fail(msg: string): never { throw new XmlParseError(msg, this.i, this.s); }

    private skipSpace(): void {
        while (this.i < this.s.length && WS.test(this.s[this.i])) this.i++;
    }

    /** Whitespace, comments, and `<?...?>` instructions between nodes. */
    skipTrivia(): void {
        for (;;) {
            this.skipSpace();
            if (this.s.startsWith('<!--', this.i)) {
                const end = this.s.indexOf('-->', this.i + 4);
                if (end === -1) this.fail('unterminated comment');
                this.i = end + 3;
                continue;
            }
            if (this.s.startsWith('<?', this.i)) {
                const end = this.s.indexOf('?>', this.i + 2);
                if (end === -1) this.fail('unterminated processing instruction');
                this.i = end + 2;
                continue;
            }
            return;
        }
    }

    private readName(): string {
        const start = this.i;
        if (this.i >= this.s.length || !NAME_START.test(this.s[this.i])) this.fail('expected a name');
        this.i++;
        while (this.i < this.s.length && NAME_CHAR.test(this.s[this.i])) this.i++;
        return this.s.slice(start, this.i);
    }

    readElement(): XmlNode {
        if (this.s[this.i] !== '<') this.fail("expected '<'");
        this.i++;
        const tag = this.readName();
        const attrs: Record<string, string> = {};

        for (;;) {
            this.skipSpace();
            const c = this.s[this.i];
            if (c === '/' || c === '>') break;
            const name = this.readName();
            this.skipSpace();
            if (this.s[this.i] !== '=') this.fail(`expected '=' after attribute ${name}`);
            this.i++;
            this.skipSpace();
            const quote = this.s[this.i];
            if (quote !== '"' && quote !== "'") this.fail(`expected a quoted value for attribute ${name}`);
            this.i++;
            const end = this.s.indexOf(quote, this.i);
            if (end === -1) this.fail(`unterminated value for attribute ${name}`);
            // A duplicate attribute is an error, not a last-one-wins: silently keeping one of two
            // conflicting addresses is exactly the class of bug this package exists to prevent.
            if (Object.prototype.hasOwnProperty.call(attrs, name)) this.fail(`duplicate attribute ${name}`);
            attrs[name] = decodeEntities(this.s.slice(this.i, end));
            this.i = end + 1;
        }

        if (this.s[this.i] === '/') {
            this.i++;
            if (this.s[this.i] !== '>') this.fail("expected '>' to close an empty element");
            this.i++;
            return { tag, attrs, children: [], text: '' };
        }
        this.i++; // consume '>'

        const children: XmlNode[] = [];
        let text = '';
        for (;;) {
            if (this.i >= this.s.length) this.fail(`unclosed element <${tag}>`);
            if (this.s.startsWith('</', this.i)) {
                this.i += 2;
                const close = this.readName();
                if (close !== tag) this.fail(`</${close}> closes <${tag}>`);
                this.skipSpace();
                if (this.s[this.i] !== '>') this.fail("expected '>' on a closing tag");
                this.i++;
                break;
            }
            if (this.s.startsWith('<!--', this.i) || this.s.startsWith('<?', this.i)) { this.skipTrivia(); continue; }
            if (this.s[this.i] === '<') { children.push(this.readElement()); continue; }
            const next = this.s.indexOf('<', this.i);
            if (next === -1) this.fail(`unclosed element <${tag}>`);
            text += decodeEntities(this.s.slice(this.i, next));
            this.i = next;
        }
        return { tag, attrs, children, text: text.trim() };
    }
}

/** All direct children with the given tag. */
export function childrenOf(node: XmlNode, tag: string): readonly XmlNode[] {
    return node.children.filter(c => c.tag === tag);
}

/** The single direct child with the given tag, or null. Two matches is an error. */
export function childOf(node: XmlNode, tag: string): XmlNode | null {
    const found = childrenOf(node, tag);
    if (found.length > 1) {
        throw new Error(`<${node.tag}> has ${found.length} <${tag}> children, expected at most one`);
    }
    return found[0] ?? null;
}

/** Trimmed text of the single direct child with the given tag; null when absent or empty. */
export function textOf(node: XmlNode, tag: string): string | null {
    const child = childOf(node, tag);
    if (!child) return null;
    return child.text === '' ? null : child.text;
}
