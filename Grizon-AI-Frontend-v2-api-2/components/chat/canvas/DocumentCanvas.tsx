'use client';

import React, { useEffect, useState } from 'react';
import { useCanvas } from '@/context/CanvasContext';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { Copy, Download, FileText, Loader2, FileDown } from 'lucide-react';
import mermaid from 'mermaid';

// Initialize mermaid
mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    themeVariables: {
        primaryColor: '#976df8',
        primaryTextColor: '#ffffff',
        primaryBorderColor: '#976df8',
        lineColor: '#ffffff40',
        secondaryColor: '#1e1e24',
        tertiaryColor: '#0f0f12',
        mainBkg: 'rgba(151, 109, 248, 0.05)',
        nodeBorder: 'rgba(151, 109, 248, 0.3)',
        clusterBkg: 'rgba(255, 255, 255, 0.02)',
        clusterBorder: 'rgba(255, 255, 255, 0.1)',
        defaultLinkColor: 'rgba(255, 255, 255, 0.2)',
        titleColor: '#ffffff',
        edgeLabelBackground: '#0a0a0d',
        nodeTextColor: '#ffffff',
        fontFamily: 'Inter, sans-serif',
    },
    flowchart: {
        htmlLabels: true,
        curve: 'basis',
    },
});

export function DocumentCanvas({ 
    content: propContent, 
    isStreaming,
    type = 'document',
    onChange
}: { 
    content?: string; 
    isStreaming?: boolean;
    type?: 'document' | 'report';
    onChange?: (content: string) => void;
}) {
    const { bufferedContent, activeArtifact } = useCanvas();
    const [wordCount, setWordCount] = useState(0);
    const [charCount, setCharCount] = useState(0);
    const lastAppliedContentRef = React.useRef<string>('');
    const [isGenerating, setIsGenerating] = useState(false);

    const rawContent = (propContent || activeArtifact?.content || bufferedContent || '').trim();

    const editor = useEditor({
        extensions: [
            StarterKit,
            Table.configure({ resizable: true }),
            TableRow,
            TableHeader,
            TableCell,
            Markdown,
        ],
        content: rawContent,
        editable: !isStreaming,
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: 'prose prose-invert prose-p:leading-relaxed prose-headings:break-words prose-p:break-words prose-li:break-words prose-td:break-words prose-pre:bg-[#0d0c14] prose-pre:border prose-pre:border-white/5 outline-none max-w-none min-h-full pb-20 focus:outline-none',
            },
        },
        onUpdate: ({ editor }) => {
            const text = editor.getText();
            setCharCount(text.length);
            setWordCount(text.split(/\s+/).filter((word: string) => word.length > 0).length);

            if (!isStreaming && editor.isFocused) {
                try {
                    const storage = editor.storage as any;
                    if (storage.markdown) {
                        const md = storage.markdown.getMarkdown();
                        if (md !== lastAppliedContentRef.current) {
                            lastAppliedContentRef.current = md;
                            onChange?.(md);
                        }
                    }
                } catch (err) {
                    console.warn('Failed to sync markdown change', err);
                }
            }
        }
    });

    // Sync editability when isStreaming changes
    useEffect(() => {
        if (editor && !editor.isDestroyed) {
            editor.setEditable(!isStreaming);
        }
    }, [editor, isStreaming]);

    // Handle Mermaid Rendering
    useEffect(() => {
        if (!editor || isStreaming) return;

        const renderMermaid = async () => {
            const elements = document.querySelectorAll('.ProseMirror pre code.language-mermaid');
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i] as HTMLElement;
                const chart = el.innerText;
                const id = `mermaid-canvas-${i}`;
                
                try {
                    if (el.dataset.rendered === 'true') continue;

                    const { svg } = await mermaid.render(id, chart);
                    const container = document.createElement('div');
                    container.className = 'mermaid-rendered my-8 flex justify-center p-6 bg-white/5 rounded-2xl border border-white/10';
                    container.innerHTML = svg;
                    
                    const pre = el.parentElement;
                    if (pre) {
                        pre.style.display = 'none';
                        pre.after(container);
                        el.dataset.rendered = 'true';
                    }
                } catch (err) {
                    console.error('Mermaid render error:', err);
                }
            }
        };

        const timeout = setTimeout(renderMermaid, 500);
        return () => clearTimeout(timeout);
    }, [editor, rawContent, isStreaming]);

    const cleanDocumentContent = (content: string) => {
        if (!content) return '';
        let cleaned = content.trim();

        // 1. Iterative Header Cleaning: Strip leading blocks until we find a "real" H1 header
        let safetyCounter = 0;
        while (safetyCounter < 5) { // Protect against infinite loops
            safetyCounter++;
            const headerIndex = cleaned.indexOf('# ');
            
            if (headerIndex === -1) {
                // No header yet. Check if the current block looks like a leak.
                const lower = cleaned.toLowerCase();
                const isDefiniteLeak = 
                    lower.includes("structural outline") || 
                    lower.includes("prompt echo") ||
                    lower.includes("temporal baseline") ||
                    lower.includes("hard boundaries") ||
                    lower.includes("tone") ||
                    lower.includes("structure the document") ||
                    lower.includes("constraints check") ||
                    lower.includes("review against") ||
                    lower.includes("systems-thinking") ||
                    lower.includes("bulleted list");
                    
                return isDefiniteLeak ? "" : cleaned;
            }

            // We found a header. Let's inspect the text BEFORE it and the HEADER ITSELF.
            const preHeaderText = cleaned.substring(0, headerIndex).toLowerCase();
            const headerLineEnd = cleaned.indexOf('\n', headerIndex);
            const headerLine = cleaned.substring(headerIndex, headerLineEnd === -1 ? cleaned.length : headerLineEnd).toLowerCase();
            
            const preHasLeak = 
                preHeaderText.includes("tone") || 
                preHeaderText.includes("structure") || 
                preHeaderText.includes("constraint") || 
                preHeaderText.includes("echo") || 
                preHeaderText.includes("temporal") || 
                preHeaderText.includes("baseline") ||
                preHeaderText.includes("analytical") ||
                preHeaderText.includes("systems-thinking") ||
                preHeaderText.includes("bulleted list");
                
            const headerIsFake = 
                headerLine.includes("[title]") || 
                headerLine.includes("title:") ||
                headerLine.includes("`") || 
                headerLine.includes("tone") ||
                headerLine.includes("structure") ||
                headerLine.trim() === "#" ||
                headerLine.trim() === "# .";

            if (preHasLeak || headerIsFake) {
                // This header or the text before it is a leak. Strip and look for the next one.
                cleaned = cleaned.substring(headerLineEnd === -1 ? cleaned.length : headerLineEnd).trim();
                if (!cleaned) return ""; 
                continue; 
            }
            
            // If we reach here, the current header (at headerIndex) is likely the real start.
            return cleaned.substring(headerIndex).trim();
        }

        return cleaned;
    };

    // DEBUG LOGGING AS REQUESTED BY USER
    useEffect(() => {
        if (rawContent) {
            const cleaned = cleanDocumentContent(rawContent);
            console.log('[DocumentCanvas] Raw Content Length:', rawContent.length);
            console.log('[DocumentCanvas] Cleaned Content Length:', cleaned.length);
            console.log('[DocumentCanvas] Raw Start:', rawContent.substring(0, 200) + '...');
            console.log('[DocumentCanvas] Cleaned Start:', cleaned.substring(0, 200) + '...');
        }
    }, [rawContent]);

    useEffect(() => {
        if (!editor) return;
        if (editor.isDestroyed) return;

        // Clean the content to remove leaked system instructions/constraints
        const effectiveContent = cleanDocumentContent(rawContent || '');

        if (lastAppliedContentRef.current !== effectiveContent) {
            lastAppliedContentRef.current = effectiveContent;
            
            try {
                if (isStreaming) {
                    editor.commands.setContent(effectiveContent, {
                        emitUpdate: false,
                        parseOptions: { preserveWhitespace: 'full' },
                    });
                } else if (!editor.isFocused) {
                    editor.commands.setContent(effectiveContent, { emitUpdate: false });
                }
            } catch (err) {
                console.warn('Tiptap sync error:', err);
            }
        }
    }, [rawContent, isStreaming, editor]);

    useEffect(() => {
        if (editor) {
            const text = editor.getText();
            setCharCount(text.length);
            setWordCount(text.split(/\s+/).filter((word: string) => word.length > 0).length);
        }
    }, [editor, rawContent]);

    const handleCopy = () => {
        if (editor) {
            try {
                const storage = editor.storage as any;
                if (storage.markdown) {
                    navigator.clipboard.writeText(storage.markdown.getMarkdown());
                }
            } catch (err) {
                console.warn('Failed to copy document content:', err);
            }
        }
    };

    const handleDownloadMd = () => {
        if (!editor || isStreaming) return;
        try {
            const storage = editor.storage as any;
            if (storage.markdown) {
                const md = storage.markdown.getMarkdown();
                const blob = new Blob([md], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${activeArtifact?.title || 'document'}.md`;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (err) {
            console.warn('Failed to download markdown:', err);
        }
    };

    const handlePrintPDF = () => {
        if (!editor || isStreaming) return;
        
        setIsGenerating(true);
        const title = activeArtifact?.title || 'Grizon Document';
        const element = document.querySelector('.printable-area') as HTMLElement;
        if (!element) {
            setIsGenerating(false);
            return;
        }

        const printClone = element.cloneNode(true) as HTMLElement;
        
        let iframe = document.getElementById('print-iframe') as HTMLIFrameElement;
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'print-iframe';
            iframe.style.position = 'absolute';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);
        }

        const doc = iframe.contentWindow?.document;
        if (!doc) {
            setIsGenerating(false);
            return;
        }

        doc.open();
        doc.write(`
            <html>
                <head>
                    <title>${title}</title>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
                        @page {
                            size: A4;
                            margin: 2cm;
                        }
                        body {
                            font-family: 'Inter', -apple-system, sans-serif;
                            line-height: 1.6;
                            color: #000;
                            margin: 0;
                            padding: 0;
                            background: white;
                        }
                        .document-wrap { padding: 0; }
                        h1 { font-size: 28pt; font-weight: 800; margin-bottom: 24pt; margin-top: 0; line-height: 1.1; color: #000; }
                        h2 { font-size: 20pt; font-weight: 700; margin-top: 28pt; margin-bottom: 14pt; border-bottom: 1.5pt solid #000; padding-bottom: 6pt; color: #000; }
                        h3 { font-size: 16pt; font-weight: 600; margin-top: 20pt; margin-bottom: 10pt; color: #000; }
                        p { margin-bottom: 14pt; font-size: 11.5pt; color: #333; }
                        ul, ol { padding-left: 24pt; margin-bottom: 14pt; }
                        li { margin-bottom: 7pt; font-size: 11.5pt; color: #333; }
                        table { width: 100%; border-collapse: collapse; margin-bottom: 24pt; table-layout: auto; }
                        th { background: #f8f9fa; border: 1pt solid #ccc; padding: 10pt; text-align: left; font-weight: 700; font-size: 10pt; text-transform: uppercase; }
                        td { border: 1pt solid #eee; padding: 10pt; text-align: left; font-size: 11pt; }
                        .mermaid-rendered { 
                            margin: 25pt 0; 
                            text-align: center; 
                            page-break-inside: avoid;
                        }
                        .mermaid-rendered svg { 
                            max-width: 100%; 
                            height: auto;
                            filter: brightness(0.8) contrast(1.2);
                        }
                        pre { display: none !important; }
                    </style>
                </head>
                <body>
                    <div class="document-wrap">
                        ${printClone.innerHTML}
                    </div>
                </body>
            </html>
        `);
        doc.close();

        setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setIsGenerating(false);
        }, 1000);
    };

    return (
        <div className="w-full h-full min-h-0 flex flex-col bg-[#0d0c14] text-white overflow-hidden relative no-print-container">
            <style jsx global>{`
                .printable-area .ProseMirror {
                    background: transparent !important;
                    color: white !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    overflow-wrap: anywhere !important;
                    word-break: break-word !important;
                }

                .printable-area .ProseMirror pre {
                    max-width: 100% !important;
                    overflow-x: auto !important;
                    overflow-y: hidden !important;
                    word-break: normal !important;
                    overflow-wrap: normal !important;
                }

                .printable-area .ProseMirror pre code {
                    white-space: pre !important;
                    word-break: normal !important;
                    overflow-wrap: normal !important;
                }

                .printable-area .ProseMirror h1 {
                    font-size: 2.5rem !important;
                    font-weight: 800 !important;
                    margin-bottom: 1.5rem !important;
                    line-height: 1.2 !important;
                    color: white !important;
                }
                .printable-area .ProseMirror h2 {
                    font-size: 1.85rem !important;
                    font-weight: 700 !important;
                    margin-top: 2rem !important;
                    margin-bottom: 1rem !important;
                    color: white !important;
                    border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                    padding-bottom: 0.5rem !important;
                }
                .printable-area .ProseMirror h3 {
                    font-size: 1.45rem !important;
                    font-weight: 600 !important;
                    margin-top: 1.5rem !important;
                    margin-bottom: 0.75rem !important;
                    color: white !important;
                }
                .printable-area .ProseMirror p {
                    font-size: 1.05rem !important;
                    line-height: 1.7 !important;
                    margin-bottom: 1.25rem !important;
                    color: rgba(255,255,255,0.8) !important;
                }
                .printable-area .ProseMirror ul, .printable-area .ProseMirror ol {
                    padding-left: 1.5rem !important;
                    margin-bottom: 1.25rem !important;
                }
                .printable-area .ProseMirror li {
                    margin-bottom: 0.5rem !important;
                }
            `}</style>

            <div className="min-h-14 py-2 bg-white/5 border-b border-white/5 flex items-center justify-between px-3 md:px-6 shrink-0 no-print">
                <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1 pr-2">
                    <div className="w-8 h-8 bg-purple-500/20 rounded flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-purple-400" />
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span
                            className="text-xs md:text-sm font-medium leading-tight truncate"
                            title={activeArtifact?.title || 'Untitled Document'}
                        >
                            {activeArtifact?.title || 'Untitled Document'}
                        </span>
                    </div>
                    {isStreaming && <Loader2 size={12} className="animate-spin text-white/40 ml-1 shrink-0" />}
                </div>

                <div className="flex items-center gap-1 md:gap-2 shrink-0">
                    <button 
                        onClick={handleCopy} 
                        disabled={isStreaming}
                        className="h-8 w-8 md:w-auto md:px-3 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded-md flex items-center justify-center md:gap-2 text-xs transition-colors font-medium"
                        title="Copy Markdown"
                    >
                        <Copy size={13} /> <span className="hidden md:inline">Copy</span>
                    </button>
                    <button 
                        onClick={handleDownloadMd} 
                        disabled={isStreaming}
                        className="h-8 w-8 md:w-auto md:px-3 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed rounded-md flex items-center justify-center md:gap-2 text-xs transition-colors font-medium"
                        title="Download Markdown"
                    >
                        <Download size={13} /> <span className="hidden md:inline">.MD</span>
                    </button>
                    <button 
                        onClick={handlePrintPDF} 
                        disabled={isStreaming || isGenerating}
                        className="relative h-8 px-2 md:px-4 text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-full flex items-center justify-center md:gap-2 text-[10px] md:text-xs transition-all font-bold overflow-hidden"
                        title="Download PDF"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 size={12} className="animate-spin" />
                                <span className="hidden md:inline">Processing...</span>
                            </>
                        ) : (
                            <>
                                <FileDown size={13} /> 
                                <span className="hidden md:inline">Download PDF</span>
                                <span className="md:hidden">PDF</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto w-full flex justify-center custom-scrollbar bg-[#0d0c14]">
                <div className="w-full max-w-[850px] bg-[#0d0c14] border-x border-white/5 md:border-white/10 min-h-full p-4 md:p-12 lg:p-16 shadow-2xl printable-area">
                     <EditorContent editor={editor} className="min-h-[300px] md:min-h-[500px]" />
                </div>
            </div>

            <div className="h-8 bg-[#0d0c14] border-t border-white/5 flex items-center justify-between px-3 md:px-6 text-[9px] md:text-[11px] font-medium text-white/40 shrink-0 uppercase tracking-wider no-print">
                <div className="flex items-center gap-2 md:gap-4">
                    <span>{wordCount} words</span>
                    <span className="hidden xs:inline">{charCount} chars</span>
                </div>
                <div className="flex items-center gap-2">
                    {isStreaming ? (
                        <>
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                            Streaming Content...
                        </>
                    ) : (
                        <>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Ready
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
