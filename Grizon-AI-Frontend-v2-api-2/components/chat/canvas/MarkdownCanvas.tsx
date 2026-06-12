'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useCanvas } from '@/context/CanvasContext';

interface MarkdownCanvasProps {
    content?: string;
}

export function MarkdownCanvas({ content }: MarkdownCanvasProps) {
    const { bufferedContent } = useCanvas();

    const cleanArtifactContent = (text: string) => {
        if (!text) return '';
        let cleaned = text.trim();

        // Iterative Header Cleaning (Sync with DocumentCanvas/Backend)
        let safetyCounter = 0;
        while (safetyCounter < 5) {
            safetyCounter++;
            const headerIndex = cleaned.indexOf('# ');
            if (headerIndex === -1) {
                const lower = cleaned.toLowerCase();
                const isDefiniteLeak = lower.includes("structural outline") || lower.includes("prompt echo") || lower.includes("tone") || lower.includes("constraints");
                return isDefiniteLeak ? "" : cleaned;
            }

            const preHeaderText = cleaned.substring(0, headerIndex).toLowerCase();
            const headerLineEnd = cleaned.indexOf('\n', headerIndex);
            const headerLine = cleaned.substring(headerIndex, headerLineEnd === -1 ? cleaned.length : headerLineEnd).toLowerCase();
            
            const preHasLeak = preHeaderText.includes("tone") || preHeaderText.includes("structure") || preHeaderText.includes("constraint") || preHeaderText.includes("echo") || preHeaderText.includes("analytical");
            const headerIsFake = headerLine.includes("[title]") || headerLine.includes("`") || headerLine.trim() === "#";

            if (preHasLeak || headerIsFake) {
                cleaned = cleaned.substring(headerLineEnd === -1 ? cleaned.length : headerLineEnd).trim();
                if (!cleaned) return ""; 
                continue; 
            }
            return cleaned.substring(headerIndex).trim();
        }
        return cleaned;
    };

    const currentContent = cleanArtifactContent(content || bufferedContent);

    return (
        <div className="w-full h-full p-10 overflow-auto custom-scrollbar bg-[#0a0a0d] prose prose-invert max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-p:leading-relaxed prose-code:text-purple-400 prose-code:bg-purple-900/20 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none selection:bg-purple-500/30">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
            >
                {currentContent}
            </ReactMarkdown>
        </div>
    );
}
