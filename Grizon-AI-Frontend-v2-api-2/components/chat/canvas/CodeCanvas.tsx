'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { useCanvas } from '@/context/CanvasContext';

interface CodeCanvasProps {
    content?: string;
    language?: string;
    isStreaming?: boolean;
    readOnly?: boolean;
    onChange?: (value: string) => void;
    isDocument?: boolean;
}

export function CodeCanvas({ content, language = 'javascript', isStreaming, readOnly, onChange, isDocument }: CodeCanvasProps) {
    const { bufferedContent } = useCanvas();
    const currentCode = typeof content === 'string' ? content : (bufferedContent || '');
    const monaco = useMonaco();
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);
    const layoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const forceEditorLayout = useCallback(() => {
        const editor = editorRef.current;
        if (!editor || !containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        editor.layout({ width: rect.width, height: rect.height });

        if (layoutTimerRef.current) {
            clearTimeout(layoutTimerRef.current);
        }

        layoutTimerRef.current = setTimeout(() => {
            if (containerRef.current) {
                const r = containerRef.current.getBoundingClientRect();
                editor.layout({ width: r.width, height: r.height });
            }
            layoutTimerRef.current = null;
        }, 100);
    }, []);

    const enforceWrapOptions = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) return;

        editor.updateOptions({
            readOnly: readOnly || isStreaming,
            wordWrap: 'on',
            wrappingIndent: 'same',
            wrappingStrategy: 'simple',
            scrollbar: {
                horizontal: 'hidden',
                vertical: 'visible',
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 0,
                useShadows: false,
            },
        });

        forceEditorLayout();
    }, [forceEditorLayout]);

    useEffect(() => {
        if (monaco) {
            try {
                monaco.editor.defineTheme('grizon-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [
                        { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
                        { token: 'keyword', foreground: 'bd93f9' },
                        { token: 'string', foreground: 'f1fa8c' },
                    ],
                    colors: {
                        'editor.background': '#0c0c0f',
                        'editor.foreground': '#f8f8f2',
                        'editor.lineHighlightBackground': '#1a1a22',
                        'editorCursor.foreground': '#bd93f9',
                        'editorLineNumber.foreground': '#4d4d4d',
                        'editorIndentGuide.background': '#282a36',
                        'scrollbarSlider.background': '#bd93f920',
                        'scrollbarSlider.hoverBackground': '#bd93f940',
                        'scrollbarSlider.activeBackground': '#bd93f960',
                    }
                });
                monaco.editor.setTheme('grizon-dark');

                // Enable richer JS/TS intellisense in the canvas editor.
                const tsLang = (monaco.languages as any).typescript;

                tsLang.javascriptDefaults.setCompilerOptions({
                    allowNonTsExtensions: true,
                    checkJs: true,
                    target: tsLang.ScriptTarget.ES2021,
                    module: tsLang.ModuleKind.ESNext,
                    moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
                    lib: ['es2021', 'dom', 'dom.iterable'],
                });
                tsLang.javascriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: false,
                    noSyntaxValidation: false,
                });
                tsLang.typescriptDefaults.setCompilerOptions({
                    target: tsLang.ScriptTarget.ES2021,
                    module: tsLang.ModuleKind.ESNext,
                    moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
                    lib: ['es2021', 'dom', 'dom.iterable'],
                });
                tsLang.typescriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: false,
                    noSyntaxValidation: false,
                });
            } catch (err) {
                console.warn('Monaco theme setup failed', err);
            }
        }
    }, [monaco]);

    useEffect(() => {
        const editor = editorRef.current;
        const monacoInstance = monacoRef.current;
        if (!editor || !monacoInstance) return;

        const model = editor.getModel();
        if (!model) return;

        const currentModelLanguage = model.getLanguageId();
        if (currentModelLanguage !== language) {
            monacoInstance.editor.setModelLanguage(model, language);
        }

        // Disable validation for non-JS/TS languages to avoid "red lines" in Python/Java/etc.
        const isWebLang = language === 'javascript' || language === 'typescript';
        if (monacoInstance.languages.typescript) {
            monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
                noSemanticValidation: !isWebLang,
                noSyntaxValidation: !isWebLang,
            });
            monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                noSemanticValidation: !isWebLang,
                noSyntaxValidation: !isWebLang,
            });
        }

        enforceWrapOptions();
    }, [language, enforceWrapOptions]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            enforceWrapOptions();
        }, 100);
        return () => clearTimeout(timeout);
    }, [readOnly, isStreaming, currentCode, language, enforceWrapOptions]);

    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        
        const observer = new ResizeObserver(() => {
            const editor = editorRef.current;
            if (editor && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                editor.updateOptions({ wordWrap: 'on' }); // Force re-eval
                editor.layout({ width: rect.width, height: rect.height });
            }
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        return () => {
            if (layoutTimerRef.current) {
                clearTimeout(layoutTimerRef.current);
            }
        };
    }, []);

    return (
        <div 
            ref={containerRef}
            className="relative w-full h-full min-w-0 bg-[#0c0c0f] font-mono shadow-inner border border-white/5 rounded-lg overflow-hidden group flex flex-col"
        >
            <div className="flex-1 w-full min-w-0 min-h-0 relative overflow-hidden">
                <Editor
                    height="100%"
                    width="100%"
                    language={language}
                    value={currentCode}
                    theme="grizon-dark"
                    onMount={(editor, monacoInstance) => {
                        editorRef.current = editor;
                        monacoRef.current = monacoInstance;
                        enforceWrapOptions();
                        forceEditorLayout();
                        // Immediate second layout to fix initial flexbox quirks
                        setTimeout(() => forceEditorLayout(), 100);
                    }}
                    options={{
                        readOnly: readOnly || isStreaming,
                        domReadOnly: false,
                        contextmenu: true,
                        copyWithSyntaxHighlighting: true,
                        minimap: { enabled: false },
                        fontSize: 14,
                        lineNumbers: 'on',
                        roundedSelection: true,
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        fixedOverflowWidgets: true,
                        padding: { top: 20, bottom: 20 },
                        cursorBlinking: 'smooth',
                        smoothScrolling: true,
                        wordWrap: 'on',
                        wrappingIndent: 'same',
                        wrappingStrategy: 'simple',
                        quickSuggestions: {
                            other: true,
                            comments: false,
                            strings: true,
                        },
                        suggestOnTriggerCharacters: true,
                        acceptSuggestionOnEnter: 'on',
                        inlineSuggest: { enabled: true },
                        snippetSuggestions: 'inline',
                        tabCompletion: 'on',
                        wordBasedSuggestions: 'matchingDocuments',
                        parameterHints: { enabled: true },
                        lineNumbersMinChars: 3,
                        scrollbar: {
                            vertical: 'visible',
                            horizontal: 'hidden',
                            verticalScrollbarSize: 10,
                            horizontalScrollbarSize: 0,
                            useShadows: false,
                        },
                        overviewRulerLanes: 0,
                        hideCursorInOverviewRuler: true,
                        guides: {
                            indentation: true
                        },
                        matchBrackets: 'always',
                    }}
                    onChange={(v) => onChange?.(v || '')}
                />
            </div>
            {isStreaming && (
                <div className="absolute bottom-6 right-6 z-[20] pointer-events-none animate-in fade-in zoom-in-95 duration-500">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/20 border border-purple-500/30 backdrop-blur-md">
                        <div className="relative w-2 h-2 rounded-full bg-purple-400">
                           <div className="absolute inset-0 w-full h-full rounded-full bg-purple-400 animate-ping opacity-75" />
                        </div>
                        <span className="text-[11px] font-bold text-purple-300 uppercase tracking-widest leading-none">AI STREAMING</span>
                    </div>
                </div>
            )}
        </div>
    );
}
