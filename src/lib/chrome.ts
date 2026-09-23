/**
 * The instrument's vocabulary. One form, both languages.
 *
 * ///M rule (`tsunagi-m-design` → ux-patterns → Copy): **chrome stays out of the language
 * switch.** Button labels, tab names, column headings and status shorthand are uppercase
 * technical words — READ, EXPORT, TUNE — and they are the same word for a Japanese reader and an
 * English one. Translating them breaks the labels-are-promises chain instead of serving it: the
 * tab, the button, the file name and the manifest have to use ONE word for one thing, and a word
 * that changes with `navigator.language` cannot be that word.
 *
 * This app had it the other way round. All three tabs, every section heading, every hub verb and
 * every field label carried a `ja` and an `en` string — so the control a reader learned as
 * `チューン` was `Tune` in the export they shared, and the vocabulary the docs use (`TUNE`,
 * `COVERAGE`, `CRC OK`) matched neither.
 *
 * **What stays in `i18n.ts`:** prose. Reasons, warnings, hints, descriptions, aria sentences,
 * anything longer than a label — everything whose job is to be *understood* rather than
 * *recognised*. Safety copy especially: it is written in the reader's language, one language at
 * a time, and that rule is unchanged.
 *
 * These are not exported through the `Catalog` type on purpose. A key here cannot be translated
 * by accident, because there is nowhere to put the second string.
 */

export const C = {
    // Header
    readOnly: 'READ ONLY',
    offline: 'OFFLINE',
    install: 'INSTALL',
    update: 'UPDATE',

    // Tabs
    tabDevice: 'DEVICE',
    tabTune: 'TUNE',
    tabCoverage: 'COVERAGE',

    // Link state, beside the LED
    stateOffline: 'OFFLINE',
    stateLinking: 'LINKING',
    stateLinked: 'LINKED',
    stateProbing: 'PROBING',
    stateReading: 'READING',
    statePractice: 'PRACTICE',

    // Hub faces
    hubConnect: 'CONNECT',
    hubLinking: 'LINKING',
    hubProbe: 'PROBE',
    hubProbing: 'PROBING',
    hubRead: 'READ',
    hubReading: 'READING',
    /** Saves the session to the owner's account. Preview only; production's hub has no such face. */
    hubSync: 'SYNC',
    hubSending: 'SENDING',
    hubReread: 'RE-READ',

    // Section headings
    secConnection: 'CONNECTION',
    secZbNumber: 'VEHICLE ZB NUMBER',
    secProbe: 'ADDRESS-SPACE PROBE',
    secOpenImage: 'OPEN AN IMAGE',
    secDefinition: 'DEFINITION',
    secWorkspace: 'WORKSPACE',
    secLog: 'LINK LOG',
    secTables: 'PARAMETERS',
    secCoverage: 'DEFINITION COVERAGE',
    secChanges: 'CHANGES',
    secRaw: 'RAW',
    secManualSpace: 'ADDRESS SPACE BY HAND',
    fManufacturerData: 'MANUFACTURER DATA',
    fScope: 'SCOPE',
    scopeWindow: 'WINDOW 24K · ~2 MIN',
    scopeFull: 'FULL 512K · ~18 MIN',

    // Field labels
    fPhase: 'PHASE',
    fRoute: 'ROUTE',
    fAddressSpace: 'ADDRESS SPACE',
    fLastRead: 'LAST READ',
    fVerified: 'VERIFIED',
    fBuild: 'BUILD',
    fSource: 'SOURCE',
    fSize: 'SIZE',
    fEdits: 'EDITS',
    fSegment: 'SEGMENT',
    fBase: 'BASE',
    fDefined: 'DEFINED',
    fCoverage: 'COVERAGE',
    fWindow: 'WINDOW',
    fLargeGaps: 'LARGE GAPS',

    // Buttons
    bPractice: 'PRACTICE MODE',
    bChooseBin: 'CHOOSE .BIN',
    bUseIt: 'USE IT',
    bExport: 'EXPORT',
    bClear: 'CLEAR',
    bSend: 'SEND',
    bCopy: 'COPY',
    bDisconnect: 'DISCONNECT',
    bRefresh: 'REFRESH',
    bRevert: 'REVERT',
    bStop: 'STOP',
    bDismiss: 'DISMISS',
    bDiscardEdits: 'DISCARD EDITS',
    bAddRaw: 'ADD RAW',
    bScalePercent: '% SCALE',
    /** The scope a bulk edit will hit, stated rather than implied. */
    scopeAllCells: (n: string) => `ALL ${n} CELLS`,
    bCopyFrom: (ref: string) => `COPY FROM ${ref}`,
    bList: 'LIST',

    // Values and badges
    vMismatch: 'MISMATCH',
    vPracticeBytes: 'PRACTICE BYTES',
    vNoChecksum: 'NO CHECKSUM',
    vSynced: 'SYNCED',
    vOk: 'OK',
    vFailed: 'FAILED',
    vAll: 'ALL',
    vPartial: 'PARTIAL',
    vUnverified: 'UNVERIFIED',
    vCrcOk: 'CRC OK',
    vCrcBad: 'CRC STALE',
    vAdded: 'ADDED BY THIS PROJECT',

    // TUNE
    formMap: 'MAP',
    formShift: 'SHIFT',
    formBits: 'BITS',
    refBase: 'REFERENCE',
    gearPair: 'GEAR PAIR',
    throttleAxis: 'THROTTLE',
    scopeThisValue: 'THIS VALUE',
    facetCategory: 'CATEGORY',
    matchOrder: 'MATCH ORDER',
    kindTables: 'TABLES',
    kindConstants: 'CONSTANTS',
    uncategorised: 'UNCATEGORISED',
    undocumentedBits: 'UNDOCUMENTED BITS',

    // COVERAGE
    covWindowMap: 'WINDOW MAP',
    covUnmapped: 'UNMAPPED RUNS',
    covPerCategory: 'ITEMS PER CATEGORY',
    covDeclaredEmpty: 'DECLARED, EMPTY:',

    // Empty states — uppercase-technical by house rule, "AWAITING …" not "Nothing here yet".
    awaitingImage: 'AWAITING BINARY FILE',
    awaitingParameter: 'NO PARAMETER SELECTED',
    awaitingLog: 'NO TELEGRAMS YET',
    noMatch: 'NO MATCH',

    // The shell, as the reference tuner names it
    tabStartup: 'STARTUP',
    tabCalibration: 'CALIBRATION',
    tabCode: 'CODE',

    // ── SESSIONS: the record of every image this tool has held. ──
    sessions: 'SESSIONS',
    // ── CLOUD: what the owner has saved with SYNC, and the records filed on their own. Preview only.
    cloud: 'CLOUD',
    cloudRecords: 'RECORDS',
    bRestore: 'RESTORE',
    bDelete: 'DELETE',
    bSignIn: 'SIGN IN',
    originVehicle: 'VEHICLE',
    originPractice: 'PRACTICE',
    bRename: 'RENAME',
    bSave: 'SAVE',
    bOpen: 'OPEN',

    // ── FLASH: the write path's own vocabulary. Every one of these names a gate, not a wish. ──
    bFlash: 'FLASH',
    flashPreflight: 'FLASH PREFLIGHT',
    blocked: 'BLOCKED',
    // Not `ready`: that word is already the link's, in the translated catalog, and one word with
    // two homes is two controls that look like one.
    passed: 'PASSED',
    blocking: 'BLOCKING',
    note: 'NOTE',
    checksRun: 'CHECKS RUN',
    whatGetsErased: 'WHAT GETS ERASED',
    whatStopsIt: 'WHAT STOPS IT',
    noWritePath: 'NO WRITE PATH IN THIS BUILD',
    paneViz: 'VISUALIZATION & INPUTS',
    paneCode: 'PROGRAM & REFERENCES',

    // ── The CODE tab. Every one of these names a thing the sweep either found or did not. ──
    formNetwork: 'NETWORK',
    formListing: 'LISTING',
    bottomFn: 'FN',
    functions: 'FUNCTIONS',
    segment: 'SEGMENT',
    callers: 'CALLERS',
    callees: 'CALLS',
    touches: 'TOUCHES',
    walks: 'WALKS',
    reads: 'READS',
    readBy: 'READ BY',
    noReader: 'NO READER FOUND',
    stated: 'STATED',
    inferred: 'INFERRED',
    unnamedReads: 'UNNAMED READS',
    entryPoint: 'ENTRY',
    instructions: 'INSTRUCTIONS',
    coverage: 'COVERAGE',
    codeNeedsFull: 'FULL IMAGE REQUIRED',
    fnReturns: 'RETURNS',
    fnNoReturn: 'NO RETURN',
    bottomDiff: 'DIFF',
    bottomInfo: 'INFO',
    bottomSmg: 'SMG',
    statusRowSmg: 'SMG (LIVE)',
    narrowMap: 'MAP',
    narrowGraph: 'GRAPH',
    narrowDash: 'DASH',
    menu: 'MENU',
    close: 'CLOSE',
    bandVehicle: 'VEHICLE',
    bandSession: 'SESSION',
    bandView: 'VIEW',
    vTuned: 'TUNED',
    vDraft: 'DRAFT',

    // The tree
    tree: 'TREE',
    search: 'SEARCH',
    parameters: 'PARAMETERS',
    results: 'RESULTS',
    kindConstant: 'CONSTANT',
    kindCurve: 'CURVE',
    kindMap: 'MAP',

    // The value pane
    form2d: '2D',
    formHeat: 'HEAT',
    viewSubject: 'SUBJECT',
    viewDelta: 'Δ',
    viewReference: 'REFERENCE',
    bannerDelta: 'SUBJECT − REFERENCE',
    bannerSubject: 'TINT VS REFERENCE',
    bannerReference: 'TINT VS SUBJECT',
    along: 'ALONG',
    bAdd: 'ADD',
    bScale: '× SCALE',
    copyRef: 'COPY REF',
    cells: 'CELLS',
    filter: 'FILTER',
    copyShown: (n: number) => `COPY ${n} SHOWN`,

    // INFO
    infoAddr: 'ADDR',
    infoWidth: 'WIDTH',
    infoSigned: 'SIGNED',
    infoUnsigned: 'UNSIGNED',
    infoUnits: 'UNITS',
    infoScaling: 'SCALING',
    infoDims: 'DIMS',
    infoDescription: 'DESCRIPTION',
    infoNote: 'THIS PROJECT',
    infoRows: 'ROW GROUPS',
    infoBits: 'BITS',
    infoAxisX: 'X AXIS',
    infoAxisY: 'Y AXIS',
} as const;
