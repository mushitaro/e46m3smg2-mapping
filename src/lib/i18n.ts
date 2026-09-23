'use client';

/**
 * One language rule, resolved in one module.
 *
 * The rule: **an explicit choice wins; otherwise the browser decides.** This app shipped
 * English-only, which handed a Japanese operator an entirely English instrument — hub verbs, the
 * unconfirmed-address-space warning, the read-only claim — with no way out. A safety notice
 * nobody can read is not a safety notice.
 *
 * Everything user-visible goes through `t` so that cannot recur. `Catalog` is a shared shape, so a
 * key added to one language and forgotten in the other is a compile error rather than an
 * `undefined` on screen.
 *
 * Uppercase control shorthand is NOT translated — READ, SHARE, PRACTICE are one form in both
 * languages, the same rule the Tuner follows. What gets translated is prose: the reasons, the
 * warnings, the descriptions of what a control will do.
 */

import { useSyncExternalStore } from 'react';

export type Lang = 'ja' | 'en';

const STORAGE_KEY = 'smg2-drivelogic-lang';

/** The shape both catalogs must satisfy. */
export interface Catalog {
    // Chrome

    // Link state, shown beside the LED

    // Hub faces. Verbs stay short; they sit inside a 72px ring.

    // Hub notices
    noticeProbing: string;
    noticeReadingStart: string;
    noticeReadPlan: (bytes: string) => string;
    noticeUnconfirmed: string;
    noticeProbeUnknown: string;
    noticeShare: string;
    noticeShared: (kib: string) => string;
    noticeSending: string;
    noticeVerified: string;
    ignitionOn: string;

    // Sections

    // Fields

    // Buttons

    // Values / badges
    vNotEstablished: string;
    vUnconfirmed: string;
    vConfirmed: string;
    vRereadMatch: string;
    vNothingLoaded: string;
    vNoneAvailable: string;

    // Prose the operator needs in order to decide what to do next
    zbNote: string;
    manualNote: string;
    openImageNote: (bytes: string) => string;
    practiceNote: string;
    noChecksumNote: string;
    logNote: string;
    lastFailure: (kind: string, message: string) => string;
    coverageNote: string;
    /** The route sentence. Lives here rather than in the transport package because it is prose,
     *  and it is the sentence someone reads when the cable did not appear. */
    routeSerial: string;
    routeUsbAndroid: string;
    routeUsb: string;
    routeNoneAndroid: string;
    routeNone: string;
    routeForced: (kind: string) => string;
    connectionNote: string;
    phase: (p: string) => string;
    ready: (route: string) => string;
    nothingLoaded: string;

    // The CODE tab. Prose only — the control shorthand lives in `chrome.ts`.
    /** How far the erased sector reaches past the calibration body, in bytes. */
    eraseCollateral: (below: number, above: number) => string;
    /** Opening paragraph of the flash preflight window. */
    flashIntro: string;
    /** Under the SESSIONS heading. */
    sessionsNote: string;
    /** The record survived but its bytes did not. */
    sessionBytesGone: string;
    /** Nothing has been read or opened yet. */
    noSessionsYet: string;
    /** Deleting the last session that holds these bytes. Names what goes with it. */
    confirmDeleteSession: (label: string, kib: number) => string;
    /** The search box in the function tree. */
    searchCode: string;
    /** No function matched the query. */
    noMatches: string;
    /** Nothing selected yet. */
    pickFunction: string;
    /** A run of bytes between two decoded instructions that no path reached. */
    notReached: (bytes: number) => string;
    /** Why the CODE tab is empty for a calibration-window read. */
    codeNeedsFullImage: string;
    /** How the sweep did, in one sentence, under the function list. */
    sweepSummary: (funcs: number, insns: number, percent: string) => string;
    /** Under a calibration item: which functions touch it, and how firm the attribution is. */
    readersInferred: string;
    /** Shown when a definition item has no reader in the swept code. */
    noReaderExplain: string;
    /**
     * The two scopes, each carrying what it costs.
     *
     * The cost is on the CHIP, not only in the notice, because the notice slot is one truncated
     * line and the unconfirmed-address-space warning has a better claim on it. Putting the minutes
     * where the choice is made also states them while choosing rather than after choosing.
     *
     * The figures are scaled from a measured read, not from the baud rate: 24,576 B took 48.6 s
     * over 205 telegrams on a real car, which is 1.98 ms/byte end to end. 524,288 B at that rate
     * is 1,036 s. See docs/first-real-extraction.md.
     */
    verify: string;
    noticeReadFull: (min: string) => string;
    noticeReadFullVerify: (min: string) => string;
    partialKept: (bytes: string) => string;
    shareBusy: string;
    shareDone: (kib: string) => string;
    sharePractice: string;
    shareIdle: string;
    defErrors: (n: number) => string;
    diagSent: (kib: string, id: string) => string;
    diagCopied: (kib: string) => string;
    diagRefused: string;
    crcNote: (stored: string, computed: string) => string;
    crcOkNote: (stored: string, bytes: string) => string;
    clampedToField: string;
    editsRestored: (n: string) => string;
    referenceUnavailable: string;
    shiftBandAria: string;
    hysteresisViolated: string;
    ghostIs: (ref: string) => string;
    formShiftUnavailable: string;
    covWindowMapNote: (bytes: string) => string;
    covNoGaps: string;
    covEmptyNote: (names: string, n: number) => string;
    switchLanguage: string;
    lFindings: (n: number, kind: 'errors' | 'warnings' | 'notes') => string;
    phZbNumber: string;
    undocumentedBitsNote: string;
    addedByCatalog: string;
    dropHint: string;
    offlineBuildNote: string;
    noItemsMatch: string;
    pickAnItem: string;
    // The calibration workbench
    noValuesForItem: string;
    axesDiffer: string;
    viewSubjectHint: string;
    viewDeltaHint: string;
    viewReferenceHint: string;
    listTitle: string;
    sameVariant: string;
    copyRefHint: string;
    revertHint: string;
    signHint: string;
    addHint: string;
    scaleHint: string;
    clearCell: string;
    diffUnavailable: string;
    diffEmpty: string;
    diffHint: string;
    catalogNoteProvenance: string;
    updateAvailableHint: string;
    reloadHint: string;
    reloadBusy: string;
    rawNote: (bytes: string) => string;
    rawBody: string;

    // SYNC and CLOUD — the preview build only
    /** Hub notice after a read, on a build with no SYNC: what the next act is. */
    noticeExport: string;
    syncExpired: string;
    syncTooLarge: string;
    syncOffline: string;
    syncFailed: (why: string) => string;
    diagQueued: string;
    cloudNote: (account: string | null) => string;
    cloudExpired: string;
    cloudEmpty: string;
    cloudUnavailable: string;
    cloudRecordsNote: (pending: number) => string;
    confirmDeleteCloud: (name: string) => string;
    confirmDeleteRecord: string;
    restoreReplacesEdits: string;
    restored: (cells: number, skipped: number) => string;
    restoreCorrupt: string;
    restoreFailed: string;
    reauthUnsaved: string;
    privacyHint: string;
}

const EN: Catalog = {



    noticeProbing: 'Reading the identity anchors at each candidate segment and base.',
    noticeReadingStart: 'Starting the first pass.',
    noticeReadPlan: b => `${b} bytes, read twice and compared. About a minute at 9600.`,
    noticeUnconfirmed:
        'Address space UNCONFIRMED — reading is safe, then check the decoded values look ' +
        'physically possible.',
    noticeProbeUnknown:
        'Which segment and base holds the calibration is not known yet. Reads only.',
    noticeShare: 'Saves this session to your account: the image, how it was read, and your edits.',
    noticeShared: k => `Saved ${k} KiB to your account. SYNC again after editing to update it.`,
    noticeSending: 'Compressing the image and the telegram trace.',
    noticeVerified: 'Both passes were byte-identical.',
    ignitionOn: 'Ignition on, engine stopped.',




    vNotEstablished: 'not established',
    vUnconfirmed: 'unconfirmed',
    vConfirmed: 'confirmed',
    vRereadMatch: 're-read match',
    vNothingLoaded: 'No image loaded.',
    vNoneAvailable: 'none available',

    zbNote:
        'What this SMG II reports as its BMW assembly number — from INPA, a previous reading, or ' +
        'the label. The probe can only CONFIRM an address space by finding this string at an ' +
        'identity anchor; without it the read still goes ahead, marked unconfirmed.',
    manualNote:
        'Only needed when the probe finds nothing. Segment and base as hex. The candidates are ' +
        'guesses; this ECU may decode somewhere nobody has listed.',
    openImageNote: b =>
        `A ${b}-byte calibration window or a 524,288-byte full flash. The definition is chosen ` +
        `from the length, not from a setting.`,
    practiceNote:
        'Practice: a simulated SMG II answering the real link. Everything it returns is invented ' +
        'and every artifact is labelled PRACTICE.',
    noChecksumNote:
        'The SMG2 stores a 16-bit checksum at 0x32080 and the algorithm behind it has not been ' +
        'identified yet. An export from this build is a readable, editable calibration — not a ' +
        'file that can be flashed. The filename says so.',
    logNote:
        'Sends the session log and the telegram trace. Works with no image loaded — a read that ' +
        'failed is exactly what this is for.',
    lastFailure: (kind, message) => `Last failure (${kind}): ${message}`,
    coverageNote: 'What the MS4X definition accounts for inside the calibration window.',
    routeSerial: 'Desktop: Web Serial. Pick the K+DCAN cable’s COM port when the chooser opens.',
    routeUsbAndroid:
        'Android: WebUSB + FTDI. Chrome for Android does expose Web Serial, but it lists only ' +
        'Bluetooth serial ports — a USB K+DCAN cable never appears there.',
    routeUsb: 'WebUSB + FTDI.',
    routeNoneAndroid: 'This Android browser has no WebUSB. Chrome for Android is required.',
    routeNone:
        'This browser reaches neither Web Serial nor WebUSB — iOS supports neither. ' +
        'Use desktop Chrome/Edge, or Chrome for Android.',
    routeForced: k => `Route forced to ${k} by ?transport.`,
    connectionNote: 'DS2 address 0x32, 9600 8E1 over K-line. This build can only read.',
    phase: p => ({ disconnected: 'disconnected', connecting: 'connecting', connected: 'connected',
        probing: 'probing', reading: 'reading' }[p] ?? p),
    ready: r => `${r} (ready)`,
    nothingLoaded: 'Nothing loaded.',
    eraseCollateral: (below, above) =>
        `The erase clears a whole flash sector, not just the edited bytes: ${below.toLocaleString()} `
        + `bytes below the calibration body and ${above.toLocaleString()} above it go with it. Both `
        + `are in the full image you read, so both can be written back.`,
    flashIntro: 'Everything a write depends on is decided before the first telegram. These are '
        + 'the checks, run against the workspace in hand. This build has no write path: what '
        + 'follows is how close one would be, and what is in the way.',
    sessionsNote: 'Every image read or opened here is kept, with its edits. Opening one loads it back.',
    sessionBytesGone: 'That session’s bytes are no longer in storage. The record is kept; the image is not.',
    noSessionsYet: 'Nothing read or opened yet. A read from the car, or a file, is kept here.',
    confirmDeleteSession: (label, kib) =>
        `Delete ${label}? Its ${kib} KiB of bytes and any edits attached to them go too. This cannot be undone.`,
    searchCode: 'Search functions and the calibration they touch',
    noMatches: 'No function matches.',
    pickFunction: 'Pick a function.',
    notReached: bytes => `${bytes.toLocaleString()} bytes not reached`,
    codeNeedsFullImage: 'The calibration window holds no instructions. Read the full 512 KiB image '
        + 'to disassemble the program.',
    sweepSummary: (funcs, insns, percent) =>
        `${funcs.toLocaleString()} functions, ${insns.toLocaleString()} instructions, ${percent}% of the code regions reached.`,
    readersInferred: 'The page register was inferred from the documented reset value, not watched '
        + 'being set. Treat it as strong evidence, not proof.',
    noReaderExplain: 'No function the sweep reached refers to this address. It may be read through '
        + 'a computed jump the sweep does not follow, or not read at all.',
    verify: 'Verify (2 passes)',
    noticeReadFull: m => `524,288 bytes, single pass, NOT verified. About ${m} minutes at 9600.`,
    noticeReadFullVerify: m => `524,288 bytes, read twice and compared. About ${m} minutes at 9600.`,
    partialKept: b => `The read failed but ${b} bytes arrived and were kept. Marked PARTIAL.`,
    shareBusy: 'Compressing and uploading…',
    shareDone: k => `Uploaded ${k} KiB. Pull it with \`npm run pull\`.`,
    sharePractice:
        'Sharing a practice reading is fine — the row is flagged PRACTICE and hidden from the '
        + 'default listing.',
    shareIdle: 'Sends the calibration and its provenance to D1 for analysis.',
    defErrors: n => `${n} definition error(s) — see Device. Editing is still possible, but the `
        + `flagged items overlap each other's bytes.`,
    diagSent: (k, id) => `Sent ${k} KiB as ${id}.`,
    diagCopied: k => `Copied ${k} KiB to the clipboard.`,
    diagRefused: 'The browser refused clipboard access. Use Send, or select the log text.',
    crcNote: (s, c) =>
        `Calibration CRC-16 is ${s}; these bytes compute ${c}. EXPORT rewrites it. `
        + 'Reflected 0xA001, seeded 0x7878, over 0x320E0-0x378BF.',
    crcOkNote: (s, b) =>
        `Calibration CRC-16 ${s} matches over ${b} protected bytes (0x320E0-0x378BF). `
        + 'Self-consistent — not a claim that it can be flashed.',
    clampedToField: 'Clamped to what the field can hold.',
    editsRestored: n => `${n} edited item(s) restored from this browser.`,
    referenceUnavailable: 'That factory calibration could not be loaded, so nothing was copied.',
    shiftBandAria: 'Upshift and downshift speeds against throttle',
    hysteresisViolated:
        'Downshift meets or exceeds upshift in the columns marked red. At a steady speed there '
        + 'the box would upshift, immediately hit the downshift threshold, and hunt between two '
        + 'gears. Raise UP or lower DOWN until the band reopens.',
    ghostIs: ref => `The dashed lines are ${ref}.`,
    formShiftUnavailable: 'Only for the AUTO tables, which hold an upshift and a downshift row per gear.',
    covWindowMapNote: b =>
        `Lit is defined by the definition; dark is bytes nothing names. Each column is ${b} bytes.`,
    covNoGaps: 'No run of 512 bytes or more is unmapped.',
    covEmptyNote: (names, n) =>
        `${names}. The definition names ${n === 1 ? 'this category' : 'these categories'} and then `
        + `defines nothing in ${n === 1 ? 'it' : 'them'} — those tables have not been located. `
        + `Nothing you can do here fills them; they need to be found in the bytes first.`,
    switchLanguage: 'Switch to Japanese',
    lFindings: (n, kind) => `${n} ${kind}`,
    phZbNumber: 'e.g. 7843260',
    undocumentedBitsNote:
        'They read 1 in this car and no source says what they do. Changing one has no predicted '
        + 'effect and no way to tell whether it worked, so a difference in the car afterwards '
        + 'could not be attributed to it. They are shown because rendering only the documented '
        + 'bits would imply the rest are zero.',
    addedByCatalog: 'Added by this project, not by the community definition. TunerPro will not show it.',
    dropHint: 'Drop a .bin here, or click to choose one.',
    offlineBuildNote: 'The browser reports no network, so every file is being served from the cache and this build cannot change — a redeploy will not reach this tab until it is online again and reloaded.',
    noItemsMatch: 'Nothing matches. Clear the search or the category to see the rest.',
    pickAnItem: 'Pick a parameter from the list to read and edit it.',
    noValuesForItem: 'This item has no values in the loaded image.',
    axesDiffer: 'The two images have different axis breakpoints; cells are compared by position.',
    viewSubjectHint: 'Show SUBJECT values. Editing is offered only here.',
    viewDeltaHint: 'Show SUBJECT − REFERENCE, the difference itself.',
    viewReferenceHint: 'Show the REFERENCE own values. Not editable.',
    listTitle: 'Open the list of items that differ.',
    sameVariant: 'Both selectors name the same bytes — pick another REFERENCE to see a difference.',
    copyRefHint: 'Replace every cell of this item with the REFERENCE value.',
    revertHint: 'Drop this item’s edits and go back to the values as loaded.',
    signHint: 'Flip the sign — a minus subtracts, and scales down.',
    addHint: 'Add this to every cell on screen (subtract, with the sign set to minus).',
    scaleHint: 'Multiply every cell on screen by this.',
    clearCell: 'Clear the selection and go back to editing the whole view.',
    diffUnavailable: 'Nothing to compare against — pick another REFERENCE.',
    diffEmpty: 'Nothing differs.',
    diffHint: 'Click a row to open that parameter.',
    catalogNoteProvenance: 'Established by this project against the real dump, not stated by the vendor definition.',
    updateAvailableHint: 'A newer build is on the server — reload to take it.',
    reloadHint: 'Reload the app.',
    reloadBusy: 'The link is up or there are unsaved edits. Reload anyway?',
    rawNote: b => `${b} bytes. Neither MS4X definition is written for this length.`,
    rawBody: 'These bytes came off the ECU, but no definition describes an image of this length, '
        + 'so nothing here can be decoded — applying one anyway would put every address somewhere '
        + 'it was not meant to point, and the numbers would look plausible. Export it: a truncated '
        + 'dump is still the program area, which is what the disassembly needs.',

    noticeExport: 'EXPORT writes the edited .bin with its checksum corrected, and its manifest.',
    syncExpired:
        'The preview sign-in has lapsed. The session is safe on this device — SIGN IN is under '
        + 'STARTUP › CLOUD, once the cable is disconnected.',
    syncTooLarge: 'Too large to save: one row holds at most 1.9 MB. EXPORT the .bin instead.',
    syncOffline: 'No network. The session is safe on this device; SYNC again when online.',
    syncFailed: why => `Not saved (${why}). The session is safe on this device.`,
    diagQueued: 'Could not send now. It is kept, and goes with the next record that does.',
    cloudNote: account => (account
        ? `Saved to account ${account}. Only that account can see these.`
        : 'Saved to your preview account. Only you can see these.'),
    cloudExpired:
        'The preview sign-in has lapsed. Everything on this device is still here. SIGN IN goes '
        + 'through m3 and comes back to this page; it is offered while the cable is disconnected.',
    cloudEmpty: 'Nothing saved yet. SYNC on the hub saves the session in hand.',
    cloudUnavailable: 'The list could not be read — offline, or the server did not answer.',
    cloudRecordsNote: pending => 'Filed automatically after every read and every failure, so a '
        + 'failure can be looked into without anyone having to press anything.'
        + (pending ? ` ${pending} waiting to be sent.` : ''),
    confirmDeleteCloud: name => `Delete the cloud copy of ${name}? A copy on this device is not affected.`,
    confirmDeleteRecord: 'Delete this record from the cloud?',
    restoreReplacesEdits:
        'This device already has edits for this image. Replace them with the edits in the cloud copy?',
    restored: (cells, skipped) => `Restored from the cloud${cells ? ` with ${cells} edited cell(s)` : ''}.`
        + (skipped ? ` ${skipped} cell(s) did not match this image and were left out.` : ''),
    restoreCorrupt: 'The cloud copy does not hash to its own SHA-256, so it was not restored.',
    restoreFailed: 'The cloud copy could not be read. Nothing on this device changed.',
    reauthUnsaved:
        'Signing in again leaves this page for m3 and comes back. Your edits are kept on this '
        + 'device. Go now?',
    privacyHint: 'Privacy policy — what this preview sends, and why',
};

const JA: Catalog = {



    noticeProbing: '候補のセグメントとベースごとに、識別アンカーを読んでいます。',
    noticeReadingStart: '1 パス目を開始します。',
    noticeReadPlan: b => `${b} バイトを 2 回読んで照合します。9600 で約 1 分。`,
    noticeUnconfirmed:
        'アドレス空間は未確認です。読み出し自体は安全なので、読んだあとに復号値が' +
        '物理的にあり得るかを確認してください。',
    noticeProbeUnknown:
        '較正がどのセグメント／ベースにあるかは未確定です。読み出しのみ行います。',
    noticeShare: 'このセッション（イメージ、読み取りの記録、編集）をあなたのアカウントに保存します。',
    noticeShared: k => `${k} KiB をアカウントに保存しました。編集したら、もう一度 SYNC で更新できます。`,
    noticeSending: 'イメージとテレグラムトレースを圧縮しています。',
    noticeVerified: '2 パスがバイト単位で一致しました。',
    ignitionOn: 'イグニッション ON・エンジン停止。',




    vNotEstablished: '未確定',
    vUnconfirmed: '未確認',
    vConfirmed: '確認済み',
    vRereadMatch: '再読取が一致',
    vNothingLoaded: 'イメージが読み込まれていません。',
    vNoneAvailable: '利用可能な経路なし',

    zbNote:
        'この SMG II が名乗る BMW 組立番号（INPA、過去の読み取り、またはラベルから）。' +
        '探索がアドレス空間を「確認」できるのは、この文字列を識別アンカーで見つけたときだけです。' +
        '無くても読み出しは実行され、未確認として記録されます。',
    manualNote:
        '探索が何も見つけられなかったときにだけ必要です。セグメントとベースを 16 進で。' +
        '候補は推測なので、この ECU が誰も挙げていない場所でデコードしている可能性があります。',
    openImageNote: b =>
        `${b} バイトの較正窓、または 524,288 バイトのフルフラッシュ。` +
        `定義ファイルは設定ではなく長さから選ばれます。`,
    practiceNote:
        '練習モード: シミュレートされた SMG II が実際のリンクに応答します。' +
        '返ってくる値はすべて架空で、生成物には PRACTICE が付きます。',
    noChecksumNote:
        'SMG2 は 0x32080 に 16bit のチェックサムを持ちますが、その算法はまだ同定できていません。' +
        'このビルドの書き出しは「読めて編集できる較正データ」であって、' +
        '書き込めるファイルではありません。ファイル名にもそう入ります。',
    logNote:
        'セッションログとテレグラムトレースを送ります。イメージが無くても送れます — ' +
        '失敗した読み取りこそ、この機能の目的です。',
    lastFailure: (kind, message) => `直近の失敗 (${kind}): ${message}`,
    coverageNote: 'MS4X の定義が較正窓のうちどれだけを説明しているか。',
    routeSerial: 'デスクトップ: Web Serial。選択画面が出たら K+DCAN ケーブルの COM ポートを選んでください。',
    routeUsbAndroid:
        'Android: WebUSB + FTDI。Chrome for Android は Web Serial を持っていますが、' +
        '列挙されるのは Bluetooth のシリアルポートだけで、USB の K+DCAN は決して出てきません。',
    routeUsb: 'WebUSB + FTDI。',
    routeNoneAndroid: 'この Android ブラウザには WebUSB がありません。Chrome for Android が必要です。',
    routeNone:
        'このブラウザは Web Serial にも WebUSB にも届きません（iOS はどちらも非対応）。' +
        'デスクトップの Chrome/Edge、または Chrome for Android を使ってください。',
    routeForced: k => `?transport により経路を ${k} に固定しています。`,
    connectionNote: 'DS2 アドレス 0x32、K-line 9600 8E1。このビルドは読み出しのみ行います。',
    phase: p => ({ disconnected: '未接続', connecting: '接続中', connected: '接続済み',
        probing: '探索中', reading: '読取中' }[p] ?? p),
    ready: r => `${r}（準備完了）`,
    nothingLoaded: '読み込まれていません。',
    eraseCollateral: (below, above) =>
        `消去はフラッシュのセクタ単位です。編集したバイトだけではなく、較正本体の手前 `
        + `${below.toLocaleString()} バイトと後ろ ${above.toLocaleString()} バイトも一緒に消えます。`
        + `どちらも読み込んだフルイメージに入っているので、書き戻せます。`,
    flashIntro: '書き込みの成否は最初のテレグラムを出す前に決まります。以下は今のワークスペースに'
        + '対して実際に走らせた検査です。このビルドに書き込み経路はありません。ここに出ているのは'
        + '「あとどれだけで書けるか」と「何が止めているか」です。',
    sessionsNote: '読み込んだイメージは編集ごとすべて残ります。選ぶとその状態に戻ります。',
    sessionBytesGone: 'このセッションのバイト列はストレージに残っていません。記録は残っていますが、イメージはありません。',
    noSessionsYet: 'まだ何も読み込んでいません。車から読んだイメージも、開いたファイルもここに残ります。',
    confirmDeleteSession: (label, kib) =>
        `${label} を削除しますか？ ${kib} KiB のバイト列と、それに紐づく編集も一緒に消えます。元に戻せません。`,
    searchCode: '関数名・参照している較正項目で検索',
    noMatches: '該当する関数はありません。',
    pickFunction: '関数を選んでください。',
    notReached: bytes => `到達しなかった ${bytes.toLocaleString()} バイト`,
    codeNeedsFullImage: '較正窓には命令が 1 バイトも入っていません。逆アセンブルするには 512 KiB '
        + 'のフルイメージを読み込んでください。',
    sweepSummary: (funcs, insns, percent) =>
        `関数 ${funcs.toLocaleString()} 個・命令 ${insns.toLocaleString()} 個。コード領域の ${percent}% に到達しました。`,
    readersInferred: 'ページレジスタは初期化時の既定値からの推定で、設定される瞬間を追跡したものでは'
        + 'ありません。強い根拠ではありますが、証明ではありません。',
    noReaderExplain: 'この番地を参照する関数は、掃引が到達した範囲には見つかりませんでした。'
        + '間接ジャンプ経由で読まれているか、実際に読まれていないかのどちらかです。',
    verify: '検証（2 パス）',
    noticeReadFull: m => `524,288 バイトを 1 パスで読みます（未検証）。9600 で約 ${m} 分。`,
    noticeReadFullVerify: m => `524,288 バイトを 2 回読んで照合します。9600 で約 ${m} 分。`,
    partialKept: b => `読み取りは失敗しましたが、届いた ${b} バイトを保持しました（PARTIAL）。`,
    shareBusy: '圧縮してアップロード中…',
    shareDone: k => `${k} KiB を送信しました。\`npm run pull\` で取り出せます。`,
    sharePractice:
        '練習データの送信は問題ありません。行には PRACTICE が付き、既定の一覧からは除外されます。',
    shareIdle: '較正データとその来歴を D1 に送り、解析に回します。',
    defErrors: n => `定義エラー ${n} 件 — デバイス画面を参照。編集は可能ですが、`
        + `該当項目どうしがバイトを取り合っています。`,
    diagSent: (k, id) => `${k} KiB を ${id} として送信しました。`,
    diagCopied: k => `${k} KiB をクリップボードにコピーしました。`,
    diagRefused: 'ブラウザがクリップボードを拒否しました。送信を使うか、ログを選択してコピーしてください。',
    crcNote: (s, c) =>
        `較正 CRC-16 の格納値は ${s}、このバイト列の計算値は ${c}。EXPORT で書き直します。`
        + '反転 0xA001・seed 0x7878・範囲 0x320E0-0x378BF。',
    crcOkNote: (s, b) =>
        `較正 CRC-16 ${s} が保護範囲 ${b} バイト（0x320E0-0x378BF）で一致。`
        + '自己整合しているという意味であって、書き込めるという意味ではありません。',
    clampedToField: 'フィールドが保持できる範囲に丸めました。',
    editsRestored: n => `編集済み ${n} 項目をこのブラウザから復元しました。`,
    referenceUnavailable: 'その工場較正を読み込めなかったため、何もコピーしていません。',
    shiftBandAria: 'スロットルに対するアップ／ダウンシフト速度',
    hysteresisViolated:
        '赤い列でダウンシフト点がアップシフト点以上になっています。その速度で一定走行すると、'
        + 'アップした直後にダウンの条件を満たして 2 つのギアの間でハンチングします。'
        + '帯が開くまで UP を上げるか DOWN を下げてください。',
    ghostIs: ref => `破線は ${ref} です。`,
    formShiftUnavailable: 'ギアごとにアップ／ダウンの 2 行を持つ AUTO 系テーブルでのみ使えます。',
    covWindowMapNote: b =>
        `明るい部分が定義済み、暗い部分は何も名付けられていないバイトです。1 列 ${b} バイト。`,
    covNoGaps: '512 バイト以上の未定義領域はありません。',
    covEmptyNote: (names, n) =>
        `${names}。定義はこの${n === 1 ? 'カテゴリ' : 'カテゴリ群'}を名指ししていますが、`
        + `中身を 1 つも定義していません —— そのテーブルはまだ見つかっていません。`
        + `ここで埋められるものではなく、まずバイト列の中から見つける必要があります。`,
    switchLanguage: 'English に切り替え',
    lFindings: (n, kind) => ({ errors: `エラー ${n}`, warnings: `警告 ${n}`, notes: `注記 ${n}` }[kind]),
    phZbNumber: '例: 7843260',
    undocumentedBitsNote:
        'この車では 1 を読みますが、何をするかを述べた資料がありません。変更しても予測できる効果が無く、'
        + '効いたかどうかを確かめる手段もないため、あとで車が変わってもそれに帰属できません。'
        + '文書化された分だけを描くと残りがゼロだと言っていることになるので、全ビットを出しています。',
    addedByCatalog: 'コミュニティ定義には無く、本プロジェクトが追加した項目です。TunerPro には表示されません。',
    dropHint: '.bin をここにドロップ、またはクリックして選択します。',
    offlineBuildNote: 'ブラウザがネットワーク無しと報告しています。すべてキャッシュから配信されているため、このビルドは変わりません。再デプロイしても、オンラインに戻して読み込み直すまでこのタブには届きません。',
    noItemsMatch: '該当がありません。検索かカテゴリを解除すると残りが出ます。',
    pickAnItem: '一覧からパラメータを選ぶと、読み取りと編集ができます。',
    noValuesForItem: '読み込んだイメージにこの項目の値がありません。',
    axesDiffer: '2 つのイメージで軸の区切り点が異なります。セルは位置で比較しています。',
    viewSubjectHint: 'SUBJECT の実値を表示します。編集できるのはこの表示のときだけです。',
    viewDeltaHint: 'SUBJECT − REFERENCE の差そのものを表示します。',
    viewReferenceHint: 'REFERENCE 側の実値を表示します。編集はできません。',
    listTitle: '差分のある項目の一覧を開きます。',
    sameVariant: '比較対象が同じです。REFERENCE を変えると差分が出ます。',
    copyRefHint: 'この項目の全セルを REFERENCE の値で置き換えます。',
    revertHint: 'この項目の編集を取り消し、読み込み時の値に戻します。',
    signHint: '符号を反転します。マイナスなら引き算・縮小になります。',
    addHint: '表示中のセルに、この値を足します（符号ぶん引きます）。',
    scaleHint: '表示中のセルに、この値を掛けます。',
    clearCell: '選択を解除して一括編集に戻ります。',
    diffUnavailable: '比較できません。REFERENCE に別のイメージを選んでください。',
    diffEmpty: '差分はありません。',
    diffHint: '行をクリックするとそのパラメータを開きます。',
    catalogNoteProvenance: 'ベンダー定義の記述ではなく、このプロジェクトが実ダンプに対して確かめたものです。',
    updateAvailableHint: 'サーバに新しいビルドがあります。再読み込みで取り込みます。',
    reloadHint: 'アプリを再読み込みします。',
    reloadBusy: 'リンクが接続中か、未保存の編集があります。それでも再読み込みしますか？',
    rawNote: b => `${b} バイト。この長さに対応する MS4X 定義はありません。`,
    rawBody: 'ECU から読み出したバイトですが、この長さのイメージを記述する定義が無いため、ここでは何も'
        + 'デコードできません。無理に当てれば全アドレスが本来と違う位置を指し、しかも値は'
        + 'それらしく見えてしまいます。EXPORT で保存してください。'
        + '途中で切れたダンプでもプログラム領域は入っており、逆アセンブルに必要なのはそこです。',

    noticeExport: 'EXPORT で、チェックサムを直した編集済みの .bin とマニフェストを書き出します。',
    syncExpired:
        'プレビュー版のログインの期限が切れました。セッションはこの端末に残っています。'
        + 'ケーブルを外すと、STARTUP › CLOUD に SIGN IN が出ます。',
    syncTooLarge: '大きすぎて保存できません（1 行 1.9 MB まで）。EXPORT で .bin を書き出してください。',
    syncOffline: 'ネットワークがありません。セッションはこの端末に残っています。オンラインで SYNC してください。',
    syncFailed: why => `保存できませんでした（${why}）。セッションはこの端末に残っています。`,
    diagQueued: '今は送れませんでした。保管しておき、次に送れたときに一緒に送ります。',
    cloudNote: account => (account
        ? `保存先 アカウント ${account}。このアカウントからだけ見えます。`
        : '保存先はプレビュー版のあなたのアカウントです。あなたからだけ見えます。'),
    cloudExpired:
        'プレビュー版のログインの期限が切れました。この端末のデータはすべて残っています。'
        + 'SIGN IN は m3 を経由してこのページに戻ります。ケーブルを外している間に表示されます。',
    cloudEmpty: 'まだ保存したものはありません。ハブの SYNC で、今のセッションを保存できます。',
    cloudUnavailable: '一覧を読めませんでした。オフラインか、サーバが応答していません。',
    cloudRecordsNote: pending => '読み取りのたび、失敗のたびに自動で記録します。'
        + 'ボタンを押さなくても、失敗の原因を後から調べられます。'
        + (pending ? `送信待ち ${pending} 件。` : ''),
    confirmDeleteCloud: name => `${name} のクラウドの控えを削除しますか？この端末にある控えは消えません。`,
    confirmDeleteRecord: 'この記録をクラウドから削除しますか？',
    restoreReplacesEdits: 'この端末には、このイメージの編集がすでにあります。クラウドの控えの編集で置き換えますか？',
    restored: (cells, skipped) => `クラウドから復元しました${cells ? `（編集 ${cells} セル）` : ''}。`
        + (skipped ? `このイメージと合わない ${skipped} セルは含めていません。` : ''),
    restoreCorrupt: 'クラウドの控えが自分の SHA-256 と一致しないため、復元しませんでした。',
    restoreFailed: 'クラウドの控えを読めませんでした。この端末では何も変わっていません。',
    reauthUnsaved: 'ログインし直すと、m3 を経由してこのページに戻ります。編集はこの端末に残ります。進みますか？',
    privacyHint: 'プライバシーポリシー — このプレビュー版が送るものと、その理由',
};

const STRINGS: Record<Lang, Catalog> = { ja: JA, en: EN };

/**
 * An explicit choice wins; otherwise the browser decides.
 *
 * Defaulting to one language unconditionally is what produced the violation this module fixes.
 */
function fromNavigator(): Lang {
    if (typeof navigator === 'undefined') return 'en';
    return navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function read(): Lang {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'en' || v === 'ja') return v;
    } catch {
        // Private mode. Fall through — the language is not a safety property, only the copy it
        // selects is.
    }
    return fromNavigator();
}

let current: Lang = 'en';
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') current = read();

export function getLang(): Lang {
    return current;
}

export function setLang(lang: Lang): void {
    if (lang === current) return;
    current = lang;
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        /* the switch still applies for this session */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    listeners.forEach(l => l());
}

function subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
}

/**
 * Re-renders on a language change.
 *
 * The server snapshot is the prerender default; `useSyncExternalStore` is precisely the API for a
 * value that differs between the server render and the client, so this does not produce the
 * hydration mismatch that reading `navigator` during render would.
 */
export function useLang(): { lang: Lang; t: Catalog; setLang: (l: Lang) => void } {
    const lang = useSyncExternalStore(subscribe, () => current, () => 'en' as Lang);
    return { lang, t: STRINGS[lang], setLang };
}
