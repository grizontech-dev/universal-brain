'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, MoreHorizontal, Loader2, X, Pin, PinOff, Trash2, Edit2, Check, Settings } from 'lucide-react';
import { useConversations } from '@/context/ConversationContext';
import { useCredits } from '@/context/CreditContext';
import { useModels } from '@/context/ModelContext';
import { useAuth } from '@/context/AuthContext';

function formatTokens(n: number): string {
    if (!Number.isFinite(n) || n < 0) return '0';
    if (n < 1000) return String(Math.round(n));
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K`;
}

export default function ThreadPanel({ 
    onSelectAction,
    onCloseAction 
}: { 
    onSelectAction?: () => void;
    onCloseAction?: () => void;
}) {
    const { conversations, currentConversationId, selectConversation, isLoading, deleteConversation, pinConversation, updateConversationTitle } = useConversations();
    const { balance } = useCredits();
    const { planSnapshot } = useModels();
    const { user } = useAuth();
    const router = useRouter();
    const planName = planSnapshot?.name?.trim() || 'Free';

    const accountInitial = user?.name
        ? user.name.charAt(0).toUpperCase()
        : user?.email
            ? user.email.charAt(0).toUpperCase()
            : '?';
    const accountLabel = user?.name || user?.email || 'Account';

    const goToSettings = () => {
        router.push('/settings/general');
        if (onSelectAction) onSelectAction();
    };

    // Dropdown and Rename State
    const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [editTitle, setEditTitle] = React.useState('');
    const [searchQuery, setSearchQuery] = React.useState('');

    const handleSelect = (id: string | null) => {
        if (editingId) return; // Don't navigate while editing
        selectConversation(id);
        
        // Force manual clear if we are already on /chat or starting new
        if (!id) {
            window.dispatchEvent(new CustomEvent('clear-chat-state'));
        }
        
        if (onSelectAction) onSelectAction();
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.round(diffMs / 60000);
        const diffHours = Math.round(diffMs / 3600000);

        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (date.toLocaleDateString() === now.toLocaleDateString()) return 'Today';

        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toLocaleDateString() === yesterday.toLocaleDateString()) return 'Yesterday';

        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    // Close menu when clicking outside
    React.useEffect(() => {
        const handleClick = () => setOpenMenuId(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const startEditing = (e: React.MouseEvent, id: string, title: string) => {
        e.stopPropagation();
        setEditingId(id);
        setEditTitle(title);
        setOpenMenuId(null);
    };

    const saveRename = async (e: React.MouseEvent | React.KeyboardEvent) => {
        if (e.type === 'click' || (e as React.KeyboardEvent).key === 'Enter') {
            if (editingId && editTitle.trim()) {
                await updateConversationTitle(editingId, editTitle.trim());
            }
            setEditingId(null);
        }
    };

    const togglePin = async (e: React.MouseEvent, id: string, isPinned: boolean) => {
        e.stopPropagation();
        await pinConversation(id, !isPinned);
        setOpenMenuId(null);
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this conversation?')) {
            await deleteConversation(id);
        }
        setOpenMenuId(null);
    };

    // Grouping logic (Pinned, Today, Yesterday, This Week, Older)
    const sortedConversations = [...conversations]
        .filter(c => c.title?.toLowerCase().includes(searchQuery.toLowerCase()) || !searchQuery)
        .sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
        });

    const grouped = sortedConversations.reduce((acc, conv) => {
        if (conv.isPinned) {
            if (!acc['PINNED']) acc['PINNED'] = [];
            acc['PINNED'].push(conv);
            return acc;
        }

        const date = new Date(conv.updatedAt || conv.createdAt);
        const dateStr = date.toLocaleDateString();
        const today = new Date().toLocaleDateString();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toLocaleDateString();

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(startOfToday);
        weekAgo.setDate(weekAgo.getDate() - 7);

        let group = 'Older';
        if (dateStr === today) group = 'TODAY';
        else if (dateStr === yesterdayStr) group = 'YESTERDAY';
        else if (date >= weekAgo) group = 'THIS WEEK';

        if (!acc[group]) acc[group] = [];
        acc[group].push(conv);
        return acc;
    }, {} as Record<string, typeof conversations>);

    return (
        <div className="thread-panel flex flex-col w-full lg:w-[260px] h-full shrink-0 border-r border-border-subtle bg-sidebar">
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-[52px] shrink-0 border-b border-border-subtle">
                <h2 className="text-[14px] font-bold text-text-primary tracking-tight uppercase">Conversations</h2>
                {onCloseAction && (
                    <button
                        onClick={onCloseAction}
                        className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-all"
                        title="Close Sidebar"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* New Chat Button */}
            <div className="px-3 pt-4 pb-2">
                <button
                    onClick={() => handleSelect(null)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all text-[13px] font-bold shadow-[0_0_15px_rgba(168,85,247,0.1)]"
                >
                    <Plus size={16} strokeWidth={2.5} />
                    <span>New Chat</span>
                </button>
            </div>

            {/* Search */}
            <div className="px-3 mb-2">
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint group-focus-within:text-accent transition-colors" size={14} />
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-surface-2 border border-border-subtle rounded-lg py-1.5 pl-9 pr-3 text-[13px] text-text-secondary focus:outline-none focus:border-accent/30 focus:bg-surface-3 transition-all placeholder:text-text-faint"
                    />
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {isLoading && conversations.length === 0 ? (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 className="w-5 h-5 animate-spin text-text-faint" />
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="text-center py-10 px-4">
                        <p className="text-[12px] text-text-faint">No conversations found.</p>
                    </div>
                ) : (
                    Object.entries(grouped).map(([group, items]) => (
                        <div key={group} className="contents animate-in fade-in duration-200">
                            <div className="px-2 py-1.5 text-[11px] font-medium text-text-muted uppercase tracking-wider mt-2 flex items-center gap-2">
                                {group === 'PINNED' && <Pin size={10} className="text-accent" />}
                                {group}
                            </div>
                            {items.map((conv) => (
                                <div
                                    key={`${group}-${conv.id}`}
                                    onClick={() => handleSelect(conv.id)}
                                    className={`thread-item group relative flex flex-col gap-0.5 pl-3 pr-2 py-2 rounded-lg transition-colors duration-150 cursor-pointer mb-0.5 border-l-2 ${currentConversationId === conv.id ? 'bg-surface-2 text-text-primary border-accent/70' : 'text-text-muted hover:bg-surface-2 hover:text-text-secondary border-transparent'}`}
                                >
                                    <div className="flex items-start justify-between gap-1.5 min-w-0">
                                        <div className="font-medium truncate text-[13px] flex-1 min-w-0">
                                            {editingId === conv.id ? (
                                                <input
                                                    autoFocus
                                                    value={editTitle}
                                                    onChange={(e) => setEditTitle(e.target.value)}
                                                    onKeyDown={saveRename}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-full bg-surface-3 border border-accent/50 rounded px-1.5 py-0.5 outline-none text-text-primary text-[13px]"
                                                />
                                            ) : (
                                                <span className="truncate block pr-1">
                                                    {conv.title || 'Untitled Chat'}
                                                </span>
                                            )}
                                        </div>
                                        
                                        {/* Actions - Visible by default on mobile, hover-only on desktop */}
                                        {editingId === conv.id ? (
                                            <button onClick={saveRename} className="text-accent hover:text-accent-hover p-0.5 shrink-0">
                                                <Check size={14} />
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shrink-0">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === conv.id ? null : conv.id); }}
                                                    className={`w-6 h-6 flex items-center justify-center rounded-md hover:bg-surface-3 transition-colors ${openMenuId === conv.id ? 'bg-surface-3 text-text-primary' : ''}`}
                                                >
                                                    <MoreHorizontal size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Dropdown Menu - Adjusted for better mobile positioning */}
                                    {openMenuId === conv.id && (
                                        <div 
                                            className="absolute right-0 top-[40px] w-[140px] bg-surface-2 border border-border-default rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] py-1.5 z-[100] animate-in fade-in zoom-in-95 duration-150 ring-1 ring-accent/10"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <button onClick={(e) => startEditing(e, conv.id, conv.title || '')} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-text-secondary hover:text-accent hover:bg-surface-3 transition-all text-left font-medium">
                                                <Edit2 size={13} strokeWidth={2} /> Rename
                                            </button>
                                            <button onClick={(e) => togglePin(e, conv.id, !!conv.isPinned)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-text-secondary hover:text-accent hover:bg-surface-3 transition-all text-left font-medium">
                                                {conv.isPinned ? <PinOff size={13} strokeWidth={2} /> : <Pin size={13} strokeWidth={2} />}
                                                {conv.isPinned ? 'Unpin' : 'Pin'}
                                            </button>
                                            <div className="h-px bg-border-subtle my-1.5 mx-2" />
                                            <button onClick={(e) => handleDelete(e, conv.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-red-400/80 hover:text-red-400 hover:bg-red-500/5 transition-all text-left font-medium">
                                                <Trash2 size={13} strokeWidth={2} /> Delete
                                            </button>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-1.5 text-[11px] opacity-40">
                                        <span>{formatDate(conv.updatedAt || conv.createdAt)}</span>
                                        {conv.isPinned && <Pin size={10} className="text-accent rotate-45" />}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <div className="border-t border-border-subtle mt-auto">
                {/* Account + Settings — mobile only (desktop uses the icon rail) */}
                <button
                    onClick={goToSettings}
                    className="lg:hidden w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors"
                >
                    <div className="w-9 h-9 rounded-lg bg-accent-soft flex items-center justify-center text-[13px] font-bold text-accent shrink-0 border border-accent/15">
                        {accountInitial}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-text-primary truncate">{accountLabel}</p>
                        <p className="text-[11px] text-text-faint truncate">View settings</p>
                    </div>
                    <Settings size={18} className="text-text-muted shrink-0" />
                </button>

                {/* Plan Status */}
                <div className="px-4 pt-3 pb-4 border-t border-border-subtle lg:border-t-0 lg:pt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div>
                        <span className="text-[12px] font-bold text-text-secondary tracking-tight">{planName} Plan</span>
                    </div>
                    <div className="text-[10px] font-medium text-text-faint tabular-nums">
                        {balance !== null ? (
                            `${formatTokens(balance.total)} / ${formatTokens(balance.lifetimeEarned)} tokens`
                        ) : (
                            '— tokens'
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

