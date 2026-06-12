import type { LucideIcon } from 'lucide-react';
import {
    File,
    Folder,
    FolderOpen,
    FileCode,
    FileText,
    Braces,
    Palette,
    Settings,
    Database,
    Lock,
    Image,
    Box,
} from 'lucide-react';
import type { FileNode } from './brainWebContainer';

/** VS Code–style: folders first, then files; alphabetical within each group. */
export function sortFileTreeNodes(nodes: FileNode[]): FileNode[] {
    const sorted = [...nodes].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return sorted.map((n) =>
        n.type === 'folder' && n.children?.length
            ? { ...n, children: sortFileTreeNodes(n.children) }
            : n
    );
}

export type FileIconStyle = {
    Icon: LucideIcon;
    className: string;
};

export function getFileTreeIcon(
    name: string,
    type: 'file' | 'folder',
    isOpen?: boolean
): FileIconStyle {
    if (type === 'folder') {
        return {
            Icon: isOpen ? FolderOpen : Folder,
            className: 'text-amber-400/90',
        };
    }

    const lower = name.toLowerCase();
    const ext = lower.includes('.') ? lower.split('.').pop() || '' : lower;

    if (lower === 'package.json' || lower === 'package-lock.json') {
        return { Icon: Box, className: 'text-red-400/90' };
    }
    if (lower === '.env' || lower.endsWith('.env') || lower === '.env.example') {
        return { Icon: Lock, className: 'text-yellow-500/80' };
    }
    if (ext === 'json') {
        return { Icon: Braces, className: 'text-yellow-300/80' };
    }
    if (ext === 'jsx' || ext === 'tsx') {
        return { Icon: FileCode, className: 'text-sky-400/90' };
    }
    if (ext === 'js' || ext === 'ts' || ext === 'mjs' || ext === 'cjs') {
        return { Icon: FileCode, className: 'text-yellow-400/85' };
    }
    if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
        return { Icon: Palette, className: 'text-blue-400/85' };
    }
    if (ext === 'md' || ext === 'mdx') {
        return { Icon: FileText, className: 'text-sky-300/75' };
    }
    if (ext === 'html' || ext === 'htm') {
        return { Icon: FileCode, className: 'text-orange-400/85' };
    }
    if (ext === 'sql') {
        return { Icon: Database, className: 'text-violet-400/85' };
    }
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'svg' || ext === 'webp') {
        return { Icon: Image, className: 'text-purple-400/80' };
    }
    if (ext === 'yml' || ext === 'yaml' || ext === 'toml') {
        return { Icon: Settings, className: 'text-white/45' };
    }

    return { Icon: File, className: 'text-white/35' };
}
