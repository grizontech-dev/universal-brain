'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, ExternalLink, FileCode2, FileJson, FileType2 } from 'lucide-react';
import { CodeCanvas } from './CodeCanvas';

interface SplitPreviewProps {
    code: string;
    language: string;
    isStreaming?: boolean;
    onChange?: (val: string) => void;
}

type EditorFile = 'html' | 'css' | 'js';

const DEFAULT_HTML = `<!doctype html>
<html>
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Preview App</title>
    </head>
    <body>
        <div id="app">Hello from Grizon Render</div>
    </body>
</html>`;

const DEFAULT_CSS = `* {
    box-sizing: border-box;
}

body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
}

#app {
    min-height: 100vh;
    display: grid;
    place-items: center;
}`;

const DEFAULT_JS = `const root = document.getElementById('app');

if (root) {
    root.innerHTML = '<h1>Build your app and click Preview</h1>';
}`;

const FILE_MARKERS = {
        html: '<!-- FILE: index.html -->',
        css: '/* FILE: styles.css */',
        js: '/* FILE: script.js */',
};

function extractSection(source: string, startMarker: string, endMarker?: string): string {
        const start = source.indexOf(startMarker);
        if (start === -1) return '';

        const bodyStart = start + startMarker.length;
        const tail = source.slice(bodyStart);
        if (!endMarker) return tail.trim();

        const endIndex = tail.indexOf(endMarker);
        return (endIndex === -1 ? tail : tail.slice(0, endIndex)).trim();
}

function parseEditorFiles(source: string, language: string) {
        const raw = (source || '').trim();
        if (!raw) {
                return { html: DEFAULT_HTML, css: DEFAULT_CSS, js: DEFAULT_JS };
        }

        const hasMarkers = raw.includes(FILE_MARKERS.html) && raw.includes(FILE_MARKERS.css) && raw.includes(FILE_MARKERS.js);
        if (hasMarkers) {
                const html = extractSection(raw, FILE_MARKERS.html, FILE_MARKERS.css) || DEFAULT_HTML;
                const css = extractSection(raw, FILE_MARKERS.css, FILE_MARKERS.js) || DEFAULT_CSS;
                const js = extractSection(raw, FILE_MARKERS.js) || DEFAULT_JS;
                return { html, css, js };
        }

        const isHtmlLike = /<html|<body|<!doctype/i.test(raw) || language === 'html';
        if (isHtmlLike) {
                return { html: raw, css: DEFAULT_CSS, js: DEFAULT_JS };
        }

        return { html: DEFAULT_HTML, css: DEFAULT_CSS, js: raw };
}

function buildStoredBundle(files: { html: string; css: string; js: string }) {
        return `${FILE_MARKERS.html}\n${files.html}\n\n${FILE_MARKERS.css}\n${files.css}\n\n${FILE_MARKERS.js}\n${files.js}`;
}

function buildPreviewDocument(files: { html: string; css: string; js: string }) {
    const trimmedHtml = files.html.trim();
    const hasHtmlTag = /<html[\s>]/i.test(trimmedHtml);

    if (hasHtmlTag) {
        // Keep index.html as source of truth.
        // Only replace referenced local files (styles.css / script.js), like a lightweight live-server mapping.
        const withMappedCss = trimmedHtml.replace(
            /<link[^>]*href=["']\.\/??styles\.css["'][^>]*>/gi,
            `<style>${files.css}</style>`
        ).replace(
            /<link[^>]*href=["']styles\.css["'][^>]*>/gi,
            `<style>${files.css}</style>`
        );

        const withMappedJs = withMappedCss.replace(
            /<script[^>]*src=["']\.\/??script\.js["'][^>]*><\/script>/gi,
            `<script>${files.js}</script>`
        ).replace(
            /<script[^>]*src=["']script\.js["'][^>]*><\/script>/gi,
            `<script>${files.js}</script>`
        );

        return withMappedJs;
    }

        return `<!doctype html>
<html>
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>${files.css}</style>
    </head>
    <body>
        ${trimmedHtml}
        <script>${files.js}</script>
    </body>
</html>`;
}

export function SplitPreview({ code, language, isStreaming, onChange }: SplitPreviewProps) {
    const [activeFile, setActiveFile] = useState<EditorFile>('html');
    const [showPreview, setShowPreview] = useState(false);
    const [files, setFiles] = useState(() => parseEditorFiles(code, language));
    const onChangeRef = useRef(onChange);
    const lastEmittedBundleRef = useRef<string>(buildStoredBundle(parseEditorFiles(code, language)));
    const suppressNextEmitRef = useRef(false);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        // Parent often feeds back exactly what we emitted; skip to avoid feedback loops.
        // We use a normalized comparison to handle whitespace/ordering differences.
        if (code === lastEmittedBundleRef.current) return;

        const next = parseEditorFiles(code, language);
        const nextBundle = buildStoredBundle(next);

        if (nextBundle === lastEmittedBundleRef.current) return;

        setFiles((prev) => {
            const prevBundle = buildStoredBundle(prev);
            
            // If the incoming code logically parses to exactly what we already have, do nothing.
            if (prevBundle === nextBundle) {
                return prev;
            }

            // External content changed: sync editor, but suppress immediate emission back.
            suppressNextEmitRef.current = true;
            return next;
        });
    }, [code, language]);

    const activeLanguage = activeFile === 'html' ? 'html' : activeFile === 'css' ? 'css' : 'javascript';
    const activeCode = activeFile === 'html' ? files.html : activeFile === 'css' ? files.css : files.js;

    const storedBundle = useMemo(() => buildStoredBundle(files), [files]);
    const previewDocument = useMemo(() => buildPreviewDocument(files), [files]);

    useEffect(() => {
        if (suppressNextEmitRef.current) {
            suppressNextEmitRef.current = false;
            lastEmittedBundleRef.current = storedBundle;
            return;
        }

        if (lastEmittedBundleRef.current === storedBundle) {
            return;
        }

        lastEmittedBundleRef.current = storedBundle;
        onChangeRef.current?.(storedBundle);
    }, [storedBundle]);

    const openPreviewInBrowser = () => {
        const blob = new Blob([previewDocument], { type: 'text/html' });
        const previewUrl = URL.createObjectURL(blob);
        window.open(previewUrl, '_blank', 'noopener,noreferrer');

        // Keep URL alive briefly so external tab can fully load.
        window.setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
    };

    const updateActiveFile = (value: string) => {
        setFiles((prev) => {
            return {
                ...prev,
                ...(activeFile === 'html' ? { html: value } : activeFile === 'css' ? { css: value } : { js: value }),
            };
        });
    };

    return (
        <div className="flex-1 flex min-h-0 bg-[#050505] overflow-hidden">
            <div className="w-36 lg:w-40 shrink-0 border-r border-white/5 bg-[#08080c] p-2.5">
                <div className="mb-3 px-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">Render Files</div>
                <div className="space-y-1">
                    <button
                        onClick={() => setActiveFile('html')}
                        className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold transition-all ${activeFile === 'html' ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        <FileType2 size={13} />
                        index.html
                    </button>
                    <button
                        onClick={() => setActiveFile('css')}
                        className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold transition-all ${activeFile === 'css' ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        <FileJson size={13} />
                        styles.css
                    </button>
                    <button
                        onClick={() => setActiveFile('js')}
                        className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold transition-all ${activeFile === 'js' ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white/80'}`}
                    >
                        <FileCode2 size={13} />
                        script.js
                    </button>
                </div>
            </div>

            <div className="w-0 flex-1 flex flex-col min-h-0">
                <div className="h-10 px-4 flex items-center justify-between border-b border-white/[0.03] bg-white/[0.01] shrink-0">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">{activeFile === 'html' ? 'index.html' : activeFile === 'css' ? 'styles.css' : 'script.js'}</div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">Editor</div>
                </div>
                <div className="flex-1 min-h-0 min-w-0 relative">
                    <div className="absolute inset-0 overflow-hidden">
                        <CodeCanvas
                            content={activeCode}
                            language={activeLanguage}
                            isStreaming={isStreaming}
                            onChange={updateActiveFile}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
