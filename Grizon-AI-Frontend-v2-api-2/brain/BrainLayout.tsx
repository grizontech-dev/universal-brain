'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Brain, MessageSquare, Plug, Database, File, Settings, X, Activity } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCanvas } from '@/context/CanvasContext';
import { useConversations } from '@/context/ConversationContext';
import BrainMessages from './components/BrainMessages';
import { BrainWebContainerProvider } from './context/BrainWebContainerContext';

function BrainFallback() {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-[#0d0c14] text-white">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#976df8] border-t-transparent" />
        </div>
    );
}

export default function BrainLayout({ children }: { children?: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { isAuthenticated, isLoading, openAuthModal, user } = useAuth();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            openAuthModal('signin-email');
        }
    }, [isLoading, isAuthenticated, openAuthModal]);

    const initial = user?.name
        ? user.name.charAt(0).toUpperCase()
        : user?.email
          ? user.email.charAt(0).toUpperCase()
          : '?';

    const navButtons = [
        { id: 'chat', icon: MessageSquare, label: 'Standard Chat', path: '/chat' },
        { id: 'brain', icon: Brain, label: 'Neural Brain', path: '/brain', active: true },
        { id: 'connectors', icon: Plug, label: 'Connectors', path: '/chat?tab=connectors' },
        { id: 'database', icon: Database, label: 'Database', path: '/chat?tab=database' },
    ];

    return (
        <Suspense fallback={<BrainFallback />}>
            <div className="flex h-[100dvh] w-full bg-[#0d0c14] text-white overflow-hidden relative">
                {/* Specialized Brain Sidebar (IconRail equivalent but locked to Brain) */}
                <div className="w-[70px] flex flex-col items-center py-6 gap-6 shrink-0 bg-[#09090b] border-r border-white/5 z-50">
                    <div className="cursor-pointer hover:scale-110 transition-transform" onClick={() => router.push('/')}>
                        <img src="/Logo.svg" alt="Grizon" className="w-10 h-10 object-contain" />
                    </div>

                    <div className="flex-1 flex flex-col gap-4">
                        {navButtons.map((btn) => (
                            <button
                                key={btn.id}
                                onClick={() => router.push(btn.path)}
                                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all group relative ${
                                    btn.active 
                                        ? 'bg-[#976df8]/10 text-[#976df8] border border-[#976df8]/20 shadow-[0_0_15px_rgba(151,109,248,0.1)]' 
                                        : 'text-white/20 hover:text-white/40 hover:bg-white/[0.02]'
                                }`}
                            >
                                <btn.icon size={22} />
                                <div className="absolute left-full ml-4 px-3 py-2 bg-[#13131a] border border-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[100] shadow-2xl">
                                    {btn.label}
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-col gap-4 items-center">
                        <div className="w-10 h-10 rounded-xl bg-[#1f1a30] border border-[#976df8]/20 flex items-center justify-center text-[12px] font-black text-[#976df8]">
                            {initial}
                        </div>
                    </div>
                </div>

                {/* Main Content: Dedicated Brain Messages */}
                <div className="flex-1 flex flex-col min-w-0 relative h-full">
                    <header className="h-16 border-b border-white/5 flex items-center px-8 justify-between shrink-0 bg-[#09090b]/40 backdrop-blur-md z-10">
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col">
                                <h1 className="text-[14px] font-black tracking-[0.1em] text-white uppercase">Neural Interface</h1>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">Brain v2.5.1 Connected</span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-6">

                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                                <Activity size={12} className="text-[#976df8]" />
                                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Runtime: Sandbox MCP</span>
                            </div>
                        </div>
                    </header>

                    <div className="flex-1 overflow-hidden relative">
                        <BrainWebContainerProvider>
                            <BrainMessages />
                        </BrainWebContainerProvider>
                    </div>
                </div>

                {/* Right Side (Optional: Could add a Brain-specific Canvas here later) */}
            </div>
        </Suspense>
    );
}
