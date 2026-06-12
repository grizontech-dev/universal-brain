'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { 
    Folder, 
    File as FileIcon, 
    Download, 
    ChevronRight, 
    ChevronDown, 
    Layout, 
    Code as CodeIcon,
    Search,
    Clock,
    Box,
    FileText
} from 'lucide-react';
import { CodeCanvas } from './CodeCanvas';

import { parseProjectFiles, ProjectFile } from '@/lib/projectUtils';

interface ProjectPreviewProps {
    code: string;
    language?: string;
    isStreaming?: boolean;
    onChange?: (val: string) => void;
}

function buildStoredProject(files: ProjectFile[]): string {
    return files.map(f => `<!-- FILE: ${f.path} -->\n${f.content}`).join('\n\n');
}

import SandpackPreviewer from './SandpackPreviewer';

export function ProjectPreview({ code, isStreaming }: ProjectPreviewProps) {
    const files = useMemo(() => parseProjectFiles(code), [code]);

    return (
        <div className="flex-1 flex min-h-0 bg-[#08080c] overflow-hidden border border-white/5 rounded-xl shadow-2xl">
            <SandpackPreviewer files={files} template="react" isStreaming={isStreaming} />
        </div>
    );
}
