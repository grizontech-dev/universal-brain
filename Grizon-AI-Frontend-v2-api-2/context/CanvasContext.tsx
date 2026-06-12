'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { CanvasArtifact } from '@/lib/types';
import type { CanvasSelectedItem } from '@/lib/canvas-selection';

export type CanvasMode = 'document' | 'code' | 'render' | 'report' | 'markdown' | 'split' | 'project' | 'database';

interface CanvasContextType {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    activeArtifact: CanvasArtifact | null;
    setActiveArtifact: (artifact: CanvasArtifact | null) => void;
    streamingContent: string;
    setStreamingContent: (content: string) => void;
    mode: CanvasMode;
    setMode: (mode: CanvasMode) => void;
    language: string;
    setLanguage: (lang: string) => void;
    activeTab: 'viewer' | 'files';
    setActiveTab: (tab: 'viewer' | 'files') => void;
    selectedItem: CanvasSelectedItem | null;
    setSelectedItem: (item: CanvasSelectedItem | null) => void;
    filesListVersion: number;
    bumpFilesListVersion: () => void;
    bufferedContent: string;
    closeCanvas: () => void;
    openCanvas: (mode?: CanvasMode) => void;
    openCanvasFilesTab: () => void;
    openCanvasWithItem: (item: CanvasSelectedItem) => void;
    updateActiveArtifactContent: (content: string) => void;
    shouldRun: boolean;
    setShouldRun: (run: boolean) => void;
    connectors: any[];
    refreshConnectors: () => Promise<void>;
}

const CanvasContext = createContext<CanvasContextType | undefined>(undefined);

export function CanvasProvider({ children }: { children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeArtifact, setActiveArtifact] = useState<CanvasArtifact | null>(null);
    const [streamingContent, setStreamingContent] = useState('');
    const [bufferedContent, setBufferedContent] = useState('');
    const [mode, setMode] = useState<CanvasMode>('document');
    const [language, setLanguage] = useState<string>('');
    const [shouldRun, setShouldRun] = useState(false);
    const [activeTab, setActiveTab] = useState<'viewer' | 'files'>('files');
    const [selectedItem, setSelectedItem] = useState<CanvasSelectedItem | null>(null);
    const [filesListVersion, setFilesListVersion] = useState(0);
    const [connectors, setConnectors] = useState<any[]>([]);

    const bumpFilesListVersion = useCallback(() => {
        setFilesListVersion((v) => v + 1);
    }, []);

    const bufferRef = useRef<string>('');
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Instant sync to bypass any potential loop traces from timeouts
    useEffect(() => {
        if (streamingContent !== bufferRef.current) {
            bufferRef.current = streamingContent;
            setBufferedContent(streamingContent);
        }
    }, [streamingContent]);

    const closeCanvas = useCallback(() => {
        setIsOpen(false);
    }, []);

    const openCanvas = useCallback((newMode?: CanvasMode) => {
        if (newMode) setMode(newMode);
        setIsOpen(true);
    }, []);

    const openCanvasFilesTab = useCallback(() => {
        setActiveTab('files');
        setIsOpen(true);
    }, []);

    const openCanvasWithItem = useCallback((item: CanvasSelectedItem) => {
        setSelectedItem(item);
        setActiveTab('viewer');
        setIsOpen(true);
    }, []);
    
    const updateActiveArtifactContent = useCallback((content: string) => {
        setActiveArtifact(prev => {
            if (!prev) return null;
            return { ...prev, content };
        });
    }, []);

    const refreshConnectors = useCallback(async () => {
        setConnectors([]);
    }, []);

    useEffect(() => {
        if (isOpen) {
            setConnectors([]);
        }
    }, [isOpen]);

    // Handle manual clear from chat (New Chat button)
    useEffect(() => {
        const handleClear = () => {
            setIsOpen(false); // Close canvas on new chat
            setActiveArtifact(null);
            setStreamingContent('');
            setMode('document');
            setLanguage('');
            setShouldRun(false);
            setBufferedContent('');
            bufferRef.current = '';
            setSelectedItem(null);
            setActiveTab('files');
        };

        window.addEventListener('clear-chat-state', handleClear);
        return () => window.removeEventListener('clear-chat-state', handleClear);
    }, []);

    const value = React.useMemo(() => ({
        isOpen,
        setIsOpen,
        activeArtifact,
        setActiveArtifact,
        streamingContent,
        setStreamingContent,
        mode,
        setMode,
        language,
        setLanguage,
        activeTab,
        setActiveTab,
        selectedItem,
        setSelectedItem,
        filesListVersion,
        bumpFilesListVersion,
        bufferedContent,
        closeCanvas,
        openCanvas,
        openCanvasFilesTab,
        openCanvasWithItem,
        updateActiveArtifactContent,
        shouldRun,
        setShouldRun,
        connectors,
        refreshConnectors,
    }), [
        isOpen, 
        activeArtifact, 
        streamingContent, 
        mode, 
        language,
        activeTab,
        selectedItem,
        filesListVersion,
        bumpFilesListVersion,
        bufferedContent, 
        closeCanvas, 
        openCanvas,
        openCanvasFilesTab,
        openCanvasWithItem,
        updateActiveArtifactContent,
        shouldRun,
        setShouldRun,
        connectors,
        refreshConnectors,
    ]);

    return (
        <CanvasContext.Provider value={value}>
            {children}
        </CanvasContext.Provider>
    );
}

export function useCanvas() {
    const context = useContext(CanvasContext);
    if (!context) {
        throw new Error('useCanvas must be used within a CanvasProvider');
    }
    return context;
}
