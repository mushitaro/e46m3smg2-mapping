/**
 * @tsunagi/ds2-smg2 — the SMG II (Siemens SMG2, DS2 0x32) layer.
 *
 * READ ONLY, and enforced at load time. See `layout.ts` -> ALLOWED_CONTROLS and
 * `link.ts` -> assertReadOnly for why the write path is absent rather than disabled.
 *
 * Everything ECU-specific lives here so that @tsunagi/ds2-core stays a protocol and
 * @tsunagi/xdf-engine stays a definition reader.
 */

export {
    ALLOWED_CONTROLS,
    BAUD_SWITCH_IS_UNRESOLVED,
    CALIBRATION_WINDOW,
    CANDIDATE_BASES,
    CANDIDATE_SEGMENTS,
    FALLBACK_READ_CHUNK,
    FORBIDDEN_CONTROLS,
    FULL_IMAGE,
    FULL_IMAGE_LENGTH,
    regionFor,
    type ReadScope,
    IDENTITY_ANCHORS,
    READ_CHUNK_CANDIDATES,
    SMG2_ADDRESS,
} from './layout';

export {
    assertReadOnly,
    Smg2ReadError,
    Smg2ReadLink,
    type ReadProgress,
    type ReadResult,
    type Smg2Identity,
    type Smg2LinkOptions,
} from './link';

export {
    CHECKSUM_DESCRIPTORS,
    CRC16_POLYNOMIAL,
    computeChecksum,
    correctChecksum,
    crc16Reflected,
    readChecksumDescriptor,
    verifyAllChecksums,
    verifyChecksum,
    type ChecksumArea,
    type ChecksumBlock,
    type ChecksumDescriptor,
    type ChecksumResult,
} from './checksum';

export {
    probeAddressSpace,
    readTwiceAndCompare,
    STRONG_MATCH,
    WEAK_MATCH,
    type ProbeCandidate,
    type ProbeCandidateResult,
    type ProbeOptions,
    type ProbeReport,
    type ProbeSample,
} from './probe';
