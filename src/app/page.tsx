'use client';

/**
 * E46M3SMG2 /// MAPPING — the shell, laid out as the reference tuner lays out its CALIBRATION tab.
 *
 *     header (48)   [LED] E46M3SMG2 /// MAPPING · version · build | ZB · HW · SPACE  ⟷  tools
 *     ┌─ LEFT 61.8% ─────────────────────────────┬─ RIGHT 38.2% ───────────────────────────┐
 *     │ tab bar (44)  STARTUP · CALIBRATION       │ pane bar (44)  VISUALIZATION & INPUTS   │
 *     │ session bar (26)  source · BASE · CRC     │ visualization  (elastic) ValuePane      │
 *     │ content:  [ picture (flex-1) | TREE ]     │ inputs (38.2%) [DIFF n][INFO][SMG ●]    │
 *     └───────────────────────────────────────────┴─────────────────────────────────────────┘
 *     footer (52, <900px)   MAP · GRAPH · DASH   ///M MENU
 *
 * Below 900px the two columns share one grid cell and `narrowPane` decides which is on screen; the
 * other stays laid out and merely invisible, so nothing is mounted twice and nothing is unmounted
 * by a pane switch. GRAPH is a destination of its own only where the height forces the picture and
 * the controls to take turns (`useSplitGraph`).
 *
 * **There is no WRITE face, and there is no code behind one.** `@tsunagi/ds2-smg2` refuses at load
 * time to compose a write telegram.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ClipboardCopy,
    Crosshair,
    Download,
    FileCode,
    FileDown,
    Languages,
    Loader2,
    Plug,
    Radio,
    RefreshCw,
    SendHorizontal,
    Shield,
    Smartphone,
    Square,
    Trash2,
    Unplug,
    UploadCloud,
    WifiOff, Flame} from 'lucide-react';
import {
    coverageOf, decodeItem, readRun, runTargetOf, spansOf,
    type DecodedItem, type XdfItem,
} from '@tsunagi/xdf-engine';
import {
    CALIBRATION_WINDOW,
    correctChecksum,
    verifyChecksum,
    type ChecksumResult,
    type ReadProgress,
    type ReadScope,
    FULL_IMAGE_LENGTH,
} from '@tsunagi/ds2-smg2';

import { CoverageMap } from '@/components/CoverageMap';
import {
    Hub, HubCluster, HubNotice, HubStatusRow, HubSubActions, type HubConfig,
} from '@/components/Hub';
import { MMark } from '@/components/MMark';
import { MarkIcon } from '@/components/MarkIcon';
import { MobileMenu } from '@/components/MobileMenu';
import type { CompareOption } from '@/components/CompareBar';
import { CalibrationTree } from '@/components/calibration/CalibrationTree';
import { FunctionTree } from '@/components/code/FunctionTree';
import { CodeNetwork } from '@/components/code/CodeNetwork';
import { CodeListing } from '@/components/code/CodeListing';
import { CodeInfo } from '@/components/code/CodeInfo';
import { buildCodeModel } from '@/lib/code/model';
import { SessionList } from '@/components/SessionList';
import { CloudPanel } from '@/components/CloudPanel';
import { FlashDialog } from '@/components/FlashDialog';
import { PreviewNoticeDialog } from '@/components/PreviewNoticeDialog';
import { calibrationSector, type FlashPlan } from '@tsunagi/ds2-smg2-write';
import {
    deleteSession, listSessions, loadSessionBytes, recordSession, renameSession,
    type SessionRecord,
} from '@/lib/sessionStore';
import { ValuePane, type BulkOp } from '@/components/calibration/ValuePane';
import { ParamInfo } from '@/components/calibration/ParamInfo';
import { CalibrationDiffList } from '@/components/calibration/CalibrationDiffList';
import {
    Chip,
    DropZone,
    EmptyState,
    Field,
    LABEL,
    MicroLabel,
    Pane,
    Pill,
    SearchInput,
    Section,
    TextButton,
    Well,
    WORDMARK,
    Selector,
} from '@/components/ui';
import { C } from '@/lib/chrome';
import { useLang, type Catalog } from '@/lib/i18n';
import { usePwa } from '@/hooks/usePwa';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import { useSmg2Link } from '@/hooks/useSmg2Link';
import { useSplitGraph, useWideLayout } from '@/hooks/useWideLayout';
import {
    buildPayload,
    CHECKSUM_XDF_ADDRESS,
    fetchCloudSession,
    imageOf,
    readStoredChecksum,
    saveExtraction,
    type CloudSession,
    type CloudSessionFull,
} from '@/lib/sync';
import {
    recordDiagnostic, renderDiagnostic, sendDiagnostic, type CloudDiagnostic, type DiagnosticKind,
} from '@/lib/diagnostics';
import { editsFromShared, parseSharedEdits } from '@/lib/cloudRestore';
import { privacyUrl } from '@/lib/links';
import { reauthHref } from '@/lib/owner-sync';
import { confirmNotice, usePreviewNoticeOpen } from '@/lib/previewNotice';
import { usePreviewBuild } from '@/lib/variant';
import { useCloud } from '@/hooks/useCloud';
import {
    describeUnknownLength,
    loadDefinition,
    variantForLength,
    type LoadedDefinition,
} from '@/lib/definitions';
import { downloadBytes } from '@/lib/download';
import { clearEdits, loadEdits, saveEdits } from '@/lib/editStore';
import { buildManifest, downloadText } from '@/lib/manifest';
import {
    EMPTY_EDITS, applyEdits, currentRun, rebase, withBulk, withCell, withRunFrom, withoutItem,
} from '@/lib/edits';
import { quantise, rawLimits, whyNotWritable } from '@/lib/quantise';
import {
    BASE_REFERENCE, factoryDataAvailable, referenceImage, referencesFor, type Reference,
} from '@/lib/factory/reference';
import { diffItems, type CompareView, type GraphMode, type Variant } from '@/lib/calibration/compare';
import { shapeOf } from '@/lib/calibration/run';
import { readingNotice } from '@/lib/readingNotice';
import { APP_VERSION, BUILD_ID, CAPABILITIES } from '@/lib/version';
import {
    createWorkspace,
    describeOrigin,
    exportFileName,
    type ChecksumTag,
    isDirty,
    editedCellCount,
    zbFromImage,
    isPractice,
    sha256Hex,
    type ImageOrigin,
    type Workspace,
} from '@/lib/workspace';

type TabId = 'startup' | 'calibration' | 'code';

/** Only in the split viewport — narrow AND short — where the picture and the controls take turns.
 *  Keep these identical to `SPLIT` in useWideLayout.ts. */
const SPLIT_ONLY_HIDE = '[@media(max-width:899px)_and_(max-height:560px)]:hidden';
const SPLIT_ONLY_SHOW = 'hidden [@media(max-width:899px)_and_(max-height:560px)]:flex';
const SPLIT_ONLY_GROW = '[@media(max-width:899px)_and_(max-height:560px)]:flex-1';

/** The link LED's colours — the app's state language, reused verbatim from the status LED. */
const LED: Record<ReturnType<typeof useSmg2Link>['phase'], string> = {
    disconnected: 'bg-slate-600',
    connecting: 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(155,132,232,0.6)]',
    connected: 'bg-emerald-500 shadow-[0_0_8px_rgba(143,216,242,0.6)]',
    probing: 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(155,132,232,0.6)]',
    reading: 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(155,132,232,0.6)]',
};

/**
 * The route sentence, in the reader's language. `describeTransport` in the transport package
 * returns English only, because that package has no business owning copy.
 */
function routeSentence(a: { kind: string; android: boolean; forced: string | null }, t: Catalog): string {
    if (a.forced) return t.routeForced(a.forced);
    if (a.kind === 'web-usb-ftdi') return a.android ? t.routeUsbAndroid : t.routeUsb;
    if (a.kind === 'web-serial') return t.routeSerial;
    return a.android ? t.routeNoneAndroid : t.routeNone;
}

/** The hardware number the ECU states in its manufacturer data (`FEP 7843260 SIEMENS …`). */
function hardwareNumberOf(manufacturerData: string | null): string | null {
    if (!manufacturerData) return null;
    const ascii = manufacturerData.split(/\s+/)
        .map(h => parseInt(h, 16))
        .filter(n => Number.isFinite(n))
        .map(n => (n >= 0x20 && n < 0x7f ? String.fromCharCode(n) : ' '))
        .join('');
    return ascii.match(/\b(\d{7})\b/)?.[1] ?? null;
}

/** What the Share control needs to render, derived in one place so the label cannot lie. */
interface ShareControls {
    busy: boolean;
    uploaded: boolean;
    uploadedBytes: number;
    error: string | null;
    onShare: () => void;
}

export default function Home() {
    const { t, lang, setLang } = useLang();
    const link = useSmg2Link();
    // A full image is roughly eighteen minutes. On a phone the screen going off is the ordinary
    // way that read dies — the tab freezes, the USB transfer stalls, and the session is spent.
    useScreenWakeLock(link.phase === 'reading' || link.phase === 'probing');
    const wide = useWideLayout();
    const splitGraph = useSplitGraph();

    const [tab, setTab] = useState<TabId>('startup');
    /** CODE tab: which function is the subject, and which of its two pictures is showing. */
    const [codeFn, setCodeFn] = useState<number | null>(null);
    const [codeForm, setCodeForm] = useState<'network' | 'listing'>('network');
    const [codeBottomTab, setCodeBottomTab] = useState<'fn' | 'smg'>('fn');
    /** Every image this tool has held. Loaded once, then kept in step with what is recorded. */
    const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
    const [flashOpen, setFlashOpen] = useState(false);
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [definition, setDefinition] = useState<LoadedDefinition | null>(null);
    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    /**
     * The service worker never swaps builds while the cable is in use: no update check starts, and
     * UPDATE is not offered, until the link is back to disconnected.
     */
    const linkBusy = link.phase !== 'disconnected';
    const pwa = usePwa(linkBusy);
    const updateOffered = pwa.updated && !linkBusy;

    /**
     * The owner preview, or not. Everything SYNC — the hub face, SEND, the CLOUD list, the records
     * filed on their own, the status poll — is drawn and run only when this is true, and a
     * production build (no `app-variant`) makes no request to the gate or the API at all.
     */
    const preview = usePreviewBuild();
    /**
     * The preview's first-run notice — what it sends and why — until the owner confirms it on this
     * browser. While it is up the page behind it is `inert`, so nothing there can be pressed or
     * focused, and SYNC makes no request: not the status poll, not the outbox, not a record. The
     * cloud hook is off, and every request path asks `syncAllowed()` besides (previewNotice.ts).
     * Production has no notice; this is always false there.
     */
    const noticeOpen = usePreviewNoticeOpen();
    const cloud = useCloud(preview && !noticeOpen);
    /** The CLOUD row being restored or deleted. */
    const [cloudBusy, setCloudBusy] = useState<string | null>(null);

    /** Share state, keyed by the image hash so a different extraction cannot inherit a badge. */
    const [shared, setShared] = useState<Record<string, number>>({});
    const [sharing, setSharing] = useState(false);
    const [shareError, setShareError] = useState<string | null>(null);
    /** Diagnostic upload state — independent of `workspace`, because the run worth reporting most
     *  is the one that produced no image. */
    const [diagBusy, setDiagBusy] = useState(false);
    const [diagNote, setDiagNote] = useState<string | null>(null);
    /** The ZB number this car reports, typed by the operator. The app cannot know it. */
    const [zbNumber, setZbNumber] = useState('');
    /** What READ will take, and whether it verifies. */
    const [scope, setScope] = useState<ReadScope>('window');
    const [verifyFull, setVerifyFull] = useState(false);
    const verify = scope === 'window' ? true : verifyFull;

    // ── The calibration workbench's own state ────────────────────────────────────────────────
    const [calSubject, setCalSubject] = useState<Variant>('tuned');
    const [calReference, setCalReference] = useState<Variant>('base');
    const [calView, setCalView] = useState<CompareView>('subject');
    const [graphMode, setGraphMode] = useState<GraphMode>('map');
    const [sectionAxis, setSectionAxis] = useState<'x' | 'y'>('x');
    const [gearPair, setGearPair] = useState(0);
    const [treeCollapsed, setTreeCollapsed] = useState(false);
    /** The inputs pane's bottom tabs on CALIBRATION: which differ, what this is, the hub. */
    const [calBottomTab, setCalBottomTab] = useState<'list' | 'info' | 'smg'>('smg');
    /** Which pane a narrow window shows. */
    const [narrowPane, setNarrowPane] = useState<'map' | 'graph' | 'dash'>('map');
    const [menuOpen, setMenuOpen] = useState(false);

    // GRAPH exists only where the height forces the split; elsewhere DASH already holds it.
    useEffect(() => {
        if (narrowPane === 'graph' && !splitGraph) setNarrowPane('dash');
    }, [narrowPane, splitGraph]);

    // The definition follows the image, never a setting.
    useEffect(() => {
        if (!workspace) { setDefinition(null); return; }
        let cancelled = false;
        if (!workspace.variant) { setDefinition(null); return; }
        loadDefinition(workspace.variant)
            .then(loaded => { if (!cancelled) setDefinition(loaded); })
            .catch(error => { if (!cancelled) setNotice((error as Error).message); });
        return () => { cancelled = true; };
    }, [workspace]);

    useEffect(() => { void listSessions().then(setSessions); }, []);

    const adoptImage = useCallback(async (
        bytes: Uint8Array,
        origin: Parameters<typeof createWorkspace>[2],
    ) => {
        // A length no definition is written for is not a reason to drop the bytes — it is a
        // reason not to decode them. They are held as a raw capture, which EXPORT and SHARE can
        // both act on.
        const variant = variantForLength(bytes.length);
        const next = await createWorkspace(bytes, variant, origin);
        setWorkspace(next);
        // Recorded BEFORE anything can go wrong with decoding. An eighteen-minute read must
        // survive a definition that does not fit the length it came back as.
        void recordSession(
            {
                sha256: next.sha256,
                byteLength: bytes.length,
                origin,
                variant,
                zb: origin.kind === 'vehicle' ? origin.identity?.zbNumber ?? null : null,
                checksumOk: null,
                practice: origin.kind === 'practice',
            },
            bytes,
        ).then(() => listSessions().then(setSessions));
        setSelectedItem(null);
        setNotice(variant ? null : describeUnknownLength(bytes.length));
        // A read that produced something is a genuine phase change, so move to it — but only to a
        // pane that has something in it.
        setTab(variant ? 'calibration' : 'startup');
    }, []);

    const onRead = useCallback(async () => {
        const result = await link.read(scope, verify);
        if (!result) return;
        if (result.partial) setNotice(t.partialKept(result.bytes.length.toLocaleString()));
        await adoptImage(
            result.bytes,
            link.practice
                ? { kind: 'practice', read: result.read }
                : { kind: 'vehicle', addressSpace: link.addressSpace!, read: result.read, identity: null },
        );
    }, [adoptImage, link, scope, verify, t]);

    const onOpenFile = useCallback(async (file: File) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await adoptImage(bytes, { kind: 'file', fileName: file.name, lastModified: file.lastModified });
    }, [adoptImage]);

    /** Where the image sits in the ECU's address space; a raw capture cannot say and gets no CRC. */
    const imageBase = workspace?.variant === 'partial-24k' ? CALIBRATION_WINDOW.start : 0;

    /** The bytes an export would contain: the loaded image with the edit set applied. DERIVED. */
    const editedImage = useMemo(
        () => (workspace
            ? (definition
                ? applyEdits(definition.definition, workspace.original, workspace.edits, definition.definition.items)
                : workspace.original)
            : null),
        [workspace, definition],
    );

    const checksum = useMemo(
        () => (workspace?.variant && editedImage ? verifyChecksum(editedImage, 'calibration', imageBase) : null),
        [editedImage, workspace?.variant, imageBase],
    );

    const onExport = useCallback(() => {
        if (!workspace || !editedImage) return;
        // Recompute before writing the file: an edited calibration whose CRC still holds the old
        // value is a file that is knowingly wrong, and the tool knows how to make it right.
        const fixed = workspace.variant ? correctChecksum(editedImage, 'calibration', imageBase) : null;
        const bytes = fixed?.bytes ?? editedImage;
        const tag: ChecksumTag = fixed
            ? (verifyChecksum(bytes, 'calibration', imageBase)?.ok ? 'CRCOK' : 'CRCBAD')
            : 'NOCRC';
        const stamp = new Date();
        const name = exportFileName(workspace, stamp, tag);
        downloadBytes(bytes, name);
        // The manifest goes with it, always.
        if (definition) {
            downloadText(buildManifest({
                workspace,
                def: definition.definition,
                items: definition.definition.items,
                definitionFile: `${definition.file} + corrections ${definition.catalogVersion}`,
                addedIds: definition.added,
                appVersion: APP_VERSION,
                binFileName: name,
                checksum: fixed ? { before: fixed.before, after: fixed.after } : null,
                stamp,
            }), name.replace(/\.bin$/, '.txt'));
        }
    }, [workspace, editedImage, imageBase, definition]);

    const onShare = useCallback(async () => {
        if (!workspace || sharing) return;
        setSharing(true);
        setShareError(null);
        try {
            const checksumStored = definition
                ? readStoredChecksum(workspace.original, definition.definition.fileOffsetOf(CHECKSUM_XDF_ADDRESS))
                : null;
            const payload = await buildPayload(workspace, {
                // The local session's id: saving the same session again updates its row.
                id: sessions.find(s => s.sha256 === workspace.sha256)?.id ?? crypto.randomUUID(),
                label: null,
                checksumStored,
                zbNumber: zbNumber || null,
                manufacturerData: link.manufacturerData,
                logText: link.log.length ? link.log.join('\n') : null,
                verifiedReread: workspace.origin.kind === 'file' ? null : link.verifiedByReread,
                transport: workspace.origin.kind === 'file' ? 'file' : (link.transport ?? 'unknown'),
            });
            const result = await saveExtraction(payload);
            if (!result.ok) {
                if (result.expired) cloud.markExpired();
                setShareError(result.expired ? t.syncExpired
                    : result.tooLarge ? t.syncTooLarge
                    : result.notSent ? t.syncOffline
                    : t.syncFailed(result.error ?? 'unknown'));
                return;
            }
            setShared(s => ({ ...s, [workspace.sha256]: result.uploadedBytes }));
            void cloud.refresh();
        } catch (error) {
            setShareError(t.syncFailed((error as Error).message));
        } finally {
            setSharing(false);
        }
    }, [workspace, sharing, definition, link.manufacturerData, link.log, link.verifiedByReread, link.transport, zbNumber, sessions, cloud, t]);

    /** Everything a report needs, assembled from the live link state. */
    const buildDiagnostic = useCallback((kind: DiagnosticKind) => ({
        kind,
        ok: link.lastFailure === null,
        error: link.lastFailure?.message ?? null,
        route: link.transport,
        practice: link.practice,
        zbNumber: zbNumber || null,
        segment: link.addressSpace?.segment ?? null,
        baseAddress: link.addressSpace?.baseAddress ?? null,
        extractionSha: workspace?.sha256 ?? null,
        chunkSize: link.lastRead?.chunkSize ?? null,
        exchanges: link.lastRead?.exchanges ?? null,
        retries: link.lastRead?.retries ?? null,
        bytesDone: link.progress?.bytesDone ?? link.lastRead?.bytes.length ?? null,
        elapsedMs: link.lastRead?.elapsedMs ?? null,
        logLines: link.log,
        trace: link.traceSnapshot(),
    }), [link, workspace, zbNumber]);

    const onSendDiagnostic = useCallback(async () => {
        if (diagBusy) return;
        setDiagBusy(true);
        setDiagNote(null);
        try {
            const kind: DiagnosticKind = link.lastFailure?.kind ?? (link.lastRead ? 'read' : 'manual');
            const result = await sendDiagnostic(buildDiagnostic(kind));
            setDiagNote(result.ok
                ? t.diagSent((result.uploadedBytes / 1024).toFixed(1), result.id.slice(0, 8))
                : result.queued ? t.diagQueued : t.syncFailed(result.error ?? 'unknown'));
            if (result.ok) void cloud.refresh();
        } finally {
            setDiagBusy(false);
        }
    }, [diagBusy, link.lastFailure, link.lastRead, buildDiagnostic, t, cloud]);

    /**
     * Records file themselves: once after every read that finishes, and once after every connect,
     * probe or read that fails — the moment the link leaves a busy phase. Nobody presses SEND in a
     * garage with the engine off, and a failure is only worth recording at the moment it happens.
     *
     * Keyed on the phase TRANSITION rather than on `lastFailure` alone, so a failure is filed once
     * and a later success is not mistaken for it (`lastFailure` outlives the operation it describes).
     * A read the operator stopped files nothing: a stop is a decision, not a fault. Silent and
     * best-effort (`recordDiagnostic`): nothing here can fail the operation it describes.
     */
    const diagnosticOf = useRef(buildDiagnostic);
    diagnosticOf.current = buildDiagnostic;
    const phaseBefore = useRef(link.phase);
    const failureFiled = useRef<number | null>(null);
    const readFiled = useRef(link.lastRead);
    useEffect(() => {
        const was = phaseBefore.current;
        phaseBefore.current = link.phase;
        if (was === link.phase || (was !== 'connecting' && was !== 'probing' && was !== 'reading')) return;
        const failure = link.lastFailure && link.lastFailure.at !== failureFiled.current ? link.lastFailure : null;
        if (failure) failureFiled.current = failure.at;
        const read = was === 'reading' && link.lastRead !== readFiled.current ? link.lastRead : null;
        readFiled.current = link.lastRead;
        if (!preview || (!failure && !read)) return;
        const input = diagnosticOf.current(failure?.kind ?? 'read');
        void (async () => {
            // The image this read produced, by its own hash — the workspace is adopted after this
            // runs, so its hash would still be the previous image's.
            const extractionSha = !failure && read ? await sha256Hex(read.bytes).catch(() => null) : null;
            await recordDiagnostic({ ...input, ok: !failure, error: failure?.message ?? null, extractionSha });
            void cloud.refresh();
        })();
    }, [preview, link.phase, link.lastFailure, link.lastRead, cloud]);

    const onCopyDiagnostic = useCallback(async () => {
        const text = renderDiagnostic(buildDiagnostic(link.lastFailure?.kind ?? 'manual'));
        try {
            await navigator.clipboard.writeText(text);
            setDiagNote(t.diagCopied((text.length / 1024).toFixed(1)));
        } catch {
            setDiagNote(t.diagRefused);
        }
    }, [buildDiagnostic, link.lastFailure, t]);

    const share: ShareControls = {
        busy: sharing,
        uploaded: workspace ? workspace.sha256 in shared : false,
        uploadedBytes: workspace ? (shared[workspace.sha256] ?? 0) : 0,
        error: shareError,
        onShare: () => void onShare(),
    };

    const items = definition?.definition.items ?? [];
    const categories = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of items) for (const name of item.categories) {
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }, [items]);

    const selectedXdfItem = useMemo(
        () => items.find(i => i.uniqueId === selectedItem) ?? null,
        [items, selectedItem],
    );

    /**
     * The image, read as a program.
     *
     * Only for a full 512 KiB dump — `docs/vehicle-session.md` records that the 24 KiB
     * calibration window holds not one byte of instruction, so a sweep of it would be a sweep of
     * nothing dressed up as an empty result. The tab is disabled instead, with the reason on it.
     *
     * Deliberately built from `original`, not `edited`: this is a picture of the program in the
     * ECU, and the program is not what anyone is editing here. An edit to a shift table must not
     * appear to change the code that reads it.
     */
    const codeModel = useMemo(() => {
        if (!definition || !workspace) return null;
        if (workspace.original.length !== FULL_IMAGE_LENGTH) return null;
        return buildCodeModel(workspace.original, definition.definition);
    }, [definition, workspace]);

    const selectedFn = codeFn === null ? null : codeModel?.funcs.get(codeFn) ?? null;

    /** Functions that touch the selected calibration item — the INFO pane's "read by" row. */
    const readersOfSelected = useMemo(() => {
        if (!codeModel || !selectedItem) return null;
        return (codeModel.readersOf.get(selectedItem) ?? []).map(at => ({
            at,
            label: codeModel.funcs.get(at)?.label ?? `FN ${at.toString(16).toUpperCase()}`,
        }));
    }, [codeModel, selectedItem]);

    const coverage = useMemo(() => {
        if (!definition) return null;
        const length = workspace?.original.length ?? CALIBRATION_WINDOW.length;
        return coverageOf(definition.definition, { windowStart: 0, windowEnd: length });
    }, [definition, workspace]);

    const coveredRanges = useMemo(() => {
        if (!definition) return [];
        return definition.definition.items
            .flatMap(item => spansOf(definition.definition, item))
            .map(s => [s.start, s.end] as const);
    }, [definition]);

    const selectedRanges = useMemo(() => {
        if (!definition || !selectedXdfItem) return [];
        return spansOf(definition.definition, selectedXdfItem).map(s => [s.start, s.end] as const);
    }, [definition, selectedXdfItem]);

    // ── Restore, then persist. The ORDER is the whole point. ────────────────────────────────
    const restoredFor = useRef<string | null>(null);
    useEffect(() => {
        if (!workspace || !definition) return;
        const key = `${workspace.sha256}:${definition.variant}`;
        if (restoredFor.current === key) return;
        let cancelled = false;
        void loadEdits(workspace.sha256).then(entries => {
            if (cancelled) return;
            restoredFor.current = key;
            if (!entries?.length) return;
            const armed = rebase(
                new Map(entries.map(e => [e.uniqueId, e])),
                definition.definition, workspace.original, definition.definition.items);
            if (armed.size === 0) return;
            setWorkspace(current => (current && current.sha256 === workspace.sha256 && current.edits.size === 0
                ? { ...current, edits: armed }
                : current));
            setNotice(t.editsRestored(String(armed.size)));
        });
        return () => { cancelled = true; };
    }, [workspace, definition, t]);

    useEffect(() => {
        if (!workspace || !definition) return;
        if (restoredFor.current !== `${workspace.sha256}:${definition.variant}`) return;
        void saveEdits(workspace.sha256, workspace.edits);
    }, [workspace, definition]);

    // ── References: BASE always; the factory calibrations once their data is confirmed. ─────
    const [hasFactory, setHasFactory] = useState(false);
    useEffect(() => { void factoryDataAvailable().then(setHasFactory); }, []);
    const references = useMemo(() => (hasFactory ? referencesFor() : [BASE_REFERENCE]), [hasFactory]);

    /**
     * The factory images, fetched when a selector names one. Keyed by variant id; the loaded
     * image itself decides the overlay, so a new workspace drops the lot.
     */
    const [factoryImages, setFactoryImages] = useState<Record<string, Uint8Array>>({});
    useEffect(() => { setFactoryImages({}); }, [workspace?.sha256]);
    useEffect(() => {
        if (!workspace) return;
        let cancelled = false;
        for (const v of [calSubject, calReference]) {
            if (!v.startsWith('factory:') || factoryImages[v]) continue;
            const ref = references.find(r => r.id === v);
            if (!ref) continue;
            void referenceImage(ref, workspace.original, imageBase).then(bytes => {
                if (cancelled || !bytes) return;
                setFactoryImages(m => ({ ...m, [v]: bytes }));
            });
        }
        return () => { cancelled = true; };
    }, [workspace, calSubject, calReference, references, factoryImages, imageBase]);

    const imageFor = useCallback((v: Variant): Uint8Array | null => {
        if (!workspace) return null;
        if (v === 'tuned') return editedImage;
        if (v === 'base') return workspace.original;
        return factoryImages[v] ?? null;
    }, [workspace, editedImage, factoryImages]);

    const subjectImage = imageFor(calSubject);
    const referenceImg = calSubject === calReference ? null : imageFor(calReference);
    const comparing = calSubject !== calReference;

    const decodeFor = useCallback((image: Uint8Array | null): DecodedItem | null => {
        if (!definition || !image || !selectedXdfItem) return null;
        try { return decodeItem(definition.definition, image, selectedXdfItem); } catch { return null; }
    }, [definition, selectedXdfItem]);
    const subjectDecoded = useMemo(() => decodeFor(subjectImage), [decodeFor, subjectImage]);
    const referenceDecoded = useMemo(() => decodeFor(referenceImg), [decodeFor, referenceImg]);

    /** Cells the edit set changed vs BASE, by index — the reader's own input, marked. */
    const editedMask = useMemo(() => {
        if (!definition || !workspace || !editedImage || !selectedXdfItem || calSubject !== 'tuned') return null;
        try {
            const a = readRun(definition.definition, editedImage, selectedXdfItem);
            const b = readRun(definition.definition, workspace.original, selectedXdfItem);
            return a.map((v, i) => v !== b[i]);
        } catch { return null; }
    }, [definition, workspace, editedImage, selectedXdfItem, calSubject]);

    /** WHICH items differ between the two images the compare bar names. */
    const diffEntries = useMemo(() => {
        if (!definition || !comparing || !subjectImage || !referenceImg) return null;
        return diffItems(definition.definition, subjectImage, referenceImg, items);
    }, [definition, comparing, subjectImage, referenceImg, items]);

    const compareOptions: CompareOption[] = useMemo(() => [
        { value: 'tuned', label: C.vTuned },
        { value: 'base', label: BASE_REFERENCE.label },
        ...references.filter(r => r.id !== 'base').map(r => ({ value: r.id, label: r.label })),
    ], [references]);

    /** The loaded image's value for the selected item, for marking a changed bit. */
    const baseRawOfSelected = useMemo(() => {
        if (!definition || !workspace || !selectedXdfItem) return null;
        try { return readRun(definition.definition, workspace.original, selectedXdfItem)[0] ?? null; } catch { return null; }
    }, [definition, workspace, selectedXdfItem]);

    const editedIds = useMemo(() => new Set(workspace ? [...workspace.edits.keys()] : []), [workspace]);

    /** Why the selected item cannot be written, or null. Derived from the scaling and the address. */
    const lockedReason = useMemo(() => {
        if (!definition || !selectedXdfItem) return null;
        return whyNotWritable(selectedXdfItem, definition.definition);
    }, [definition, selectedXdfItem]);

    // ── Edits ────────────────────────────────────────────────────────────────────────────────
    const onEditCell = useCallback((index: number, physical: number) => {
        if (!definition || !workspace || !selectedXdfItem) return;
        const { cols } = shapeOf(selectedXdfItem);
        try {
            const { raw, clamped } = quantise(selectedXdfItem, physical);
            setWorkspace({
                ...workspace,
                edits: withCell(workspace.edits, definition.definition, workspace.original, selectedXdfItem,
                    Math.floor(index / cols), index % cols, raw),
            });
            setNotice(clamped ? t.clampedToField : null);
        } catch (error) {
            setNotice((error as Error).message);
        }
    }, [definition, workspace, selectedXdfItem, t]);

    /** A step in PHYSICAL units over the cells on screen, quantised per cell. */
    const onBulkOp = useCallback((op: BulkOp, indices?: readonly number[]) => {
        if (!definition || !workspace || !selectedXdfItem) return;
        try {
            const { rows, cols } = shapeOf(selectedXdfItem);
            const all = indices ?? [...Array(rows * cols).keys()];
            const { scaling } = runTargetOf(selectedXdfItem);
            const limits = rawLimits(selectedXdfItem);
            setWorkspace(w => (w
                ? {
                    ...w,
                    edits: withBulk(w.edits, definition.definition, w.original, selectedXdfItem, all, raw => {
                        const phys = scaling.toPhysical(raw);
                        const next = op.kind === 'add' ? phys + op.amount : phys * op.amount;
                        try {
                            return Math.min(limits.max, Math.max(limits.min, quantise(selectedXdfItem, next).raw));
                        } catch { return raw; }
                    }),
                }
                : w));
            setNotice(null);
        } catch (error) {
            setNotice((error as Error).message);
        }
    }, [definition, workspace, selectedXdfItem]);

    /** Replace one item's cells with the REFERENCE image's — for the item in hand or a named one. */
    const onCopyRefItem = useCallback((uniqueId: string) => {
        if (!definition || !workspace || !referenceImg) { setNotice(t.referenceUnavailable); return; }
        const item = items.find(i => i.uniqueId === uniqueId);
        if (!item) return;
        setWorkspace(w => (w ? { ...w, edits: withRunFrom(w.edits, definition.definition, w.original, referenceImg, item) } : w));
        setNotice(null);
    }, [definition, workspace, referenceImg, items, t]);
    const onCopyRef = useCallback(() => { if (selectedItem) onCopyRefItem(selectedItem); }, [selectedItem, onCopyRefItem]);

    const onToggleBit = useCallback((bit: number) => {
        if (!definition || !workspace || !selectedXdfItem) return;
        const current = currentRun(workspace.edits, definition.definition, workspace.original, selectedXdfItem)[0];
        setWorkspace(w => (w
            ? { ...w, edits: withCell(w.edits, definition.definition, w.original, selectedXdfItem, 0, 0, (current ^ (1 << bit)) >>> 0) }
            : w));
        setNotice(null);
    }, [definition, workspace, selectedXdfItem]);

    const onRevertItem = useCallback((uniqueId: string) => {
        setWorkspace(w => (w ? { ...w, edits: withoutItem(w.edits, uniqueId) } : w));
        setNotice(null);
    }, []);

    const onClearWorkspace = useCallback(() => {
        if (workspace) void clearEdits(workspace.sha256).catch(() => {});
        setWorkspace(null);
        setSelectedItem(null);
        setNotice(null);
    }, [workspace]);

    /** Picking something IS the request to look at it. Below 900px the tree gives way. */
    const select = useCallback((id: string) => {
        setSelectedItem(id);
        if (!wide) setTreeCollapsed(true);
    }, [wide]);

    const hub = hubConfig(link, workspace, onRead, share, zbNumber, t, scope, verify, preview);
    const errors = definition?.findings.filter(f => f.severity === 'error') ?? [];
    const hardware = hardwareNumberOf(link.manufacturerData);
    const spaceText = link.addressSpace
        ? `seg 0x${link.addressSpace.segment.toString(16).padStart(2, '0')} / base 0x${link.addressSpace.baseAddress.toString(16)}`
        : null;

    const TABS: { id: TabId; label: string; enabled: boolean }[] = [
        { id: 'startup', label: C.tabStartup, enabled: true },
        { id: 'calibration', label: C.tabCalibration, enabled: !!workspace && !!definition },
        { id: 'code', label: C.tabCode, enabled: !!codeModel },
    ];

    /** Reopening a session is adopting its bytes again — same path a fresh read takes. */
    const onOpenSession = useCallback(async (session: SessionRecord) => {
        const bytes = await loadSessionBytes(session.sha256);
        if (!bytes) { setNotice(t.sessionBytesGone); return; }
        await adoptImage(bytes, session.origin);
    }, [adoptImage, t]);

    const onDeleteSession = useCallback(async (session: SessionRecord) => {
        if (!confirm(t.confirmDeleteSession(session.label, Math.round(session.byteLength / 1024)))) return;
        await deleteSession(session.id);
        setSessions(await listSessions());
    }, [t]);

    const onRenameSession = useCallback(async (session: SessionRecord, label: string) => {
        await renameSession(session.id, label);
        setSessions(await listSessions());
    }, []);

    /**
     * RESTORE: a cloud copy back into SESSIONS, edits included.
     *
     * The bytes are checked against the row's own SHA-256 before anything is written — a copy that
     * does not hash to itself is not restored. Edits are replayed cell by cell onto those bytes
     * (`editsFromShared`) and saved where the page restores edits from; if this device already has
     * edits for the image, the operator chooses. An image this device already holds is reopened
     * from SESSIONS, so its local record (how it was read, over which cable) is kept.
     */
    const onRestoreCloud = useCallback(async (row: CloudSession) => {
        if (cloudBusy) return;
        setCloudBusy(row.id);
        try {
            const { row: full, expired } = await fetchCloudSession(row.id);
            if (expired) { cloud.markExpired(); setNotice(t.syncExpired); return; }
            if (!full) { setNotice(t.restoreFailed); return; }
            const bytes = await imageOf(full);
            if (await sha256Hex(bytes) !== full.sha256) { setNotice(t.restoreCorrupt); return; }

            const variant = variantForLength(bytes.length);
            const shared = parseSharedEdits(full.edits_json);
            let cells = 0;
            let skipped = 0;
            if (shared.length && variant) {
                const local = await loadEdits(full.sha256);
                if (!local?.length || confirm(t.restoreReplacesEdits)) {
                    const loaded = await loadDefinition(variant);
                    const result = editsFromShared(loaded.definition, bytes, shared);
                    await saveEdits(full.sha256, result.edits);
                    cells = result.applied;
                    skipped = result.skipped;
                }
            }
            // Re-read the edits even if the same image is open now: the saved set just changed.
            restoredFor.current = null;
            const existing = sessions.find(s => s.sha256 === full.sha256);
            const held = existing ? await loadSessionBytes(existing.sha256) : null;
            await adoptImage(held ?? bytes, existing && held ? existing.origin : cloudOrigin(full, bytes));
            setNotice(t.restored(cells, skipped));
        } catch {
            setNotice(t.restoreFailed);
        } finally {
            setCloudBusy(null);
        }
    }, [cloudBusy, cloud, sessions, adoptImage, t]);

    const onDeleteCloudSession = useCallback(async (row: CloudSession) => {
        if (cloudBusy || !confirm(t.confirmDeleteCloud(row.label ?? row.sha256.slice(0, 12)))) return;
        setCloudBusy(row.id);
        try { await cloud.deleteSession(row.id); } finally { setCloudBusy(null); }
    }, [cloudBusy, cloud, t]);

    const onDeleteCloudDiagnostic = useCallback(async (row: CloudDiagnostic) => {
        if (cloudBusy || !confirm(t.confirmDeleteRecord)) return;
        setCloudBusy(row.id);
        try { await cloud.deleteDiagnostic(row.id); } finally { setCloudBusy(null); }
    }, [cloudBusy, cloud, t]);

    /**
     * SIGN IN, when the preview session has lapsed — offered only when it is safe to leave the page:
     * online (an offline "expired" is not knowable, and m3 would not load), the link disconnected,
     * nothing saving or restoring. It is a same-tab trip through m3 and back, because m3 only sees
     * its own cookie on a top-level navigation.
     */
    const reauthOffered = preview && cloud.gate === 'expired' && pwa.online && !linkBusy
        && !sharing && cloudBusy === null;
    const onReauth = useCallback(() => {
        if (isDirty(workspace) && !confirm(t.reauthUnsaved)) return;
        window.location.assign(reauthHref());
    }, [workspace, t]);

    /**
     * What a write would be asked to do, derived rather than stored.
     *
     * Every field comes off the live workspace, so the preflight window cannot show a verdict
     * about an image that is no longer loaded. `backupVerified` is true only for a full 512 KiB
     * image whose session is on record — which is exactly what "there is something to restore
     * from" means here.
     */
    const flashPlan: FlashPlan | null = useMemo(() => {
        if (!workspace || !definition) return null;
        // The bytes a write would carry: the edited image with its checksum corrected — the same
        // thing EXPORT produces, so the preflight verdict is about the file the operator has.
        // `correctChecksum` returns null when there is no descriptor to correct — a raw capture,
        // or a partial read that stopped before the header. Falling back to the edited bytes is
        // right: the checksum check below then reports it, rather than this line inventing one.
        const bytes = editedImage
            ? (workspace.variant ? correctChecksum(editedImage, 'calibration', imageBase)?.bytes ?? editedImage : editedImage)
            : workspace.original;
        const ranges: (readonly [number, number])[] = [];
        for (const entry of workspace.edits.values()) {
            const item = definition.definition.items.find(i => i.uniqueId === entry.uniqueId);
            if (!item) continue;
            for (const span of spansOf(definition.definition, item)) ranges.push([span.start, span.end] as const);
        }
        return {
            bytes,
            original: workspace.original,
            originalSha256: workspace.sha256,
            declaredZb: zbNumber.trim(),
            // From the BYTES, not from how they arrived. A file exported yesterday carries the
            // same identification block the ECU reported; refusing to read it would fail the
            // check for the very workflow the check exists to protect.
            imageZb: zbFromImage(workspace.original),
            checksumOk: checksum?.ok ?? false,
            editedRanges: ranges,
            backupVerified: workspace.original.length === FULL_IMAGE_LENGTH
                && sessions.some(s => s.sha256 === workspace.sha256),
            batteryVolts: null,
            /**
             * Read from the ECU's own erase table, not assumed.
             *
             * `FUN_0014b4(0x28c, 0, 1)` erases one sector for a calibration write, and the sector
             * map derived from both erase tables puts that sector at 0x30000-0x3FFFF. Only a full
             * image carries those tables — a 24 KiB window read does not reach 0x270 — so a
             * partial workspace still reports the granularity as unknown, which is correct.
             */
            eraseGranularity: (() => {
                const sector = workspace.original.length === FULL_IMAGE_LENGTH
                    ? calibrationSector(workspace.original)
                    : null;
                return sector ? sector.end - sector.start : null;
            })(),
        };
    }, [workspace, definition, editedImage, imageBase, zbNumber, checksum, sessions]);

    const handleReload = useCallback(() => {
        const busy = linkBusy || isDirty(workspace);
        if (busy && !confirm(t.reloadBusy)) return;
        // UPDATE is only ever offered with the link idle, so taking the new build here cannot swap
        // the code under a read.
        if (updateOffered) void pwa.applyUpdate();
        else pwa.reload();
    }, [linkBusy, updateOffered, workspace, pwa, t]);

    // ── The hub panel: status row, notice, ring, sub-actions. ONE instance, wherever mounted. ─
    const smgInputsPanel = (
        <>
            <div className="flex flex-none flex-col">
                <HubStatusRow label={C.statusRowSmg} Icon={Plug}>
                    <span className="font-mono text-[9px] uppercase text-slate-600">
                        {link.practice ? 'practice' : 'live'} · {link.phase}
                    </span>
                    {link.phase === 'disconnected' ? (
                        <TextButton className="py-3 -my-3" tone="secondary" onClick={() => void link.connect('practice')}>
                            {C.bPractice}
                        </TextButton>
                    ) : (
                        <TextButton Icon={Unplug} tone="destructive" onClick={() => void link.disconnect()}>
                            {C.bDisconnect}
                        </TextButton>
                    )}
                </HubStatusRow>
                <HubNotice text={hub.notice} kind={hub.noticeKind} />
            </div>

            <HubCluster
                left={link.phase === 'connected' && link.addressSpace && !workspace ? (
                    <div className="flex flex-col items-end gap-1.5">
                        <span className={`${LABEL} text-slate-600`}>{C.fScope}</span>
                        <Chip className="py-1.5 -my-1.5" active={scope === 'window'} onClick={() => setScope('window')}>{C.scopeWindow}</Chip>
                        <Chip className="py-1.5 -my-1.5" active={scope === 'full'} onClick={() => setScope('full')}>{C.scopeFull}</Chip>
                        {scope === 'full' && (
                            <Chip className="py-1.5 -my-1.5" active={verifyFull} onClick={() => setVerifyFull(!verifyFull)}>{t.verify}</Chip>
                        )}
                    </div>
                ) : undefined}
            >
                <Hub config={hub} />
            </HubCluster>

            <HubSubActions>
                {workspace && (
                    <TextButton className="py-3 -my-3" Icon={FileDown} tone="neutral" onClick={onExport}>{C.bExport}</TextButton>
                )}
                {flashPlan && definition && (
                    <TextButton className="py-3 -my-3" Icon={Flame} tone="secondary" onClick={() => setFlashOpen(true)}>{C.bFlash}</TextButton>
                )}
                {link.phase === 'reading' && (
                    <TextButton className="py-3 -my-3" Icon={Square} tone="destructive" onClick={link.cancelRead}>{C.bStop}</TextButton>
                )}
                {workspace && (
                    <TextButton className="py-3 -my-3" Icon={Trash2} tone="destructive" onClick={onClearWorkspace}>{C.bClear}</TextButton>
                )}
            </HubSubActions>
        </>
    );

    const calInfoPanel = (
        <div className="min-h-0 flex-1">
            <ParamInfo
                item={selectedXdfItem}
                decoded={subjectDecoded}
                note={selectedItem ? definition?.notes.get(selectedItem) ?? null : null}
                added={selectedItem ? definition?.added.has(selectedItem) ?? false : false}
                lockReason={lockedReason}
                readers={readersOfSelected}
                onOpenFunction={at => { setCodeFn(at); setTab('code'); }}
            />
        </div>
    );

    const calListPanel = (
        <CalibrationDiffList
            entries={diffEntries}
            editedIds={editedIds}
            selectedId={selectedItem}
            canCopyReference={calSubject === 'tuned' && comparing && !!referenceImg}
            onSelect={select}
            onCopyRef={onCopyRefItem}
            onRevert={onRevertItem}
        />
    );

    const narrowPaneTabs = (
        <div className="flex h-full shrink-0 space-x-6 min-[900px]:hidden">
            {([['map', C.narrowMap, true, ''], ['graph', C.narrowGraph, splitGraph, SPLIT_ONLY_SHOW], ['dash', C.narrowDash, true, '']] as const).map(([id, label, enabled, shown]) => (
                <button
                    key={id}
                    type="button"
                    disabled={!enabled}
                    onClick={() => setNarrowPane(id)}
                    className={`relative h-full ${shown || 'flex'} shrink-0 items-center whitespace-nowrap text-[10px] font-bold tracking-widest transition ${narrowPane === id
                        ? 'border-t-2 border-blue-400 text-blue-400'
                        : enabled ? 'border-t-2 border-transparent text-slate-500 hover:text-slate-300'
                            : 'cursor-default border-t-2 border-transparent text-slate-700'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );

    return (
        <>
        {/* 100svh: this page never scrolls, and on Android `100vh` is the viewport with the browser
            chrome retracted — the bottom of the layout would sit under the URL bar. */}
        <main inert={noticeOpen} className="flex h-[100svh] flex-col overflow-hidden bg-slate-950 font-sans text-slate-300 selection:bg-blue-500/30">
            {/* ═══ APP HEADER (48) ═══════════════════════════════════════════════════════════ */}
            <header className="relative z-10 flex h-[48px] shrink-0 items-center justify-between bg-slate-950/80 px-6 py-3 backdrop-blur-md">
                {/* The ///M stripe as the header's bottom rule. Absolutely positioned inside the
                    48px rather than added below it, so the pane split keeps its measured φ. */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
                    style={{ background: 'linear-gradient(to right, #0A9BDB 0 33.333%, #9B84E8 33.333% 66.667%, #F11A22 66.667% 100%)' }}
                />
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    {/* An LED, and only that: it states machine state and nothing else. */}
                    <span
                        title={`SMG: ${link.phase}${link.error ? ' — ' + link.error : ''}`}
                        className={`block size-2 shrink-0 rounded-full ${LED[link.phase]}`}
                    />
                    <h1 className={`${WORDMARK} min-w-0 max-w-[60%] overflow-hidden text-ellipsis whitespace-nowrap text-slate-200 min-[900px]:max-w-none`}>
                        E46M3SMG2 <MMark /> MAPPING
                    </h1>
                    {/* Which build this is, once you are already inside it. */}
                    <span className="shrink-0 whitespace-nowrap font-mono text-[9px] text-slate-500">
                        V{APP_VERSION} · {BUILD_ID}
                    </span>
                    {!CAPABILITIES.canWriteToEcu && <span className="hidden min-[900px]:inline"><Pill tone="ok">{C.readOnly}</Pill></span>}

                    {/* The identity strip: the car, in mono, fenced off by a rule. */}
                    <div className="ml-8 hidden min-w-0 flex-1 items-center gap-4 overflow-hidden whitespace-nowrap border-l border-slate-800 pl-8 font-mono text-[9px] text-slate-500 min-[900px]:flex">
                        <span>ZB <span className="text-slate-300">{zbNumber || workspace?.origin.kind === 'vehicle' && workspace.origin.identity?.zbNumber || '-'}</span></span>
                        <span className="hidden min-[1160px]:inline">HW <span className="text-slate-300">{hardware ?? '-'}</span></span>
                        <span className="hidden min-[1160px]:inline">SPACE <span className={link.addressSpaceConfidence === 'unconfirmed' ? 'text-amber-400' : 'text-slate-300'}>{spaceText ?? '-'}</span></span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {!pwa.online && (
                        <span className={`${LABEL} flex items-center gap-1.5 text-amber-400`} title={t.offlineBuildNote}>
                            <WifiOff className="size-3" />
                            <span className="hidden min-[900px]:inline">{C.offline}</span>
                        </span>
                    )}
                    {/* PRIVACY leads the cluster, as it does in every M tool. Preview only: it is the
                        preview's section of the policy, the part that covers what SYNC sends. */}
                    {preview && (
                        <a
                            href={privacyUrl(lang)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t.privacyHint}
                            className="hidden text-slate-500 transition-colors hover:text-slate-300 min-[900px]:block"
                        >
                            <Shield className="size-5" />
                        </a>
                    )}
                    <button
                        type="button"
                        onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')}
                        title={t.switchLanguage}
                        className="hidden text-slate-500 transition-colors hover:text-slate-300 min-[900px]:block"
                    >
                        <Languages className="size-5" />
                    </button>
                    {pwa.installable && !pwa.installed && (
                        <button
                            type="button"
                            onClick={() => void pwa.install()}
                            title={C.install}
                            className="hidden text-slate-500 transition-colors hover:text-slate-300 min-[900px]:block"
                        >
                            <Smartphone className="size-5" />
                        </button>
                    )}
                    {/* Three states in one slot, none of which resize it: idle grey, an available
                        update pulsing blue as the WORD, and the glyph again while it takes. Hidden
                        below 900px only while there is nothing to take. */}
                    <button
                        type="button"
                        onClick={handleReload}
                        title={updateOffered ? t.updateAvailableHint : t.reloadHint}
                        className={`${updateOffered ? 'flex' : 'hidden min-[900px]:flex'} -my-3 shrink-0 items-center py-3 transition-colors ${updateOffered ? 'animate-pulse text-blue-400 hover:text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        {updateOffered
                            ? <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wider">{C.update}</span>
                            : <RefreshCw className="size-5 shrink-0" />}
                    </button>
                </div>
            </header>

            {/* ═══ THE SPLIT ═══════════════════════════════════════════════════════════════════ */}
            {/* `grid-cols-1` is `minmax(0,1fr)`, and it is load-bearing below 900px. Without it the
                implicit column is `auto` = MAX-CONTENT, so the tree's longest item name sized
                the column: measured at 390px the tree came out 596px wide and every row was
                clipped by `overflow-hidden` rather than truncated with an ellipsis. */}
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden min-[900px]:flex min-[900px]:flex-row">

                {/* ─── LEFT COLUMN: the work surface ─────────────────────────────────────────── */}
                <div className={`relative flex min-h-0 flex-col border-r-0 border-b border-slate-900 bg-slate-950/40 [grid-area:1/1] min-[900px]:h-full min-[900px]:w-[61.8%] min-[900px]:flex-none min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:[grid-area:auto] ${narrowPane === 'map' ? '' : 'invisible pointer-events-none min-[900px]:visible min-[900px]:pointer-events-auto'}`}>

                    {/* Tab bar (44) — matches the right column's bar so their rules form one line. */}
                    <div className="z-30 hidden h-[44px] flex-none items-center border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm min-[900px]:flex">
                        <div className="no-scrollbar mr-auto flex h-full min-w-0 flex-1 space-x-6 overflow-x-auto overflow-y-hidden">
                            {TABS.map(entry => (
                                <button
                                    key={entry.id}
                                    onClick={() => setTab(entry.id)}
                                    disabled={!entry.enabled}
                                    className={`relative flex h-full shrink-0 items-center whitespace-nowrap text-[10px] font-bold tracking-widest transition ${tab === entry.id
                                        ? 'border-b-2 border-blue-400 text-blue-400'
                                        : 'border-b-2 border-transparent text-slate-500 hover:text-slate-300 disabled:opacity-20'}`}
                                >
                                    {entry.label}
                                </button>
                            ))}
                        </div>
                        {/* Tools right: the definition's own verdict, and nothing that a pane
                            already states. */}
                        {definition && errors.length > 0 && (
                            <div className="ml-4 flex h-full items-center gap-4 border-l border-slate-800 pl-4">
                                <span className="text-[9px] font-mono text-red-400">{t.defErrors(errors.length)}</span>
                            </div>
                        )}
                    </div>

                    {/* Session bar (26): the record you are acting on stays on screen the whole
                        time you are looking at values. */}
                    {workspace && tab === 'calibration' && (
                        <div className="hidden h-[26px] min-w-0 flex-none items-center gap-3 border-b border-slate-900 bg-slate-950/60 px-4 text-[10px] min-[900px]:flex">
                            <span className="max-w-[220px] truncate font-bold uppercase tracking-widest text-slate-300" title={describeOrigin(workspace.origin)}>
                                {describeOrigin(workspace.origin)}
                            </span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest ${isDirty(workspace) ? 'bg-blue-500/15 text-blue-400' : 'bg-slate-800 text-slate-400'}`}>
                                {isDirty(workspace) ? C.vDraft : (workspace.variant ?? C.vPartial)}
                            </span>
                            {isPractice(workspace) && <Pill tone="secondary">{C.vPracticeBytes}</Pill>}
                            {/* No BASE field: the label at the left IS what this started from, and
                                the variant is the badge beside it. A third statement of either is
                                the same fact three times on a 26px bar. */}
                            {checksum && (
                                <Pill tone={checksum.ok ? 'ok' : 'caution'}>{checksum.ok ? C.vCrcOk : C.vCrcBad}</Pill>
                            )}
                            <span className="ml-auto shrink-0 font-mono text-[9px] text-slate-600">
                                {C.fEdits} <span className={isDirty(workspace) ? 'text-blue-400' : 'text-slate-400'}>{editedCellCount(workspace)}</span>
                                <span className="ml-3">{workspace.sha256.slice(0, 12)}</span>
                            </span>
                        </div>
                    )}

                    {/* Content. */}
                    <div className="relative min-h-0 flex-1 overflow-hidden">
                        {tab === 'startup' && (
                            <div className="h-full w-full overflow-y-auto px-4 pt-2 pb-2">
                                <StartupPane
                                    link={link}
                                    workspace={workspace}
                                    definition={definition}
                                    checksum={checksum}
                                    share={share}
                                    online={pwa.online}
                                    onFile={file => void onOpenFile(file)}
                                    zbNumber={zbNumber}
                                    setZbNumber={setZbNumber}
                                    diag={{ busy: diagBusy, note: diagNote, onSend: () => void onSendDiagnostic(), onCopy: () => void onCopyDiagnostic() }}
                                    sessions={sessions}
                                    onOpenSession={s => void onOpenSession(s)}
                                    onDeleteSession={s => void onDeleteSession(s)}
                                    onRenameSession={(s, label) => void onRenameSession(s, label)}
                                    canSend={preview}
                                    cloudPanel={preview ? (
                                        <CloudPanel
                                            cloud={cloud}
                                            busyId={cloudBusy}
                                            canRestore={!linkBusy}
                                            reauth={reauthOffered ? onReauth : null}
                                            onRestore={row => void onRestoreCloud(row)}
                                            onDeleteSession={row => void onDeleteCloudSession(row)}
                                            onDeleteDiagnostic={row => void onDeleteCloudDiagnostic(row)}
                                        />
                                    ) : null}
                                />
                            </div>
                        )}
                        {tab === 'code' && codeModel && (
                            <FunctionTree model={codeModel} selected={codeFn} onSelect={setCodeFn} />
                        )}
                        {tab === 'calibration' && definition && workspace && coverage && (
                            /* The picture and the tree. Below 900px they take turns: the tree is
                               full width and the picture is what its collapse reveals. */
                            <div className="flex h-full w-full min-h-0">
                                <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pt-2 pb-2 ${wide || treeCollapsed ? '' : 'hidden'}`}>
                                    <CoverageMap
                                        report={coverage}
                                        covered={coveredRanges}
                                        highlight={selectedRanges}
                                        toXdfAddress={definition.definition.xdfAddressOf}
                                    />
                                </div>
                                <CalibrationTree
                                    items={items}
                                    categories={categories}
                                    selectedId={selectedItem}
                                    editedIds={editedIds}
                                    addedIds={definition.added}
                                    onSelect={select}
                                    collapsed={treeCollapsed}
                                    onToggleCollapse={() => setTreeCollapsed(!treeCollapsed)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* ─── RIGHT COLUMN: visualization & inputs ──────────────────────────────────── */}
                <div className={`relative z-20 flex min-h-0 flex-col overflow-hidden bg-slate-900/20 [grid-area:1/1] min-[900px]:h-full min-[900px]:w-[38.2%] min-[900px]:flex-none min-[900px]:[grid-area:auto] ${narrowPane !== 'map' ? '' : 'invisible pointer-events-none min-[900px]:visible min-[900px]:pointer-events-auto'}`}>

                    {/* Pane bar (44) — the same height as the tab bar across the split. */}
                    <div className="hidden h-[44px] flex-none items-center justify-between border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm min-[900px]:flex">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            {tab === 'code' ? C.paneCode : C.paneViz}
                        </span>
                        {/* CODE draws two pictures of one function and they share its selection,
                            so the choice belongs on the pane's own bar rather than inside either
                            picture — the same place CALIBRATION puts its form row. */}
                        {tab === 'code' && codeModel && (
                            <Selector
                                label={C.formNetwork.slice(0, 4)}
                                value={codeForm}
                                options={[
                                    { value: 'network' as const, label: C.formNetwork },
                                    { value: 'listing' as const, label: C.formListing },
                                ]}
                                onChange={setCodeForm}
                            />
                        )}
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col">
                        {/* The visualizer is the elastic half; a picture reads fine at any size, the
                            dial and its toggles do not. */}
                        <div className={`${narrowPane === 'graph' ? '' : SPLIT_ONLY_HIDE} relative min-h-[48px] flex-1 overflow-hidden bg-gradient-to-b from-slate-900/10 to-transparent [@media(min-height:560px)]:min-h-[140px]`}>
                            {tab === 'code' && codeModel && workspace ? (
                                codeForm === 'network' ? (
                                    <CodeNetwork
                                        model={codeModel}
                                        fn={selectedFn}
                                        onOpen={setCodeFn}
                                        onPickItem={id => { setSelectedItem(id); setTab('calibration'); }}
                                    />
                                ) : (
                                    <CodeListing image={workspace.original} fn={selectedFn} onOpen={setCodeFn} />
                                )
                            ) : tab === 'calibration' && definition && workspace ? (
                                <ValuePane
                                    item={selectedXdfItem}
                                    subjectDecoded={subjectDecoded}
                                    referenceDecoded={comparing ? referenceDecoded : null}
                                    editedMask={editedMask}
                                    hasEdit={!!selectedItem && editedIds.has(selectedItem)}
                                    note={selectedItem ? definition.notes.get(selectedItem) ?? null : null}
                                    lockReason={lockedReason}
                                    baseRaw={baseRawOfSelected}
                                    graphMode={graphMode}
                                    onGraphMode={setGraphMode}
                                    sectionAxis={sectionAxis}
                                    onSectionAxis={setSectionAxis}
                                    gearPair={gearPair}
                                    onGearPair={setGearPair}
                                    subject={calSubject}
                                    onSubject={setCalSubject}
                                    reference={calReference}
                                    onReference={setCalReference}
                                    compareOptions={compareOptions}
                                    view={calView}
                                    onView={setCalView}
                                    diffCount={comparing ? (diffEntries?.length ?? null) : null}
                                    onShowList={() => setCalBottomTab('list')}
                                    onEditCell={onEditCell}
                                    onBulkOp={onBulkOp}
                                    onCopyRef={onCopyRef}
                                    onRevert={() => { if (selectedItem) onRevertItem(selectedItem); }}
                                    onToggleBit={onToggleBit}
                                />
                            ) : (
                                <EmptyState Icon={FileCode} label={C.awaitingImage} hint={t.nothingLoaded} />
                            )}
                        </div>

                        {/* Inputs & controls. On CALIBRATION the region's height is the layout's
                            (φ of the column), not the content's: DIFF, INFO and SMG alternate
                            inside it, and a height that followed the content would resize the
                            value pane above on every tab switch. */}
                        <div className={`flex ${narrowPane === 'graph' ? SPLIT_ONLY_HIDE : SPLIT_ONLY_GROW} ${tab === 'calibration' || tab === 'code' ? 'basis-[38.2%] grow-0 shrink-0' : 'flex-initial'} min-h-0 flex-col overflow-y-auto px-5 pt-2 pb-2 [@media(min-height:560px)]:pt-4 [@media(min-height:560px)]:pb-5`}>
                            {tab === 'code' && codeModel && (
                                <div className="mb-1 flex h-[26px] flex-none items-center gap-4 border-b border-slate-900 px-1">
                                    {(['fn', 'smg'] as const).map(id => (
                                        <button
                                            key={id}
                                            onClick={() => setCodeBottomTab(id)}
                                            className={`flex h-full items-center gap-1.5 border-b-2 text-[10px] font-bold uppercase tracking-widest transition ${codeBottomTab === id
                                                ? 'border-blue-400 text-blue-400'
                                                : 'border-transparent text-slate-600 hover:text-slate-300'}`}
                                        >
                                            {id === 'fn' ? C.bottomFn : C.bottomSmg}
                                            {id === 'smg' && <span className={`block size-1.5 rounded-full ${LED[link.phase]}`} />}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {tab === 'calibration' && (
                                <div className="mb-1 flex h-[26px] flex-none items-center gap-4 border-b border-slate-900 px-1">
                                    {/* Reading order, left to right: which ones differ, what this
                                        one is, and what to do with the result. */}
                                    {(['list', 'info', 'smg'] as const).map(id => (
                                        <button
                                            key={id}
                                            onClick={() => setCalBottomTab(id)}
                                            className={`flex h-full items-center gap-1.5 border-b-2 text-[10px] font-bold uppercase tracking-widest transition ${calBottomTab === id
                                                ? 'border-blue-400 text-blue-400'
                                                : 'border-transparent text-slate-600 hover:text-slate-300'}`}
                                        >
                                            {id === 'list' ? C.bottomDiff : id === 'info' ? C.bottomInfo : C.bottomSmg}
                                            {id === 'smg' && <span className={`block size-1.5 rounded-full ${LED[link.phase]}`} />}
                                            {id === 'list' && diffEntries !== null && (
                                                <span className="font-mono text-slate-500">{diffEntries.length}</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {tab === 'code' && codeModel
                                ? (codeBottomTab === 'fn'
                                    ? <CodeInfo
                                        model={codeModel}
                                        fn={selectedFn}
                                        onOpen={setCodeFn}
                                        onPickItem={id => { setSelectedItem(id); setTab('calibration'); }}
                                      />
                                    : smgInputsPanel)
                                : tab !== 'calibration' || calBottomTab === 'smg'
                                    ? smgInputsPanel
                                    : calBottomTab === 'list' ? calListPanel : calInfoPanel}
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ MOBILE FOOTER (52) ═══════════════════════════════════════════════════════ */}
            <div className="z-30 flex-none border-t border-slate-900 bg-slate-900/50 backdrop-blur-sm min-[900px]:hidden">
                <div className="relative flex h-[52px] items-center px-4">
                    {narrowPaneTabs}
                    {/* MENU is centred absolutely, so it stays on the screen's centre line
                        whatever the groups either side of it weigh. */}
                    <button
                        type="button"
                        onClick={() => setMenuOpen(true)}
                        aria-label={C.menu}
                        className="absolute left-1/2 top-0 z-10 flex h-[52px] w-[52px] -translate-x-1/2 cursor-pointer items-center justify-center text-slate-400 hover:text-slate-200"
                    >
                        <MarkIcon className="h-7 w-8" />
                    </button>
                </div>
            </div>

            {flashOpen && flashPlan && definition && (
                <FlashDialog plan={flashPlan} definition={definition.definition} onClose={() => setFlashOpen(false)} />
            )}

            {menuOpen && (
                <MobileMenu
                    onClose={() => setMenuOpen(false)}
                    tabs={TABS}
                    activeTab={tab}
                    onSelectTab={id => { setTab(id as TabId); setNarrowPane('map'); }}
                    vehicle={{ zb: zbNumber || null, hw: hardware, space: spaceText, link: `${link.practice ? 'practice' : 'live'} · ${link.phase}` }}
                    session={workspace ? {
                        source: describeOrigin(workspace.origin),
                        variant: workspace.variant,
                        edits: editedCellCount(workspace),
                        crc: checksum ? (checksum.ok ? C.vCrcOk : C.vCrcBad) : null,
                    } : null}
                    onExport={workspace ? onExport : null}
                    onClear={workspace ? onClearWorkspace : null}
                    onReload={handleReload}
                    updateAvailable={updateOffered}
                    installable={pwa.installable && !pwa.installed}
                    onInstall={() => void pwa.install()}
                    onToggleLang={() => setLang(lang === 'ja' ? 'en' : 'ja')}
                    privacyHref={preview ? privacyUrl(lang) : null}
                />
            )}

            {notice && (
                <div className="flex-none bg-red-500/15 px-4 py-2 text-[11px] text-red-400">
                    {notice}{' '}
                    <button type="button" className={`${LABEL} ml-2 text-slate-400`} onClick={() => setNotice(null)}>
                        {C.bDismiss}
                    </button>
                </div>
            )}
        </main>

        {/* Outside <main>, which is inert while this is up. */}
        {noticeOpen && <PreviewNoticeDialog onConfirm={confirmNotice} />}
        </>
    );
}

/**
 * Where a restored image says it came from.
 *
 * Practice rows stay practice: invented bytes must keep their badge wherever they travel, and the
 * row's own read statistics are what the practice origin records. Anything else is named for what
 * it now is on this device — a copy from the cloud — rather than dressed as a vehicle read with a
 * probe result this device never made.
 */
function cloudOrigin(row: CloudSessionFull, bytes: Uint8Array): ImageOrigin {
    if (row.practice) {
        return {
            kind: 'practice',
            read: {
                bytes,
                baseAddress: row.base_address ?? 0,
                segment: row.segment ?? 0,
                chunkSize: row.chunk_size ?? 0,
                exchanges: row.exchanges ?? 0,
                retries: row.retries ?? 0,
                elapsedMs: row.elapsed_ms ?? 0,
            },
        };
    }
    return { kind: 'file', fileName: `CLOUD ${row.label ?? row.sha256.slice(0, 12)}`, lastModified: row.created_at };
}

/** The definition's own display radix. 3 = hexadecimal, and it marks the bitfields. */
function hex16(value: number): string {
    return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * The one place the primary action is decided.
 *
 * Pure: same inputs, same face. Busy states DISABLE the hub rather than hiding it, so it stays
 * visibly the same control, just occupied.
 */
function hubConfig(
    link: ReturnType<typeof useSmg2Link>,
    workspace: Workspace | null,
    onRead: () => void,
    share: ShareControls,
    zb: string,
    t: Catalog,
    scope: ReadScope,
    verify: boolean,
    /** SYNC exists only on the preview; production goes from READ straight to EXPORT and RE-READ. */
    canSync: boolean,
): HubConfig {
    if (link.phase === 'connecting') {
        return { label: C.hubLinking, Icon: Loader2, tone: 'connecting', disabled: true, spin: true };
    }
    if (link.phase === 'probing') {
        return {
            label: C.hubProbing, Icon: Loader2, tone: 'busy', disabled: true, spin: true,
            notice: t.noticeProbing, noticeKind: 'progress',
        };
    }
    if (link.phase === 'reading') {
        const p: ReadProgress | null = link.progress;
        return {
            label: C.hubReading, Icon: Loader2, tone: 'busy', disabled: true, spin: true,
            notice: p ? readingNotice(p) : t.noticeReadingStart, noticeKind: 'progress',
        };
    }
    if (link.phase === 'disconnected') {
        return {
            label: C.hubConnect,
            Icon: Plug,
            tone: 'ready',
            onClick: () => void link.connect('auto'),
            notice: link.error ?? `${routeSentence(link.transports, t)} ${t.ignitionOn}`,
            /* The route sentence is true on every visit; what earns this line is a route that
               cannot work at all. */
            noticeKind: link.error ? 'error' : link.transports.kind === 'none' ? 'caution' : 'info',
        };
    }
    if (!link.addressSpace) {
        return {
            label: C.hubProbe,
            Icon: Crosshair,
            tone: 'ready',
            onClick: () => void link.probe(zb || undefined),
            notice: link.error ?? link.probeReport?.summary ?? t.noticeProbeUnknown,
            noticeKind: link.error ? 'error' : 'caution',
        };
    }
    if (!workspace) {
        return {
            label: C.hubRead,
            Icon: Download,
            tone: 'ready',
            onClick: onRead,
            notice: link.error
                ?? (link.addressSpaceConfidence === 'unconfirmed'
                    ? t.noticeUnconfirmed
                    : scope === 'full'
                        ? (verify ? t.noticeReadFullVerify('36') : t.noticeReadFull('18'))
                        : t.noticeReadPlan(CALIBRATION_WINDOW.length.toLocaleString())),
            /* Eighteen minutes with the ignition on is a decision, not a detail — and it changes
               with the scope beside it, so it is not a line that is true every time. */
            noticeKind: link.error ? 'error' : 'caution',
        };
    }
    if (!canSync) {
        return {
            label: C.hubReread, Icon: RefreshCw, tone: 'idle', onClick: onRead,
            notice: t.noticeExport, noticeKind: 'info',
        };
    }
    /** SYNC is a hub face, not a side button: if a step belongs to the main sequence it belongs
     *  on the hub, even at five faces. */
    if (share.busy) {
        return { label: C.hubSending, Icon: Loader2, tone: 'busy', disabled: true, spin: true,
            notice: t.noticeSending, noticeKind: 'progress' };
    }
    if (!share.uploaded) {
        return {
            label: C.hubSync,
            Icon: UploadCloud,
            tone: 'ready',
            onClick: share.onShare,
            notice: share.error ?? (link.verifiedByReread === true ? `${t.noticeVerified} ${t.noticeShare}` : t.noticeShare),
            /* True after every successful read, so it carries no information here. */
            noticeKind: share.error ? 'error' : 'info',
        };
    }
    return {
        label: C.hubReread,
        Icon: RefreshCw,
        tone: 'idle',
        onClick: onRead,
        notice: share.error ?? t.noticeShared((share.uploadedBytes / 1024).toFixed(1)),
        noticeKind: share.error ? 'error' : 'info',
    };
}

/**
 * STARTUP: the connection, the car's number, where the calibration sits, and the image — the
 * things settled before anything is read, and the record of what was.
 */
function StartupPane({
    link,
    workspace,
    definition,
    checksum,
    share,
    online,
    onFile,
    zbNumber,
    setZbNumber,
    diag,
    sessions,
    onOpenSession,
    onDeleteSession,
    onRenameSession,
    canSend,
    cloudPanel,
}: {
    link: ReturnType<typeof useSmg2Link>;
    workspace: Workspace | null;
    definition: LoadedDefinition | null;
    checksum: ChecksumResult | null;
    share: ShareControls;
    /** `navigator.onLine`. False means every fetch is coming from the cache. */
    online: boolean;
    onFile: (file: File) => void;
    zbNumber: string;
    setZbNumber: (v: string) => void;
    diag: { busy: boolean; note: string | null; onSend: () => void; onCopy: () => void };
    sessions: readonly SessionRecord[];
    onOpenSession: (session: SessionRecord) => void;
    onDeleteSession: (session: SessionRecord) => void;
    onRenameSession: (session: SessionRecord, label: string) => void;
    /** SEND exists on the preview only; COPY works everywhere. */
    canSend: boolean;
    /** What this owner has saved, beside what this device holds. Null off the preview. */
    cloudPanel: React.ReactNode;
}) {
    const { t } = useLang();
    const [manualSeg, setManualSeg] = useState('00');
    const [manualBase, setManualBase] = useState('0');
    const canProbe = link.phase === 'connected';

    return (
        <Pane>
            {/* First, because this tab's subject is the record rather than the wire. An operator
                arriving with the car already read is here to reopen #3, not to reconnect. */}
            <Section title={C.sessions} note={t.sessionsNote}>
                <SessionList
                    sessions={sessions}
                    activeSha256={workspace?.sha256 ?? null}
                    onOpen={onOpenSession}
                    onDelete={onDeleteSession}
                    onRename={onRenameSession}
                />
            </Section>
            {cloudPanel}
            <Section
                title={C.secConnection}
                note={link.practice ? t.practiceNote : t.connectionNote}
            >
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <Field label={C.fPhase} value={t.phase(link.phase)} stacked />
                    <Field
                        label={C.fRoute}
                        value={link.practice ? 'practice' : link.transports.kind === 'none' ? '-' : t.ready(link.transports.kind === 'web-serial' ? 'Web Serial' : 'WebUSB / FTDI')}
                        stacked
                    />
                    <Field
                        label={C.fAddressSpace}
                        value={link.addressSpace
                            ? `seg 0x${link.addressSpace.segment.toString(16).padStart(2, '0')} / base 0x${link.addressSpace.baseAddress.toString(16)}`
                            : t.vNotEstablished}
                        tone={link.addressSpaceConfidence === 'unconfirmed' ? 'text-amber-400' : undefined}
                        stacked
                    />
                    <Field
                        label={C.fLastRead}
                        value={link.lastRead ? `${(link.lastRead.elapsedMs / 1000).toFixed(1)}s / ${link.lastRead.exchanges} ex` : '--'}
                        stacked
                    />
                    <Field
                        label={C.fVerified}
                        value={link.verifiedByReread === null ? '--' : link.verifiedByReread ? t.vRereadMatch : C.vMismatch}
                        tone={link.verifiedByReread === false ? 'text-red-400' : undefined}
                        stacked
                    />
                    <Field
                        label={C.fBuild}
                        value={`v${APP_VERSION} · ${BUILD_ID}`}
                        tone={online ? undefined : 'text-amber-400'}
                        stacked
                    />
                </div>
                {!online && (
                    <Well className="mt-3">
                        <p className="text-[11px] leading-relaxed text-amber-400">{t.offlineBuildNote}</p>
                    </Well>
                )}
                {link.manufacturerData && (
                    <Well className="mt-3">
                        <div className="flex items-baseline gap-2">
                            <MicroLabel>{C.fManufacturerData}</MicroLabel>
                            <span className="font-mono text-[10px] normal-case text-slate-600">DS2 0x53</span>
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-slate-400">
                            {link.manufacturerData}
                        </pre>
                    </Well>
                )}
            </Section>

            <Section title={C.secZbNumber} note={t.zbNote}>
                <SearchInput
                    value={zbNumber}
                    onChange={v => setZbNumber(v.replace(/\D/g, '').slice(0, 7))}
                    placeholder={t.phZbNumber}
                    className="w-64"
                />
            </Section>

            {canProbe && (
                <Section title={C.secManualSpace} note={t.manualNote}>
                    <div className="flex flex-wrap items-end gap-3">
                        <div>
                            <MicroLabel>{C.fSegment}</MicroLabel>
                            <SearchInput value={manualSeg} onChange={setManualSeg} placeholder="00" className="mt-1 w-20" />
                        </div>
                        <div>
                            <MicroLabel>{C.fBase}</MicroLabel>
                            <SearchInput value={manualBase} onChange={setManualBase} placeholder="0" className="mt-1 w-32" />
                        </div>
                        <TextButton
                            Icon={Crosshair}
                            disabled={!/^[0-9a-fA-F]{1,2}$/.test(manualSeg) || !/^[0-9a-fA-F]{1,6}$/.test(manualBase)}
                            onClick={() => link.selectAddressSpace({
                                segment: parseInt(manualSeg, 16),
                                baseAddress: parseInt(manualBase, 16),
                            })}
                        >
                            {C.bUseIt}
                        </TextButton>
                    </div>
                </Section>
            )}

            {link.probeReport && (
                <Section
                    title={C.secProbe}
                    count={link.probeReport.candidates.length}
                    note={link.probeReport.summary}
                >
                    <div className="flex flex-col gap-1">
                        {link.probeReport.candidates.map(c => {
                            const active = link.addressSpace?.segment === c.segment && link.addressSpace?.baseAddress === c.baseAddress;
                            return (
                                <button
                                    key={`${c.segment}:${c.baseAddress}`}
                                    type="button"
                                    onClick={() => link.selectAddressSpace(c)}
                                    className={`flex items-baseline justify-between gap-4 rounded px-2 py-1.5 text-left transition-colors ${active ? 'bg-blue-500/10' : 'hover:bg-slate-800/50'}`}
                                >
                                    <span className="font-mono text-[11px] text-slate-200">
                                        seg 0x{c.segment.toString(16).padStart(2, '0')} · base 0x{c.baseAddress.toString(16).padStart(6, '0')}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{c.reasons.join(' · ')}</span>
                                    <span className={`shrink-0 font-mono text-[11px] ${c.score >= 0.75 ? 'text-blue-400' : 'text-slate-600'}`}>
                                        {Math.round(c.score * 100)}%
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </Section>
            )}

            <Section title={C.secOpenImage} note={t.openImageNote(CALIBRATION_WINDOW.length.toLocaleString())}>
                {!workspace && (
                    <DropZone Icon={FileCode} label={C.bChooseBin} hint={t.dropHint} accept=".bin" onFile={onFile} />
                )}
                {workspace && (
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                        <Field label={C.fSource} value={describeOrigin(workspace.origin)} stacked />
                        <Field label={C.fSize} value={workspace.original.length.toLocaleString()} unit="B" stacked />
                        <Field
                            label={C.fEdits}
                            value={editedCellCount(workspace)}
                            tone={isDirty(workspace) ? 'text-indigo-400' : 'text-slate-200'}
                            stacked
                        />
                        <Field label="SHA-256" value={workspace.sha256.slice(0, 12)} stacked title={workspace.sha256} />
                        <div className="flex flex-wrap items-center gap-2 self-end">
                            {isPractice(workspace) && <Pill tone="secondary">{C.vPracticeBytes}</Pill>}
                            {checksum && <Pill tone={checksum.ok ? 'ok' : 'caution'}>{checksum.ok ? C.vCrcOk : C.vCrcBad}</Pill>}
                            {definition && <Pill tone="neutral">{workspace.variant}</Pill>}
                            {share.uploaded && <Pill tone="ok">{C.vSynced}</Pill>}
                        </div>
                    </div>
                )}
                {workspace && checksum && (
                    <Well className="mt-3">
                        <p className="text-[11px] leading-relaxed text-slate-400">
                            {checksum.ok
                                ? t.crcOkNote(hex16(checksum.stored), checksum.protectedBytes.toLocaleString())
                                : t.crcNote(hex16(checksum.stored), hex16(checksum.computed))}
                        </p>
                    </Well>
                )}
                {workspace && !checksum && (
                    <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{t.noChecksumNote}</p>
                )}
            </Section>

            {definition && (
                <Section
                    title={C.secDefinition}
                    count={definition.definition.items.length}
                    note={`${definition.definition.header.title} — ${definition.definition.header.author}`}
                >
                    <Findings definition={definition} />
                </Section>
            )}

            <LogSection link={link} busy={diag.busy} note={diag.note} onSend={canSend ? diag.onSend : null} onCopy={diag.onCopy} />
        </Pane>
    );
}

function Findings({ definition }: { definition: LoadedDefinition }) {
    const { t } = useLang();
    const by = (severity: 'error' | 'warning' | 'note') => definition.findings.filter(f => f.severity === severity);
    const groups = [
        { kind: 'errors' as const, list: by('error'), tone: 'text-red-400' },
        { kind: 'warnings' as const, list: by('warning'), tone: 'text-amber-400' },
        { kind: 'notes' as const, list: by('note'), tone: 'text-slate-500' },
    ].filter(g => g.list.length > 0);
    if (groups.length === 0) return null;
    return (
        <div className="flex flex-col gap-3">
            {groups.map(g => (
                <div key={g.kind}>
                    <MicroLabel>{t.lFindings(g.list.length, g.kind)}</MicroLabel>
                    <ul className="mt-1 flex flex-col gap-1">
                        {g.list.slice(0, 12).map((f, i) => (
                            <li key={i} className={`text-[11px] leading-relaxed ${g.tone}`}>{f.message}</li>
                        ))}
                        {g.list.length > 12 && (
                            <li className="text-[11px] text-slate-600">… +{g.list.length - 12}</li>
                        )}
                    </ul>
                </div>
            ))}
        </div>
    );
}

/** The session log, and the controls that send it. */
function LogSection({
    link,
    busy,
    note,
    onSend,
    onCopy,
}: {
    link: ReturnType<typeof useSmg2Link>;
    busy: boolean;
    note: string | null;
    onSend: (() => void) | null;
    onCopy: () => void;
}) {
    const { t } = useLang();
    return (
        <Section
            title={C.secLog}
            count={link.log.length}
            actions={
                <>
                    {onSend && (
                        <TextButton
                            Icon={busy ? Loader2 : SendHorizontal}
                            tone={link.lastFailure ? 'danger' : 'primary'}
                            disabled={busy || link.log.length === 0}
                            onClick={onSend}
                        >
                            {C.bSend}
                        </TextButton>
                    )}
                    <TextButton Icon={ClipboardCopy} tone="neutral" disabled={link.log.length === 0} onClick={onCopy}>
                        {C.bCopy}
                    </TextButton>
                </>
            }
            note={link.lastFailure
                ? t.lastFailure(link.lastFailure.kind, link.lastFailure.message)
                : t.logNote}
        >
            {link.log.length === 0 ? (
                <EmptyState Icon={Radio} label={C.awaitingLog} />
            ) : (
                <Well className="max-h-[26vh] overflow-y-auto">
                    <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-500">
                        {link.log.join('\n')}
                    </pre>
                </Well>
            )}
            <div className="mt-2 flex min-h-[30px] items-start">
                {note && <p className="text-[11px] leading-relaxed text-slate-500">{note}</p>}
            </div>
        </Section>
    );
}
