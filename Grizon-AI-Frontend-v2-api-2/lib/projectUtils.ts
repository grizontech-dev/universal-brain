/**
 * Grizon Project Utilities
 * Shared logic for parsing and managing full-stack projects.
 */

export interface ProjectFile {
    path: string;
    content: string;
    language: string;
}

const FILE_MARKER_REGEX = /(?:<!--\s*FILE:\s*([^>]+?)\s*-->|\/\*\s*FILE:\s*([^*]+?)\s*\*\/|(?:\n|^)####\s*`?([^`\n]+)`?|(?:\n|^)\*\*\s*`?([^`\n]+)`?\s*\*\*|(?:\n|^)File:\s*`?([^`\n]+)`?)/gi;

export function parseProjectFiles(source: string): ProjectFile[] {
    const files: ProjectFile[] = [];
    const raw = (source || '').trim();
    if (!raw) return [];

    const markers: { path: string; markerEnd: number; index: number }[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(FILE_MARKER_REGEX);
    while ((match = regex.exec(raw)) !== null) {
        const path = (match[1] || match[2] || match[3] || match[4] || match[5] || '').trim();
        if (!path) continue;
        markers.push({
            path,
            index: match.index,
            markerEnd: regex.lastIndex,
        });
    }

    if (markers.length === 0) {
        return [{ path: 'App.js', content: raw, language: 'javascript' }];
    }

    for (let i = 0; i < markers.length; i++) {
        const start = markers[i].markerEnd;
        const end = i < markers.length - 1 ? markers[i + 1].index : raw.length;
        const content = raw.slice(start, end).trim();
        
        const ext = markers[i].path.split('.').pop()?.toLowerCase() || '';
        let lang = 'javascript';
        if (['py'].includes(ext)) lang = 'python';
        else if (['ts', 'tsx'].includes(ext)) lang = 'typescript';
        else if (['js', 'jsx'].includes(ext)) lang = 'javascript';
        else if (['html'].includes(ext)) lang = 'html';
        else if (['css'].includes(ext)) lang = 'css';
        else if (['json'].includes(ext)) lang = 'json';

        files.push({
            path: markers[i].path,
            content,
            language: lang
        });
    }

    return files;
}
