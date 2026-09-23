/**
 * @tsunagi/xdf-engine — TunerPro XDF parsing, validation and codec.
 *
 * Layering, kept apart on purpose:
 *
 *   xml       a tiny reader for the XDF subset. Knows nothing about calibration.
 *   math      the <MATH equation> conversion and its DERIVED inverse. No I/O.
 *   parse     document -> object model. The only place XDF quirks are interpreted.
 *   codec     bytes <-> values. Endianness and signedness come from the definition, always.
 *   validate  what must be true before a definition is allowed to describe any bytes.
 *   coverage  what the definition does NOT account for. An output, not a diagnostic.
 *
 * The engine deliberately holds no ECU knowledge. Anything specific to the SMG2 belongs in
 * @tsunagi/ds2-smg2, so a second ECU costs a definition rather than a fork of this package.
 */

export { parseXml, decodeEntities, childOf, childrenOf, textOf, XmlParseError, type XmlNode } from './xml';
export { compileScaling, IDENTITY_MATH, MathParseError, type XdfScaling } from './math';
export { parseXdf, unmodelledTags, XdfParseError } from './parse';
export {
    XdfTypeFlag,
    type XdfAxis,
    type XdfConstant,
    type XdfDefinition,
    type XdfEmbedded,
    type XdfHeader,
    type XdfItem,
    type XdfRegion,
    type XdfTable,
    type XdfWidth,
} from './types';
export {
    decodeItem,
    encodeCell,
    encodeRun,
    layoutOf,
    offsetsOf,
    readRaw,
    readRun,
    runTargetOf,
    spansOf,
    writeRaw,
    XdfCodecError,
    type ByteSpan,
    type DecodedAxis,
    type DecodedItem,
    type RunLayout,
} from './codec';
export {
    hasBlockingFindings,
    validateXdf,
    type FindingSeverity,
    type ValidateOptions,
    type XdfFinding,
} from './validate';
export {
    applyOverlay,
    OverlayError,
    type EmbeddedPatch,
    type Overlay,
    type OverlayAdd,
    type OverlayAlias,
    type OverlayEntry,
    type OverlayNote,
    type OverlayUnits,
    type OverlayPatch,
    type OverlayResult,
    type Provenance,
} from './overlay';
export { coverageOf, type CoverageGap, type CoverageOptions, type CoverageReport } from './coverage';
