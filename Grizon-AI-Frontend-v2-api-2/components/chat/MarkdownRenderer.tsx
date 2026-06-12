"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, Terminal } from "lucide-react";
import MermaidRenderer from "./MermaidRenderer";
import type { ApiCitation } from "@/lib/chat-contracts";

interface MarkdownRendererProps {
    content: string;
    citations?: ApiCitation[];
    className?: string;
}

// Utility to extract text from complex React children (handles highlighted nodes)
const getCodeText = (children: React.ReactNode): string => {
    if (typeof children === 'string') return children;
    if (typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(getCodeText).join('');
    // @ts-ignore
    if (children?.props?.children) return getCodeText(children.props.children);
    return '';
};

const PLAIN_MARKDOWN_LANGS = new Set([
    'text',
    'plaintext',
    'ascii',
    'diagram',
    'flowchart',
    'mermaid',
]);

/** Heuristic: box-drawing, ASCII tables, state/flow style diagrams */
function isLikelyAsciiDiagram(code: string): boolean {
    if (!code.trim()) return false;
    // Box-drawing characters
    if (/[┌┐└┘├┤┬┴┼│═║╔╗╚╝╠╣╦╩╬]/.test(code)) return true;
    // Common ASCII art patterns
    if (/\+[-+]{3,}\+/.test(code)) return true; // plus-dash lines like +-----+
    if (/[\|]{3,}/.test(code)) return true; // multiple pipes
    if (/\+={3,}\+/.test(code)) return true; // box header
    
    const lines = code.split('\n');
    if (lines.length < 2) return false;
    
    let structural = 0;
    for (const line of lines) {
        const t = line.trimEnd();
        if (!t) continue;
        
        // Typical boxy line (only box-drawing or structural symbols, longer lines only)
        const boxy = /^[┌┐└┘├┤┬┴┼│═║╔╗╚╝╠╣╦╩╬\s\-|+=<>^v*#_:.()\[\]{}]+$/.test(t) && t.length >= 10;
        // Strong arrow/connection patterns
        const arrowy = /(---+>|===+>|\.{3}>|<-+---|<=+===|<{3}\.|\||\/|\\)/.test(t);
        
        if (boxy || arrowy) structural++;
    }
    
    // Stricter requirement for diagrams: at least 3 lines AND 40% of lines must look structural
    return structural >= 3 && (structural / lines.length >= 0.4);
}

// Custom code block component
const CodeBlock: React.FC<{
    children: React.ReactNode;
    className?: string;
    inline?: boolean;
}> = ({ children, className, inline }) => {

    // Get raw text content correctly
    const rawCode = getCodeText(children).replace(/\n$/, "");

    // Inline code
    if (inline) {
        return (
            <code className="px-1.5 py-0.5 bg-accent/10 rounded-md text-[0.9em] font-mono text-accent font-semibold">
                {children}
            </code>
        );
    }

    const fenceLang =
        className
            ?.split(/\s+/)
            .find((t) => t.startsWith('language-'))
            ?.slice('language-'.length) ?? '';

    const handleOpenInCanvas = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const event = new CustomEvent('openCodeInCanvas', {
            detail: { code: rawCode, language: fenceLang, shouldRun: true },
        });
        window.dispatchEvent(event);
    };

    const isDiagram = isLikelyAsciiDiagram(rawCode);
    const syntaxHighlighted = /\bhljs\b/.test(className || '');
    const showColoredTokens = syntaxHighlighted && !isDiagram;

    return (
        <div className="relative group my-2.5 w-full min-w-0 max-w-full overflow-hidden">
            {/* Action Bar */}
            <div className="absolute top-3 right-3 z-30 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex items-center gap-1.5 pointer-events-auto">
                <button
                    onClick={handleOpenInCanvas}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent text-[10px] font-bold transition-all active:scale-95 shadow-lg backdrop-blur-md"
                    title="Open in Code Canvas"
                >
                    <Terminal size={12} />
                    Open in Canvas
                </button>
            </div>
            
            <div className="rounded-2xl border border-white/10 bg-[#0a0a0c]/80 backdrop-blur-sm overflow-hidden shadow-2xl relative z-0">
                {fenceLang ? (
                    <div className="px-4 py-2 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">
                            {fenceLang}
                        </span>
                        {isDiagram && (
                            <span className="text-[9px] font-black text-accent/40 uppercase tracking-[0.2em]">
                                TEXTUAL DIAGRAM
                            </span>
                        )}
                    </div>
                ) : null}
                
                <pre className="max-w-full min-w-0 overflow-x-auto p-4 sm:p-5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent selection:bg-accent/30">
                    <code
                        className={`${className ?? ''} block min-w-full text-xs sm:text-[13px] font-mono font-normal text-white/90 ${
                            isDiagram ? 'whitespace-pre leading-[1.1] tracking-tighter w-max sm:w-auto lg:w-max' : 'whitespace-pre-wrap leading-relaxed break-all sm:break-normal overflow-wrap-anywhere'
                        } [font-variant-ligatures:none]`}
                    >
                        {showColoredTokens ? children : rawCode}
                    </code>
                </pre>
            </div>
        </div>
    );
};


export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
    content,
    citations = [],
    className = "",
}) => {
    // 1. ROOT PERMANENT FIX: Completely remove all <grizon-*> tags AND their hidden content.
    // This handles artifacts, documents, code blocks, sandboxes, renders, etc.
    // It also handles unclosed tags during streaming by matching until the end of the message.
    const cleanContent = content
        .replace(/^\s*xml\n/i, '') // Strip stray 'xml' header
        .replace(/<(grizon-\w+)(?:\s+[^>]*)?>[\s\S]*?(?:<\/\1>|$)/gi, '') // Generic tag + content removal
        .replace(/<\/grizon-\w+>/gi, '') // Cleanup stray closing tags
        .replace(/```json\s*{[\s\S]*?"version":[\s\S]*?}?\s*```/g, '') // Strip internal technical metadata
        
        // Anti-leak: Strip common system instruction phrases that models sometimes echo
        .replace(/(?:Adhere to strict communication protocols|Detailed architectural breakdown|Constraints Check:|tag containing the .* code)[\s\S]*?(?=\n|$)/gi, '')
        .replace(/^\d+\.\s+Adhere to[\s\S]*?(?=\n|$)/gm, '')
        
        // Only strip fences if they wrap the entire message (often added by some models)
        .replace(/^```(xml|markdown|text|json)?\n([\s\S]*)\n```$/i, '$2') 
        
        .replace(/\n{3,}/g, '\n\n') // Collapse excessive newlines
        .replace(/\n+(?=#)/g, '\n\n') // Standardize to exactly one blank line before headers
        .replace(/(?<=#+.*)\n+/g, '\n') // FORCE single newline after headers (tighten body text)
        .replace(/^#+\s+/gm, (match) => match) // Preserve headers
        .trim();

    // 2. Anti-Echo Logic: Strip meta-instructions (Context, Structure, Constraints, etc.) 
    // that models sometimes leak into the document canvas.
    const strippedContent = cleanContent.replace(/^[\s\S]*?(?=#\s+)/i, (match) => {
        const lower = match.toLowerCase();
        const hasLeak = 
            lower.includes("context") || 
            lower.includes("document structure") || 
            lower.includes("structural outline") || 
            lower.includes("execution constraints") || 
            lower.includes("constraints") || 
            lower.includes("protocol") || 
            lower.includes("mandate") || 
            lower.includes("here is the") ||
            /^\s*[`'"]+\s*\d+\.\s*/.test(lower); // Matches things like "` 4. "
            
        if (hasLeak) {
            return "";
        }
        return match;
    }).trim();

    // 3. Process Citations: Convert [1], [2] etc. into styled badges
    // We wrap them in a specific pattern that we can then handle in the components
    const contentWithCitations = strippedContent
        .replace(/(?<!\[)\[(\d+)\](?!\])/g, '[$1](#cite-$1)');

    // Context-Aware Bibliography Fix: Only force verticality after the "Sources" or "References" header
    const parts = contentWithCitations.split(/(?=##\s+(?:Sources|References|Bibliography|Sources|sources|REFERENCES))/i);
    if (parts.length > 1) {
        // parts[1] is the bibliography section
        // Use single newline for a tighter vertical list
        parts[1] = parts[1].replace(/\s+(\[\d+\])/g, '\n$1');
    }
    const finalContent = parts.join('');

    return (
        <div className={`markdown-content max-w-full overflow-x-hidden break-words sm:break-normal ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[
                    [rehypeHighlight, { plainText: Array.from(PLAIN_MARKDOWN_LANGS) }],
                ]}
                components={{
                    // Headings with responsive font sizes and wrapping
                    h1: ({ children }) => (
                        <h1 className="text-lg sm:text-xl font-bold !mt-1.5 !mb-1 text-text-primary tracking-tight break-words">
                            {children}
                        </h1>
                    ),
                    h2: ({ children }) => (
                        <h2 className="text-base sm:text-lg font-bold !mt-1.5 !mb-0.5 text-text-primary tracking-tight break-words">
                            {children}
                        </h2>
                    ),
                    h3: ({ children }) => (
                        <h3 className="text-[15px] sm:text-base font-semibold !mt-1 !mb-0.5 text-text-secondary break-words">
                            {children}
                        </h3>
                    ),
                    h4: ({ children }) => (
                        <h4 className="text-sm font-semibold !mt-1 !mb-0.5 text-text-secondary break-words">
                            {children}
                        </h4>
                    ),

                    // Paragraphs
                    p: ({ children }) => (
                        <p className="mb-1.5 leading-[1.55] text-text-secondary font-normal whitespace-normal break-all sm:break-normal last:mb-0">{children}</p>
                    ),

                    // Links
                    a: ({ href, children }) => {
                        const isCitation = typeof href === 'string' && href.startsWith('#cite-');
                        if (isCitation) {
                            const citationId = Number.parseInt(href.replace('#cite-', ''), 10);
                            const citation =
                                Number.isFinite(citationId) && citationId > 0
                                    ? citations[citationId - 1]
                                    : undefined;
                            const citationLabel = getCodeText(children);
                            const titleParts = [
                                citation?.title?.trim(),
                                citation?.url?.trim(),
                                citation?.snippet?.trim(),
                            ].filter((part): part is string => Boolean(part));
                            const citationTitle =
                                titleParts.length > 0
                                    ? titleParts.join('\n\n')
                                    : `Source ${citationLabel}`;

                            if (citation?.url) {
                                return (
                                    <a
                                        href={citation.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 text-[9px] font-black text-accent bg-accent/10 border border-accent/20 rounded-[4px] mx-0.5 -translate-y-[4px] select-none hover:bg-accent/20 transition-colors"
                                        title={citationTitle}
                                    >
                                        {children}
                                    </a>
                                );
                            }

                            return (
                                <span 
                                    className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 text-[9px] font-black text-accent bg-accent/10 border border-accent/20 rounded-[4px] mx-0.5 -translate-y-[4px] cursor-help select-none hover:bg-accent/20 transition-colors"
                                    title={citationTitle}
                                >
                                    {children}
                                </span>
                            );
                        }
                        return (
                            <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 underline underline-offset-4 decoration-blue-400/30 font-medium break-all"
                            >
                                {children}
                            </a>
                        );
                    },

                    // Lists
                    ul: ({ children }) => (
                        <ul className="mb-1.5 ml-4 sm:ml-5 space-y-0 list-disc text-text-secondary whitespace-normal last:mb-0">
                            {children}
                        </ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="mb-1.5 ml-4 sm:ml-5 space-y-0 list-decimal text-text-secondary whitespace-normal last:mb-0">
                            {children}
                        </ol>
                    ),
                    li: ({ children }) => (
                        <li className="pl-0.5 leading-[1.55] break-words whitespace-normal">{children}</li>
                    ),

                    // Blockquote
                    blockquote: ({ children }) => (
                        <blockquote className="mb-1.5 mt-0.5 pl-3 border-l-2 border-border-default text-text-secondary italic font-medium last:mb-0">
                            {children}
                        </blockquote>
                    ),
                    // Horizontal Rule
                    hr: () => (
                        <hr className="!my-1.5 border-t border-border-subtle" />
                    ),

                    // Code
                    code: ({ className, children, ...props }) => {
                        let isInline = !className;
                        
                        // If AI accidentally uses single backticks for multiline content,
                        // treat it as a block so line breaks and formatting are preserved.
                        if (isInline) {
                            const text = getCodeText(children);
                            if (text.includes('\n')) {
                                isInline = false;
                            }
                        }

                        const language = className?.replace('language-', '') || '';

                        if (language === 'mermaid') {
                            return <MermaidRenderer chart={getCodeText(children).replace(/\n$/, '')} />;
                        }

                        return (
                            <CodeBlock className={className} inline={isInline}>
                                {children}
                            </CodeBlock>
                        );
                    },

                    // Pre (wrapper for code blocks)
                    pre: ({ children }) => <>{children}</>,

                    // Tables
                    table: ({ children }) => (
                        <div className="my-2 overflow-hidden rounded-2xl border border-border-default bg-surface-1">
                            <div className="overflow-x-auto">
                                <table className="min-w-full border-collapse">
                                    {children}
                                </table>
                            </div>
                        </div>
                    ),
                    thead: ({ children }) => (
                        <thead className="bg-surface-2 border-b border-border-default">{children}</thead>
                    ),
                    tbody: ({ children }) => <tbody className="divide-y divide-border-subtle">{children}</tbody>,
                    tr: ({ children }) => (
                        <tr className="hover:bg-surface-1 transition-colors">
                            {children}
                        </tr>
                    ),
                    th: ({ children }) => (
                        <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">
                            {children}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td className="px-5 py-4 text-[13.5px] text-text-secondary font-medium">
                            {children}
                        </td>
                    ),

                    // Strong and emphasis
                    strong: ({ children }) => (
                        <strong className="font-bold text-text-primary">{children}</strong>
                    ),
                    em: ({ children }) => (
                        <em className="italic text-text-secondary">{children}</em>
                    ),

                    // Strikethrough (GFM)
                    del: ({ children }) => (
                        <del className="line-through text-text-faint">{children}</del>
                    ),

                    // Images
                    img: ({ src, alt }) => (
                        <div className="my-3 rounded-2xl overflow-hidden border border-border-default">
                            <img
                                src={src}
                                alt={alt || ""}
                                className="w-full h-auto object-cover"
                                loading="lazy"
                            />
                        </div>
                    ),
                }}
            >
                {finalContent}
            </ReactMarkdown>
        </div>
    );
};
