'use client';

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
} from 'react';
import {
    Code2,
    Copy,
    Download,
    File,
    FileImage,
    FileJson,
    FileSpreadsheet,
    FileText,
    Folder,
    Loader2,
    type LucideIcon,
} from 'lucide-react';
import { useCanvas } from '@/context/CanvasContext';
import type { ApiArtifact, ApiMessageFile } from '@/lib/chat-contracts';
import {
    downloadArtifact,
    downloadFile,
    listConversationArtifacts,
    listConversationFiles,
} from '@/lib/chat-rest-api';
import { artifactDisplayFilename, artifactMimeType } from '@/lib/file-kinds';
import {
    formatBytes,
    visualForArtifact,
    visualForUploadedFile,
    type CanvasViewerKind,
} from '@/lib/file-visual';
import { canvasItemKey, type CanvasSelectedItem } from '@/lib/canvas-selection';
import { previewOfficeBlob, type SpreadsheetPreview } from '@/lib/file-preview';

/** Default panel width when Canvas opens (user can still resize). */
const CANVAS_DEFAULT_WIDTH_PX = 640;

type ListFileRow = {
    item: CanvasSelectedItem;
    sizeLabel: string;
    Icon: LucideIcon;
    colorClass: string;
};

function iconForViewerKind(kind: CanvasViewerKind): LucideIcon {
    if (kind === 'image') return FileImage;
    if (kind === 'spreadsheet') return FileSpreadsheet;
    if (kind === 'docx') return FileText;
    if (kind === 'code' || kind === 'readme' || kind === 'html') return Code2;
    if (kind === 'json') return FileJson;
    return File;
}

function viewerStatusLabel(
    kind: CanvasViewerKind,
    opts?: { lineCount?: number; table?: SpreadsheetPreview },
): string {
    if (kind === 'code') return `Text · UTF-8 · ${opts?.lineCount ?? 0} lines`;
    if (kind === 'json') return `JSON · UTF-8 · ${opts?.lineCount ?? 0} lines`;
    if (kind === 'readme') return `Markdown · UTF-8 · ${opts?.lineCount ?? 0} lines`;
    if (kind === 'pdf') return 'PDF · Preview';
    if (kind === 'image') return 'Image · Preview';
    if (kind === 'html') return 'HTML · Preview';
    if (kind === 'docx') return `DOCX · Preview · ${opts?.lineCount ?? 0} paragraphs`;
    if (kind === 'spreadsheet') {
        const rows = opts?.table?.rows.length ?? 0;
        const cols = opts?.table?.rows[0]?.length ?? 0;
        const suffix = opts?.table?.truncated ? ' (truncated)' : '';
        return `Spreadsheet · ${rows}×${cols}${suffix}`;
    }
    return 'Binary · Download to open';
}

function columnLabel(index: number): string {
    let n = index;
    let label = '';
    do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
}

export default function CanvasPanel({
    isOpen,
    onCloseAction,
    conversationId,
}: {
    isOpen: boolean;
    onCloseAction: () => void;
    conversationId?: string;
}) {
    const {
        activeTab,
        setActiveTab,
        selectedItem,
        setSelectedItem,
        filesListVersion,
    } = useCanvas();

    const [uploadedFiles, setUploadedFiles] = useState<ApiMessageFile[]>([]);
    const [artifacts, setArtifacts] = useState<ApiArtifact[]>([]);
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError] = useState<string | null>(null);

    const [viewerLoading, setViewerLoading] = useState(false);
    const [viewerError, setViewerError] = useState<string | null>(null);
    const [textLines, setTextLines] = useState<string[]>([]);
    const [docxParagraphs, setDocxParagraphs] = useState<string[]>([]);
    const [spreadsheetTable, setSpreadsheetTable] = useState<SpreadsheetPreview | null>(null);
    const [previewTruncated, setPreviewTruncated] = useState(false);
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [viewerKind, setViewerKind] = useState<CanvasViewerKind>('binary');
    const [copyDone, setCopyDone] = useState(false);

    const [canvasWidth, setCanvasWidth] = useState(CANVAS_DEFAULT_WIDTH_PX);
    const [isMobile, setIsMobile] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const objectUrlRef = useRef<string | null>(null);

    const revokeObjectUrl = useCallback(() => {
        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
        }
        setObjectUrl(null);
    }, []);

    const getMinWidthPx = useCallback(() => {
        if (typeof window === 'undefined') return 120;
        return Math.max(Math.round(window.innerWidth * 0.1), 120);
    }, []);

    useEffect(() => {
        if (!isOpen || !conversationId) {
            setUploadedFiles([]);
            setArtifacts([]);
            return;
        }
        let cancelled = false;
        setListLoading(true);
        setListError(null);
        Promise.all([
            listConversationFiles(conversationId, { limit: 100 }),
            listConversationArtifacts(conversationId, { limit: 100 }),
        ])
            .then(([filesRes, artifactsRes]) => {
                if (cancelled) return;
                setUploadedFiles(filesRes.files ?? []);
                setArtifacts(artifactsRes.artifacts ?? []);
            })
            .catch((e) => {
                if (cancelled) return;
                setListError(e instanceof Error ? e.message : 'Could not load files');
            })
            .finally(() => {
                if (!cancelled) setListLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, conversationId, filesListVersion]);

    const uploadedRows: ListFileRow[] = useMemo(
        () =>
            uploadedFiles.map((f) => {
                const visual = visualForUploadedFile(f.fileName, f.fileType);
                return {
                    item: {
                        kind: 'file',
                        id: f.id,
                        label: f.fileName,
                        mimeType: f.fileType,
                        sizeBytes: f.fileSize,
                    },
                    sizeLabel: formatBytes(f.fileSize),
                    Icon: visual.Icon,
                    colorClass: visual.colorClass,
                };
            }),
        [uploadedFiles],
    );

    const artifactRows: ListFileRow[] = useMemo(
        () =>
            artifacts.map((a) => {
                const label = artifactDisplayFilename(a.title, a.type);
                const mime = artifactMimeType(a.type);
                const visual = visualForArtifact(a.type, label);
                const sizeBytes =
                    a.fileSize != null && Number.isFinite(a.fileSize) ? a.fileSize : undefined;
                const versionSuffix =
                    a.versionNumber > 1 ? ` · v${a.versionNumber}` : '';
                return {
                    item: {
                        kind: 'artifact',
                        id: a.id,
                        label,
                        mimeType: mime,
                        artifactType: a.type,
                        sizeBytes,
                    },
                    sizeLabel:
                        sizeBytes != null
                            ? `${formatBytes(sizeBytes)}${versionSuffix}`
                            : a.versionNumber > 1
                              ? `v${a.versionNumber}`
                              : 'AI',
                    Icon: visual.Icon,
                    colorClass: visual.colorClass,
                };
            }),
        [artifacts],
    );

    const totalCount = uploadedRows.length + artifactRows.length;
    const activeKey = selectedItem ? canvasItemKey(selectedItem) : null;

    const selectItem = useCallback(
        (item: CanvasSelectedItem) => {
            setSelectedItem(item);
            setActiveTab('viewer');
        },
        [setSelectedItem, setActiveTab],
    );

    useEffect(() => {
        if (!selectedItem || activeTab !== 'viewer') {
            revokeObjectUrl();
            setTextLines([]);
            setDocxParagraphs([]);
            setSpreadsheetTable(null);
            setPreviewTruncated(false);
            setViewerError(null);
            setViewerLoading(false);
            return;
        }

        let cancelled = false;
        setViewerLoading(true);
        setViewerError(null);
        setTextLines([]);
        setDocxParagraphs([]);
        setSpreadsheetTable(null);
        setPreviewTruncated(false);
        revokeObjectUrl();
        setCopyDone(false);

        const mime =
            selectedItem.mimeType ??
            (selectedItem.kind === 'artifact' && selectedItem.artifactType
                ? artifactMimeType(selectedItem.artifactType)
                : 'application/octet-stream');
        const kind =
            selectedItem.kind === 'file'
                ? visualForUploadedFile(selectedItem.label, mime).viewerKind
                : visualForArtifact(selectedItem.artifactType ?? '', selectedItem.label).viewerKind;
        setViewerKind(kind);

        const load = async () => {
            try {
                const blob =
                    selectedItem.kind === 'file'
                        ? await downloadFile(selectedItem.id)
                        : await downloadArtifact(selectedItem.id);
                if (cancelled) return;

                const typedBlob =
                    mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob;

                if (kind === 'image' || kind === 'pdf' || kind === 'html') {
                    const url = URL.createObjectURL(typedBlob);
                    objectUrlRef.current = url;
                    setObjectUrl(url);
                    return;
                }

                if (kind === 'code' || kind === 'json' || kind === 'readme') {
                    const text = await typedBlob.text();
                    if (cancelled) return;
                    const lines = text.split(/\r?\n/);
                    setTextLines(lines.length ? lines : ['']);
                    return;
                }

                if (kind === 'docx' || kind === 'spreadsheet') {
                    const lowerName = selectedItem.label.toLowerCase();
                    const lowerMime = mime.toLowerCase();
                    const format =
                        kind === 'docx'
                            ? 'docx'
                            : lowerName.endsWith('.csv') || lowerMime.includes('text/csv')
                              ? 'csv'
                              : 'xlsx';
                    const result = await previewOfficeBlob(typedBlob, format);
                    if (cancelled) return;
                    if (result.kind === 'docx') {
                        setDocxParagraphs(result.paragraphs);
                        setPreviewTruncated(result.truncated);
                    } else {
                        setSpreadsheetTable(result.table);
                        setPreviewTruncated(result.table.truncated);
                    }
                    return;
                }

                setViewerKind('binary');
            } catch (e) {
                if (!cancelled) {
                    setViewerError(e instanceof Error ? e.message : 'Could not load preview');
                }
            } finally {
                if (!cancelled) setViewerLoading(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
            revokeObjectUrl();
        };
    }, [selectedItem, activeTab, revokeObjectUrl]);

    const handleDownload = useCallback(async () => {
        if (!selectedItem) return;
        try {
            const blob =
                selectedItem.kind === 'file'
                    ? await downloadFile(selectedItem.id)
                    : await downloadArtifact(selectedItem.id);
            const mime = selectedItem.mimeType ?? blob.type;
            const typedBlob = mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob;
            const url = URL.createObjectURL(typedBlob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = selectedItem.label;
            anchor.rel = 'noopener';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 500);
        } catch (e) {
            setViewerError(e instanceof Error ? e.message : 'Download failed');
        }
    }, [selectedItem]);

    const handleCopy = useCallback(async () => {
        if (!selectedItem) return;
        try {
            let text = '';
            if (docxParagraphs.length > 0) {
                text = docxParagraphs.join('\n\n');
            } else if (spreadsheetTable?.rows.length) {
                text = spreadsheetTable.rows.map((row) => row.join('\t')).join('\n');
            } else if (textLines.length > 0) {
                text = textLines.join('\n');
            } else {
                text = selectedItem.label;
            }
            await navigator.clipboard.writeText(text);
            setCopyDone(true);
            window.setTimeout(() => setCopyDone(false), 2000);
        } catch {
            setViewerError('Could not copy to clipboard');
        }
    }, [selectedItem, textLines, docxParagraphs, spreadsheetTable]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleResize = () => {
            setIsMobile(window.innerWidth < 1024);
            const minWidth = getMinWidthPx();
            const maxWidth = Math.round(window.innerWidth * 0.85);
            setCanvasWidth((prev) => Math.min(Math.max(prev, minWidth), maxWidth));
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [getMinWidthPx]);

    const startResize = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            const onMove = (moveEvent: MouseEvent) => {
                const panel = panelRef.current;
                if (!panel || typeof window === 'undefined') return;
                const rect = panel.getBoundingClientRect();
                const rawNextWidth = rect.right - moveEvent.clientX;
                const minWidth = getMinWidthPx();
                const maxWidth = Math.round(window.innerWidth * 0.85);
                const nextWidth = Math.min(Math.max(rawNextWidth, minWidth), maxWidth);
                setCanvasWidth(nextWidth);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        },
        [getMinWidthPx],
    );

    const renderFileRow = (row: ListFileRow) => {
        const isActive = activeKey === canvasItemKey(row.item);
        const Icon = row.Icon;
        return (
            <button
                key={canvasItemKey(row.item)}
                type="button"
                onClick={() => selectItem(row.item)}
                className={`flex w-full items-center gap-2 rounded-md px-[10px] py-[5px] pl-[30px] text-left text-[12px] transition-colors ${
                    isActive
                        ? 'bg-[rgba(151,109,248,0.1)] text-[#c4b5fd]'
                        : 'text-white/50 hover:bg-white/[0.04] hover:text-white/70'
                }`}
            >
                <Icon className={`h-4 w-4 shrink-0 ${row.colorClass}`} />
                <span className="flex-1 truncate font-medium">{row.item.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-white/20">{row.sizeLabel}</span>
            </button>
        );
    };

    if (!isOpen) return null;

    const ViewerIcon = iconForViewerKind(viewerKind);
    const categoryLabel =
        selectedItem?.kind === 'artifact' ? 'Artifacts' : selectedItem ? 'Uploaded' : '';

    return (
        <div
            ref={panelRef}
            className={
                isMobile
                    ? 'fixed inset-0 z-[70] flex h-[100dvh] w-full flex-col overflow-hidden bg-chat'
                    : 'relative z-[50] my-4 mr-4 flex h-[calc(100vh-2rem)] min-w-[10vw] flex-col overflow-hidden border-l border-border-subtle bg-chat shadow-2xl'
            }
            style={isMobile ? undefined : { width: `${canvasWidth}px` }}
        >
            {!isMobile && (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize canvas width"
                    onMouseDown={startResize}
                    className="absolute left-0 top-0 z-30 h-full w-[6px] -translate-x-1/2 cursor-col-resize bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border-subtle hover:after:bg-[#976df8]/40"
                />
            )}
            <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-border-subtle bg-chat/80 px-3">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setActiveTab('viewer')}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${
                            activeTab === 'viewer'
                                ? 'bg-accent/10 text-accent'
                                : 'text-text-faint hover:bg-surface-2 hover:text-text-muted'
                        }`}
                    >
                        <File className="h-3.5 w-3.5" />
                        <span>Viewer</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('files')}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${
                            activeTab === 'files'
                                ? 'bg-accent/10 text-accent'
                                : 'text-text-faint hover:bg-surface-2 hover:text-text-muted'
                        }`}
                    >
                        <Folder className="h-3.5 w-3.5" />
                        <span>Files</span>
                        <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] leading-none text-text-faint">
                            {totalCount}
                        </span>
                    </button>
                </div>
                <button
                    type="button"
                    onClick={onCloseAction}
                    title="Close canvas"
                    className="rounded-md border border-border-default px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-all hover:border-border-strong hover:bg-surface-2 hover:text-text-primary"
                >
                    Close Canvas
                </button>
            </div>

            {activeTab === 'files' ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex-1 overflow-y-auto">
                        {listLoading ? (
                            <div className="flex items-center justify-center gap-2 py-12 text-white/30">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-[12px]">Loading files…</span>
                            </div>
                        ) : null}
                        {listError ? (
                            <p className="px-4 py-3 text-[12px] text-red-400/90" role="alert">
                                {listError}
                            </p>
                        ) : null}

                        <div className="px-[14px] pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/20">
                            Uploaded Files
                        </div>
                        <div className="space-y-0.5 px-2">
                            {!listLoading && uploadedRows.length === 0 ? (
                                <p className="px-[10px] py-2 text-[11px] text-white/25">No uploaded files yet</p>
                            ) : (
                                uploadedRows.map(renderFileRow)
                            )}
                        </div>

                        <div className="mt-1 px-[14px] pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/20">
                            Artifacts
                        </div>
                        <div className="space-y-0.5 px-2 pb-2">
                            {!listLoading && artifactRows.length === 0 ? (
                                <p className="px-[10px] py-2 text-[11px] text-white/25">No generated artifacts yet</p>
                            ) : (
                                artifactRows.map(renderFileRow)
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="doc-viewer flex min-h-0 flex-1 flex-col">
                    {!selectedItem ? (
                        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-white/25">
                            <Folder className="h-10 w-10 opacity-40" />
                            <p className="text-[13px]">Select a file from the Files tab</p>
                            <button
                                type="button"
                                onClick={() => setActiveTab('files')}
                                className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-white/50 hover:bg-white/[0.04]"
                            >
                                Browse files
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.05] bg-white/[0.015] px-3 py-2">
                                <div className="min-w-0 overflow-hidden text-[11px] text-white/30">
                                    <span>{categoryLabel}</span>
                                    <span className="mx-1 text-white/12">/</span>
                                    <span className="font-medium text-white/60">{selectedItem.label}</span>
                                </div>
                                <div className="flex items-center gap-0.5">
                                    <button
                                        type="button"
                                        title={copyDone ? 'Copied' : 'Copy contents'}
                                        onClick={() => void handleCopy()}
                                        className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-white/20 transition-all hover:bg-white/[0.05] hover:text-white/50"
                                    >
                                        <Copy className="h-3 w-3" />
                                    </button>
                                    <button
                                        type="button"
                                        title="Download file"
                                        onClick={() => void handleDownload()}
                                        className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-white/20 transition-all hover:bg-white/[0.05] hover:text-white/50"
                                    >
                                        <Download className="h-3 w-3" />
                                    </button>
                                </div>
                            </div>

                            <div className="relative flex-1 overflow-y-auto bg-[#0a0a0d]">
                                {viewerLoading ? (
                                    <div className="flex h-full items-center justify-center gap-2 text-white/30">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        <span className="text-[12px]">Loading preview…</span>
                                    </div>
                                ) : null}
                                {viewerError ? (
                                    <p className="px-4 py-3 text-[12px] text-red-400/90" role="alert">
                                        {viewerError}
                                    </p>
                                ) : null}

                                {!viewerLoading && !viewerError && viewerKind === 'binary' ? (
                                    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center text-white/30">
                                        <ViewerIcon className="h-12 w-12 opacity-50" />
                                        <p className="text-[13px] text-white/50">{selectedItem.label}</p>
                                        <p className="text-[11px]">Preview is not available for this file type.</p>
                                        <button
                                            type="button"
                                            onClick={() => void handleDownload()}
                                            className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/[0.08]"
                                        >
                                            <Download className="h-3.5 w-3.5" />
                                            Download
                                        </button>
                                    </div>
                                ) : null}

                                {!viewerLoading &&
                                    !viewerError &&
                                    (viewerKind === 'code' || viewerKind === 'json' || viewerKind === 'readme') && (
                                        <div className="py-[14px] font-mono text-[12px] leading-[1.75]">
                                            {textLines.map((line, idx) => (
                                                <div
                                                    key={`${idx}-${line.slice(0, 8)}`}
                                                    className="flex px-4 hover:bg-white/[0.02]"
                                                >
                                                    <span className="w-8 shrink-0 pr-4 text-right text-[11px] text-white/12">
                                                        {idx + 1}
                                                    </span>
                                                    <span className="flex-1 break-words text-[#c4c4cc]">{line}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                {!viewerLoading && !viewerError && viewerKind === 'pdf' && objectUrl ? (
                                    <iframe
                                        title={selectedItem.label}
                                        src={objectUrl}
                                        className="h-full min-h-[400px] w-full border-0 bg-white"
                                    />
                                ) : null}

                                {!viewerLoading && !viewerError && viewerKind === 'html' && objectUrl ? (
                                    <iframe
                                        title={selectedItem.label}
                                        src={objectUrl}
                                        sandbox="allow-same-origin"
                                        className="h-full min-h-[400px] w-full border-0 bg-white"
                                    />
                                ) : null}

                                {!viewerLoading && !viewerError && viewerKind === 'image' && objectUrl ? (
                                    <div className="flex flex-col items-center justify-center gap-3 p-6">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={objectUrl}
                                            alt={selectedItem.label}
                                            className="max-h-[70vh] max-w-full rounded-lg object-contain"
                                        />
                                        <span className="text-[11px] text-white/30">{selectedItem.label}</span>
                                    </div>
                                ) : null}

                                {!viewerLoading && !viewerError && viewerKind === 'docx' ? (
                                    <div className="px-5 py-4">
                                        {previewTruncated ? (
                                            <p className="mb-3 text-[11px] text-amber-400/80">
                                                Showing first {docxParagraphs.length} paragraphs. Download for full
                                                document.
                                            </p>
                                        ) : null}
                                        <div className="space-y-3 text-[13px] leading-relaxed text-[#d4d4dc]">
                                            {docxParagraphs.map((para, idx) => (
                                                <p key={`docx-p-${idx}`} className="whitespace-pre-wrap">
                                                    {para}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {!viewerLoading && !viewerError && viewerKind === 'spreadsheet' && spreadsheetTable ? (
                                    <div className="p-3">
                                        {previewTruncated ? (
                                            <p className="mb-2 px-1 text-[11px] text-amber-400/80">
                                                Showing first {spreadsheetTable.rows.length} rows and{' '}
                                                {spreadsheetTable.rows[0]?.length ?? 0} columns. Download for full
                                                sheet.
                                            </p>
                                        ) : null}
                                        <div className="overflow-auto rounded-lg border border-white/[0.06]">
                                            <table className="min-w-full border-collapse text-[12px]">
                                                <thead>
                                                    <tr className="bg-white/[0.04]">
                                                        <th className="sticky left-0 z-10 border border-white/[0.06] bg-[#121218] px-2 py-1.5 text-[10px] font-medium text-white/25" />
                                                        {(spreadsheetTable.rows[0] ?? []).map((_, colIdx) => (
                                                            <th
                                                                key={`col-h-${colIdx}`}
                                                                className="border border-white/[0.06] px-2 py-1.5 text-left text-[10px] font-medium text-white/40"
                                                            >
                                                                {columnLabel(colIdx)}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {spreadsheetTable.rows.map((row, rowIdx) => (
                                                        <tr key={`row-${rowIdx}`} className="hover:bg-white/[0.02]">
                                                            <td className="sticky left-0 z-10 border border-white/[0.06] bg-[#0f0f14] px-2 py-1 text-center font-mono text-[10px] text-white/25">
                                                                {rowIdx + 1}
                                                            </td>
                                                            {row.map((cell, colIdx) => (
                                                                <td
                                                                    key={`cell-${rowIdx}-${colIdx}`}
                                                                    className="max-w-[200px] truncate border border-white/[0.06] px-2 py-1 text-[#c4c4cc]"
                                                                    title={cell}
                                                                >
                                                                    {cell || '\u00a0'}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex shrink-0 items-center justify-between border-t border-white/[0.04] bg-white/[0.01] px-3 py-[5px] font-mono text-[10px] text-white/20">
                                <span>
                                    {viewerStatusLabel(viewerKind, {
                                        lineCount:
                                            viewerKind === 'docx'
                                                ? docxParagraphs.length
                                                : textLines.length,
                                        table: spreadsheetTable ?? undefined,
                                    })}
                                </span>
                                <span>
                                    {selectedItem.sizeBytes != null
                                        ? formatBytes(selectedItem.sizeBytes)
                                        : selectedItem.kind === 'artifact'
                                          ? 'Generated'
                                          : ''}
                                </span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
