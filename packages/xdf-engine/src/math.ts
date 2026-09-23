/**
 * The XDF `<MATH equation="...">` conversion, and its inverse.
 *
 * Two rules govern this file.
 *
 * 1. **The equation string is never evaluated as code.** It is parsed into a tiny arithmetic AST.
 *    A definition is data downloaded from a forum; `eval` on it would be a code-execution hole in
 *    a page that also talks to a car. (The same decision, for the same reason, is recorded in
 *    `CSL_0401_Binary_Disassembly_Notes/tools/pipeline/xdfmath.py`.)
 *
 * 2. **The inverse is derived and proven, not asserted.** Writing a value back means solving
 *    `f(raw) = physical`. Hand-writing the inverse next to the forward is how the two drift apart.
 *    Instead we probe f, and if it behaves as an affine map across the probe set we adopt the
 *    closed-form inverse; otherwise we fall back to bisection over the raw domain, and only when
 *    f is monotone there. A conversion that is neither gets no writer at all — `toRaw` throws,
 *    which surfaces as "this item is read-only" rather than as a silently wrong byte.
 *
 * The SMG2 510 definition uses 15 distinct forms and every one of them is a pure scale
 * (`X`, `X/16`, `X*.4`, `X*48/1000*0.101972`, ...), so all 15 take the affine path. The generality
 * is here because MSS54-class definitions carry non-affine forms such as `25.6/X`.
 */

export interface XdfScaling {
    /** The `<MATH equation>` attribute, verbatim. Provenance only — never evaluated. */
    readonly math: string;
    readonly toPhysical: (raw: number) => number;
    /**
     * Exact inverse where the conversion is affine; a bisection solution where it is merely
     * monotone. Throws when the conversion cannot be inverted safely.
     */
    readonly toRaw: (physical: number) => number;
    /** How `toRaw` is obtained. Shown in the UI so a read-only item reads as a fact, not a bug. */
    readonly inverse: 'affine' | 'bisection' | 'none';
    /** For the affine case: physical = a*raw + b. Null otherwise. */
    readonly affine: { readonly a: number; readonly b: number } | null;
}

export class MathParseError extends Error {
    constructor(equation: string, detail: string) {
        super(`cannot parse MATH equation ${JSON.stringify(equation)}: ${detail}`);
        this.name = 'MathParseError';
    }
}

type Node =
    | { kind: 'num'; value: number }
    | { kind: 'var' }
    | { kind: 'neg'; operand: Node }
    | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Node; right: Node };

/**
 * Recursive-descent over: expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ;
 * unary := '-'? primary ; primary := number | 'X' | '(' expr ')'.
 *
 * `X` is matched case-insensitively because definitions in the wild use both cases. Any other
 * identifier is an error: an XDF may declare several <VAR id> but every equation this engine
 * accepts is single-variable, and quietly treating an unknown name as the raw value would invent
 * a conversion.
 */
function parse(equation: string): Node {
    let i = 0;
    const s = equation;

    const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const fail = (detail: string): never => { throw new MathParseError(equation, `${detail} at position ${i}`); };

    function primary(): Node {
        skip();
        if (i >= s.length) return fail('unexpected end of expression');
        const c = s[i];
        if (c === '(') {
            i++;
            const inner = expr();
            skip();
            if (s[i] !== ')') return fail("expected ')'");
            i++;
            return inner;
        }
        // A leading-dot number is normal in these files: `X*.4` appears 13 times in SMG2 510.
        if (/[0-9.]/.test(c)) {
            const start = i;
            while (i < s.length && /[0-9.]/.test(s[i])) i++;
            if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
                const mark = i;
                i++;
                if (s[i] === '+' || s[i] === '-') i++;
                if (i < s.length && /[0-9]/.test(s[i])) { while (i < s.length && /[0-9]/.test(s[i])) i++; }
                else i = mark;
            }
            const text = s.slice(start, i);
            const value = Number(text);
            if (!Number.isFinite(value)) return fail(`bad number ${JSON.stringify(text)}`);
            return { kind: 'num', value };
        }
        if (/[A-Za-z]/.test(c)) {
            const start = i;
            while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i++;
            const name = s.slice(start, i);
            if (name.toUpperCase() === 'X') return { kind: 'var' };
            return fail(`unsupported identifier ${JSON.stringify(name)}`);
        }
        return fail(`unexpected character ${JSON.stringify(c)}`);
    }

    function unary(): Node {
        skip();
        if (s[i] === '-') { i++; return { kind: 'neg', operand: unary() }; }
        if (s[i] === '+') { i++; return unary(); }
        return primary();
    }

    function term(): Node {
        let left = unary();
        for (;;) {
            skip();
            const op = s[i];
            if (op !== '*' && op !== '/') return left;
            i++;
            left = { kind: 'bin', op, left, right: unary() };
        }
    }

    function expr(): Node {
        let left = term();
        for (;;) {
            skip();
            const op = s[i];
            if (op !== '+' && op !== '-') return left;
            i++;
            left = { kind: 'bin', op, left, right: term() };
        }
    }

    const root = expr();
    skip();
    if (i !== s.length) fail('trailing characters');
    return root;
}

function evaluate(node: Node, x: number): number {
    switch (node.kind) {
        case 'num': return node.value;
        case 'var': return x;
        case 'neg': return -evaluate(node.operand, x);
        case 'bin': {
            const l = evaluate(node.left, x);
            const r = evaluate(node.right, x);
            switch (node.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return l / r;
            }
        }
    }
}

/**
 * Probe points for the affinity test. They straddle zero and span the byte and word ranges an
 * ECU actually stores, so a conversion that is affine over the probes but not over the domain
 * would have to be contrived. `0` and `1` define the candidate line; the rest check it.
 */
const PROBES = [0, 1, 2, -1, 7, 100, 255, 1000, 32767, -32768];

/** Relative tolerance for the affinity check. Chosen to survive float rounding, not to hide slope. */
const AFFINE_REL_TOL = 1e-9;

function closeEnough(actual: number, expected: number): boolean {
    const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
    return Math.abs(actual - expected) <= AFFINE_REL_TOL * scale;
}

/**
 * Build a scaling from an equation string.
 *
 * `rawMin`/`rawMax` bound the bisection fallback. They come from the item's own width and
 * signedness, so the search space is exactly the set of values the bytes can hold.
 */
export function compileScaling(equation: string, rawMin: number, rawMax: number): XdfScaling {
    const ast = parse(equation);
    const toPhysical = (raw: number) => evaluate(ast, raw);

    const b = toPhysical(0);
    const a = toPhysical(1) - b;
    let isAffine = Number.isFinite(a) && Number.isFinite(b);
    if (isAffine) {
        for (const p of PROBES) {
            const got = toPhysical(p);
            if (!Number.isFinite(got) || !closeEnough(got, a * p + b)) { isAffine = false; break; }
        }
    }

    if (isAffine && a !== 0) {
        return {
            math: equation,
            toPhysical,
            toRaw: (physical: number) => (physical - b) / a,
            inverse: 'affine',
            affine: { a, b },
        };
    }

    if (isAffine && a === 0) {
        // A constant conversion carries no information back. `X*0` is not a thing any real
        // definition does, but refusing here beats returning a raw value chosen at random.
        return {
            math: equation,
            toPhysical,
            toRaw: () => { throw new Error(`MATH ${JSON.stringify(equation)} is constant; it cannot be inverted`); },
            inverse: 'none',
            affine: { a: 0, b },
        };
    }

    // Non-affine. Usable only if monotone across the raw domain (e.g. `25.6/X` on a positive
    // domain). Sample coarsely first: a non-monotone conversion must not get a writer that
    // returns whichever of several solutions the search happens to land on.
    const lo = rawMin;
    const hi = rawMax;
    const SAMPLES = 256;
    let direction = 0;
    let monotone = lo < hi;
    let prev = toPhysical(lo);
    if (!Number.isFinite(prev)) monotone = false;
    for (let k = 1; monotone && k <= SAMPLES; k++) {
        const value = toPhysical(lo + ((hi - lo) * k) / SAMPLES);
        if (!Number.isFinite(value)) { monotone = false; break; }
        const step = Math.sign(value - prev);
        if (step !== 0) {
            if (direction === 0) direction = step;
            else if (step !== direction) monotone = false;
        }
        prev = value;
    }

    if (!monotone || direction === 0) {
        return {
            math: equation,
            toPhysical,
            toRaw: () => {
                throw new Error(
                    `MATH ${JSON.stringify(equation)} is neither affine nor monotone over the raw range ` +
                    `[${rawMin}, ${rawMax}]; this item cannot be written`);
            },
            inverse: 'none',
            affine: null,
        };
    }

    const toRaw = (physical: number): number => {
        let a0 = lo;
        let b0 = hi;
        for (let k = 0; k < 64; k++) {
            const mid = (a0 + b0) / 2;
            const value = toPhysical(mid);
            if ((value < physical ? 1 : -1) === direction) a0 = mid;
            else b0 = mid;
        }
        return (a0 + b0) / 2;
    };

    return { math: equation, toPhysical, toRaw, inverse: 'bisection', affine: null };
}

/** Identity, for the `X` equation and for axes that carry only labels. */
export const IDENTITY_MATH = 'X';
