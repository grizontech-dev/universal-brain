'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useCanvas, CanvasMode } from '@/context/CanvasContext';

/**
 * useStreamParser
 * Intercepts XML-like tags (<grizon-artifact>, <grizon-sandbox>, <grizon-document>)
 * from a live streaming chat response and routes content to the Canvas.
 */
export function useStreamParser() {
    const { 
        setStreamingContent, 
        setMode, 
        setIsOpen,
        setActiveTab,
        isOpen,
        setLanguage
    } = useCanvas();

    // NEW REFS for internal tracking to avoid re-render loops
    const fullContentRef = useRef('');
    const modeRef = useRef<CanvasMode | null>(null);
    const hasAutoOpenedRef = useRef(false);
    const forcedViewerRef = useRef(false);
    const lastStreamingContentRef = useRef('');
    const lastLanguageRef = useRef('');
    const artifactFinishedRef = useRef(false);
    const isOpenRef = useRef(isOpen);

    useEffect(() => {
        isOpenRef.current = isOpen;
    }, [isOpen]);

    const pendingModeRef = useRef<CanvasMode | null>(null);
    const pendingContentRef = useRef<string>('');
    const pendingLanguageRef = useRef<string>('');
    const pendingTabRef = useRef<'viewer' | 'files' | null>(null);
    const pendingOpenRef = useRef<boolean>(false);
    const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);

    const applyUpdates = useCallback(() => {
        if (pendingOpenRef.current && !isOpenRef.current) {
            setIsOpen(true);
            isOpenRef.current = true;
        }
        if (pendingTabRef.current) {
            setActiveTab(pendingTabRef.current);
            pendingTabRef.current = null;
        }
        if (pendingModeRef.current && pendingModeRef.current !== modeRef.current) {
            setMode(pendingModeRef.current);
            modeRef.current = pendingModeRef.current;
        }
        if (pendingContentRef.current !== lastStreamingContentRef.current) {
            setStreamingContent(pendingContentRef.current);
            lastStreamingContentRef.current = pendingContentRef.current;
        }
        if (pendingLanguageRef.current && pendingLanguageRef.current !== lastLanguageRef.current) {
            setLanguage(pendingLanguageRef.current);
            lastLanguageRef.current = pendingLanguageRef.current;
        }
    }, [setMode, setStreamingContent, setIsOpen, setActiveTab, setLanguage]);

    const processChunk = useCallback((chunk: string) => {
        // 1. Update refs
        const newFullContent = fullContentRef.current + chunk;
        fullContentRef.current = newFullContent;

        // Auto-Open disabled as per user request
        const hasArtifact = newFullContent.includes('<grizon-artifact') || 
                           newFullContent.includes('<grizon-document') ||
                           newFullContent.includes('<grizon-code') ||
                           newFullContent.includes('<grizon-render') ||
                           newFullContent.includes('<grizon-project');
        
        if (hasArtifact && !hasAutoOpenedRef.current) {
            hasAutoOpenedRef.current = true;
            forcedViewerRef.current = true;
        }

        // 3. Parse Tags
        const artifactRegex = /<grizon-artifact\s+type="([^"]+)"(?:\s+title="([^"]+)"|\s+language="([^"]+)")*\s*>([\s\S]*?)(?:<\/grizon-artifact>|$)/g;
        const documentRegex = /<grizon-document(?:\s+title="([^"]+)")?\s*>([\s\S]*?)(?:<\/grizon-document>|$)/g;
        const codeRegex = /<grizon-code(?:\s+language="([^"]+)")?(?:\s+title="([^"]+)")?\s*>([\s\S]*?)(?:<\/grizon-code>|$)/g;
        const projectRegex = /<grizon-project(?:\s+title="([^"]+)")?\s*>([\s\S]*?)(?:<\/grizon-project>|$)/g;

        const artifacts = Array.from(newFullContent.matchAll(artifactRegex));
        const documents = Array.from(newFullContent.matchAll(documentRegex));
        const codes = Array.from(newFullContent.matchAll(codeRegex));
        const projects = Array.from(newFullContent.matchAll(projectRegex));

        let latestTag: { mode: CanvasMode; content: string; index: number; isClosed: boolean; language?: string } | null = null;
        
        for (const m of artifacts) {
            const index = m.index || 0;
            const type = m[1] as CanvasMode;
            const title = m[2] || '';
            const language = m[3] || '';
            const isClosed = m[0].trim().endsWith('</grizon-artifact>');
            
            let artifactMode = type;
            const lowerContent = (m[4] || '').toLowerCase();
            const isWebsite = lowerContent.includes('<!doctype html>') || lowerContent.includes('<html') || lowerContent.includes('<body');
            const isMultiFile = /<!--\s*FILE:/.test(m[4] || '') || /\/\*\s*FILE:/.test(m[4] || '') || /(?:\n|^)####\s*`?/.test(m[4] || '') || /(?:\n|^)\*\*\s*`?/.test(m[4] || '') || /(?:\n|^)File:\s*`?/.test(m[4] || '') || /File:\s+\//.test(m[4] || '');

            if (isWebsite || isMultiFile) {
                artifactMode = 'project';
            } else if (type === 'code' && language === 'python' && title.toLowerCase().includes('document')) {
                artifactMode = 'document';
            }
            if (!latestTag || index >= latestTag.index) {
                latestTag = { mode: artifactMode, content: m[4] || '', index, isClosed, language };
            }
        }

        for (const m of documents) {
            const index = m.index || 0;
            const isClosed = m[0].trim().endsWith('</grizon-document>');
            if (!latestTag || index >= latestTag.index) {
                latestTag = { mode: 'document', content: m[2] || '', index, isClosed };
            }
        }

        for (const m of codes) {
            const index = m.index || 0;
            const language = m[1] || '';
            const content = m[3] || '';
            const isClosed = m[0].trim().endsWith('</grizon-code>');
            
            let mode: 'code' | 'project' = 'code';
            const lowerContent = content.toLowerCase();
            const isWebsite = lowerContent.includes('<!doctype html>') || lowerContent.includes('<html') || lowerContent.includes('<body');
            const isMultiFile = /<!--\s*FILE:/.test(content) || /\/\*\s*FILE:/.test(content) || /(?:\n|^)####\s*`?/.test(content) || /(?:\n|^)\*\*\s*`?/.test(content) || /(?:\n|^)File:\s*`?/.test(content) || /File:\s+\//.test(content);
            if (isWebsite || isMultiFile) mode = 'project';

            if (!latestTag || index >= latestTag.index) {
                latestTag = { mode, content, index, isClosed, language };
            }
        }

        for (const m of projects) {
            const index = m.index || 0;
            const isClosed = m[0].trim().endsWith('</grizon-project>');
            if (!latestTag || index >= latestTag.index) {
                latestTag = { mode: 'project', content: m[2] || '', index, isClosed };
            }
        }

        // 4. Update Context with throttling to prevent React flood
        if (latestTag) {
            pendingModeRef.current = latestTag.mode;
            pendingContentRef.current = latestTag.content;
            if (latestTag.language) {
                pendingLanguageRef.current = latestTag.language;
            }
            
            // SANITIZATION: Remove any stray grizon tags that leaked into the content
            let sanitizedContent = latestTag.content
                .replace(/<grizon-\w+(?:\s+[^>]*)?>/gi, '')
                .replace(/<\/grizon-\w+>/gi, '')
                .trim();
            
            // CHATTER STRIPPING: Remove common AI "thinking" or "instruction" leaks
            // This strips things like "1. Task: ...", "Constraints:", bulleted lists at the start, etc.
            sanitizedContent = sanitizedContent
                .replace(/^[\s\S]*?(?=\/\*|fn\s|import\s|use\s|const\s|let\s|#|package\s|public\s|class\s|def\s|module\s|using\s|@|<!DOCTYPE|<html>)/i, (match) => {
                    // Only strip if the prefix contains high-noise patterns like "Task:", "Check:", "Constraints:", or lists
                    const lower = match.toLowerCase();
                    const hasNoise = lower.includes('task:') || 
                                    lower.includes('check:') || 
                                    lower.includes('constraints') || 
                                    lower.includes('architectural') ||
                                    /^\s*(?:\d+\.|\*|-|•)\s/m.test(match);
                    return hasNoise ? "" : match;
                })
                .replace(/<\/grizon-sandbox>/gi, '') // Explicitly handle stray sandbox closings
                .trim();
                
            pendingContentRef.current = sanitizedContent;

            if (!throttleTimerRef.current) {
                // Apply update immediately if it's the first bit or tag is closed
                if (latestTag.isClosed || !lastStreamingContentRef.current) {
                    applyUpdates();
                }

                throttleTimerRef.current = setTimeout(() => {
                    throttleTimerRef.current = null;
                    applyUpdates();
                }, 60);
            }
            
            // Dispatch event when artifact finishes (tag closes)
            if (latestTag.isClosed && !artifactFinishedRef.current) {
                artifactFinishedRef.current = true;
                window.dispatchEvent(new CustomEvent('artifact-streaming-finished', {
                    detail: { mode: latestTag.mode, content: latestTag.content, language: latestTag.language }
                }));
            } else if (!latestTag.isClosed) {
                artifactFinishedRef.current = false;
            }
        }
    }, [setMode, setIsOpen, setActiveTab, setStreamingContent, setLanguage, applyUpdates]);

    const reset = useCallback(() => {
        fullContentRef.current = '';
        modeRef.current = null;
        hasAutoOpenedRef.current = false;
        forcedViewerRef.current = false;
        lastStreamingContentRef.current = '';
        lastLanguageRef.current = '';
        artifactFinishedRef.current = false;
        setStreamingContent('');
        setLanguage('');
    }, [setStreamingContent, setLanguage]);

    /**
     * getCleanMsg
     * Returns the message content with all <grizon-*> tags stripped out for the chat bubble.
     */
    const getCleanMsg = useCallback((text: string) => {
        return text
            // 1. ROOT PERMANENT FIX: Strip all <grizon-*> tags AND their contents.
            // Handles both closed tags and unclosed tags (streaming).
            .replace(/<(grizon-\w+)(?:\s+[^>]*)?>[\s\S]*?(?:<\/\1>|$)/gi, '')
            .replace(/<\/grizon-\w+>/gi, '') // Cleanup stray closing tags
            
            // 2. Strip technical noise and instructions that leaked out
            .replace(/(?:Adhere to strict communication protocols|Detailed architectural breakdown|Constraints Check:|tag containing the .* code)[\s\S]*?(?=\n|$)/gi, '')
            .replace(/^\d+\.\s+Adhere to[\s\S]*?(?=\n|$)/gm, '')
            
            .replace(/\n{3,}/g, '\n\n') // Collapse extra whitespace
            .trim();
    }, []);

    return {
        processChunk,
        reset,
        getCleanMsg,
        fullContent: fullContentRef.current,
    };
}
