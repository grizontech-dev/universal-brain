'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import IconRail from './IconRail';
import ThreadPanel from './ThreadPanel';
import MessagesStaticShell from './MessagesStaticShell';
import CanvasPanel from './CanvasPanel';
import SettingsView from './SettingsView';
import { useConversations } from '@/context/ConversationContext';
import { useCanvas } from '@/context/CanvasContext';

export default function ChatScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading, openAuthModal } = useAuth();
  const [activeRail, setActiveRail] = useState('');
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { currentConversationId } = useConversations();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openAuthModal('signin-email');
    }
  }, [isLoading, isAuthenticated, openAuthModal]);

  // Close canvas and clear artifacts when switching to a New Chat or changing conversation
  const {
    isOpen: isContextOpen,
    setIsOpen: setContextOpen,
    openCanvasFilesTab,
    setActiveArtifact,
    setShouldRun,
  } = useCanvas();

  useEffect(() => {
    if (!currentConversationId) {
      setIsCanvasOpen(false);
      setContextOpen(false);
      setActiveArtifact(null);
    }
  }, [currentConversationId, setContextOpen, setActiveArtifact]);

  // Toggle canvas when 'code' rail button is clicked or explicit action
  const handleRailChange = (panel: string) => {
    setActiveRail(panel);
    if (panel === 'code') {
      setIsCanvasOpen(true);
    }
  };

  // Synchronize local isCanvasOpen with context isOpen to prevent 1ms flicker
  useEffect(() => {
    if (isCanvasOpen !== isContextOpen) {
      setIsCanvasOpen(isContextOpen);
    }
  }, [isContextOpen, isCanvasOpen]);

  // Update context when local state changes (e.g. from handleRailChange)
  useEffect(() => {
    if (isCanvasOpen !== isContextOpen) {
      setContextOpen(isCanvasOpen);
    }
  }, [isCanvasOpen, isContextOpen, setContextOpen]);

  useEffect(() => {
    const handleOpenCode = (e: Event) => {
      const ev = e as CustomEvent;
      const detail = ev.detail || {};
      const language =
        typeof detail.language === 'string' ? detail.language : '';
      const code = typeof detail.code === 'string' ? detail.code : '';
      const runRequested = !!detail.shouldRun;

      const isDoc = ['markdown', 'document', 'text', 'txt'].includes(
        language.toLowerCase(),
      );

      // Set temporary artifact so CanvasPanel picks it up
      setActiveArtifact({
        id: 'imported-' + Date.now(),
        type: isDoc ? 'document' : 'code',
        content: code,
        language: language,
        title: isDoc ? 'Imported Document' : 'Imported Code',
      } as any);

      if (runRequested) {
        setShouldRun(true);
      }

      setIsCanvasOpen(true);
      setContextOpen(true); // Ensure context is also updated
      if (activeRail !== 'code') {
        setActiveRail('code');
      }
    };
    window.addEventListener('openCodeInCanvas', handleOpenCode);
    return () => window.removeEventListener('openCodeInCanvas', handleOpenCode);
  }, [activeRail, setContextOpen, setActiveArtifact, setShouldRun]);

  return (
    <div className='flex h-screen w-full bg-chat text-text-primary overflow-hidden'>
      {/* 1. Far Left Rail - Hidden on mobile */}
      <div className='hidden lg:flex h-full'>
        <IconRail
          activeMode={isSettingsOpen ? 'settings' : 'chat'}
          onChatClick={(e) => {
            if (e.detail === 2) {
              e.preventDefault();
              setActiveRail((r) => (r === 'threads' ? '' : 'threads'));
              return;
            }
            setIsSettingsOpen(false);
            void router.push('/chat');
            setActiveRail('threads');
          }}
          onSettingsClick={() => setIsSettingsOpen(true)}
          onBrainClick={() => router.push('/brain')}
        />
      </div>

      {/* 2. Secondary Sidebar (Threads) */}
      <div
        className={`
                fixed inset-y-0 left-0 z-50 w-[280px] sm:w-[320px] lg:w-[260px] bg-sidebar border-r border-border-subtle transition-transform duration-300 lg:relative lg:translate-x-0
                ${activeRail === 'threads' || isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:hidden'}
            `}
      >
        <ThreadPanel
          onSelectAction={() => setIsSidebarOpen(false)}
          onCloseAction={() => setIsSidebarOpen(false)}
        />
      </div>

      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div
          className='fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden'
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* 3. Main Content Area */}
      <div className='flex flex-1 min-w-0 relative h-full'>
        {isSettingsOpen ? (
          <div className='flex-1 flex flex-col min-w-0 bg-sidebar relative animate-in fade-in slide-in-from-bottom-2 duration-400'>
            <div className='flex-1 w-full overflow-hidden'>
              <SettingsView section='general' />
            </div>
          </div>
        ) : (
          <>
            <MessagesStaticShell
              isCanvasOpen={isCanvasOpen}
              onOpenCanvasAction={openCanvasFilesTab}
              onToggleSidebarAction={() => setIsSidebarOpen(!isSidebarOpen)}
            />

            {/* 4. Canvas Panel (Collapsible) */}
            <CanvasPanel
              isOpen={isCanvasOpen}
              onCloseAction={() => setIsCanvasOpen(false)}
              conversationId={currentConversationId || undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}
