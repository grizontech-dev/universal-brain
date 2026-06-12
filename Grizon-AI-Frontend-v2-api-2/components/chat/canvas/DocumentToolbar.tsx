'use client';

import React from 'react';
import { Editor } from '@tiptap/react';
import { 
    Bold, Italic, List, ListOrdered, Code, 
    Heading1, Heading2, Heading3, Quote, 
    Undo, Redo, Link, Image as ImageIcon,
    Type, AlignLeft, AlignCenter, AlignRight
} from 'lucide-react';

interface DocumentToolbarProps {
    editor: Editor | null;
}

export function DocumentToolbar({ editor }: DocumentToolbarProps) {
    if (!editor) return null;

    const btnClass = (active: boolean) => `
        p-2 rounded-lg transition-all duration-200
        ${active 
            ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30' 
            : 'text-white/40 hover:text-white/70 hover:bg-white/5'}
    `;

    return (
        <div className="sticky top-0 z-30 bg-[#0d0c14]/90 backdrop-blur-3xl border-b border-white/[0.05] p-2 flex items-center gap-1 overflow-x-auto no-scrollbar shadow-xl">
            {/* History */}
            <div className="flex items-center gap-1 border-r border-white/5 pr-2 mr-2">
                <button onClick={() => editor.chain().focus().undo().run()} className={btnClass(false)} title="Undo"><Undo size={14}/></button>
                <button onClick={() => editor.chain().focus().redo().run()} className={btnClass(false)} title="Redo"><Redo size={14}/></button>
            </div>

            {/* Typography */}
            <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={btnClass(editor.isActive('heading', { level: 1 }))} title="H1"><Heading1 size={14}/></button>
            <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btnClass(editor.isActive('heading', { level: 2 }))} title="H2"><Heading2 size={14}/></button>
            <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btnClass(editor.isActive('heading', { level: 3 }))} title="H3"><Heading3 size={14}/></button>
            <button onClick={() => editor.chain().focus().setParagraph().run()} className={btnClass(editor.isActive('paragraph'))} title="Body"><Type size={14}/></button>

            <div className="w-px h-4 bg-white/10 mx-1" />

            {/* Formatting */}
            <button onClick={() => editor.chain().focus().toggleBold().run()} className={btnClass(editor.isActive('bold'))} title="Bold"><Bold size={14}/></button>
            <button onClick={() => editor.chain().focus().toggleItalic().run()} className={btnClass(editor.isActive('italic'))} title="Italic"><Italic size={14}/></button>
            <button onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btnClass(editor.isActive('blockquote'))} title="Quote"><Quote size={14}/></button>
            <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={btnClass(editor.isActive('codeBlock'))} title="Code Block"><Code size={14}/></button>

            <div className="w-px h-4 bg-white/10 mx-1" />

            {/* Lists */}
            <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={btnClass(editor.isActive('bulletList'))} title="Bullet List"><List size={14}/></button>
            <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btnClass(editor.isActive('orderedList'))} title="Ordered List"><ListOrdered size={14}/></button>

            <div className="w-px h-4 bg-white/10 mx-1" />

            {/* Actions */}
            <button onClick={() => {
                const url = window.prompt('URL');
                if (url) editor.chain().focus().setLink({ href: url }).run();
            }} className={btnClass(editor.isActive('link'))} title="Link"><Link size={14}/></button>
        </div>
    );
}
