'use client';

import { Suspense } from 'react';
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import ThreadPanel from '@/components/chat/ThreadPanel';
import MessagesStaticShell from '@/components/chat/MessagesStaticShell';
import CanvasPanel from '@/components/chat/CanvasPanel';
import { useConversations } from '@/context/ConversationContext';
import { useCanvas } from '@/context/CanvasContext';
import { useThreadList } from '@/context/ThreadListContext';
import type { CanvasArtifact } from '@/lib/types';

function ChatFallback() {
  return (
    <div className='flex h-screen w-full items-center justify-center bg-chat text-text-primary'>
      <div className='h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent' />
    </div>
  );
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { threadListOpen } = useThreadList();
  const {
    isOpen: isCanvasOpen,
    setIsOpen: setIsCanvasOpen,
    openCanvasFilesTab,
    setMode,
    setActiveArtifact,
    setShouldRun,
  } = useCanvas();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { currentConversationId } = useConversations();

  useEffect(() => {
    const handleOpenCode = (e: Event) => {
      const ev = e as CustomEvent;
      const detail = ev.detail || {};
      const language =
        typeof detail.language === 'string' ? detail.language : '';
      const code = typeof detail.code === 'string' ? detail.code : '';
      const runRequested = !!detail.shouldRun;

      setMode(
        language.toLowerCase().includes('document') ? 'document' : 'code',
      );

      setActiveArtifact({
        id: 'imported-' + Date.now(),
        type: language.toLowerCase().includes('document') ? 'document' : 'code',
        content: code,
        language: language,
        title: 'Imported Code',
      } as unknown as CanvasArtifact);

      if (runRequested) {
        setShouldRun(false);
      }

      setIsCanvasOpen(true);
    };

    window.addEventListener(
      'openCodeInCanvas',
      handleOpenCode as EventListener,
    );

    return () => {
      window.removeEventListener(
        'openCodeInCanvas',
        handleOpenCode as EventListener,
      );
    };
  }, [setIsCanvasOpen, setMode, setActiveArtifact, setShouldRun]);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const showThreadDesktop = threadListOpen;
  const threadDrawerExpanded = showThreadDesktop || isSidebarOpen;
  const sidebarWidthClass = threadDrawerExpanded
    ? 'w-[290px] sm:w-[320px] lg:w-[260px]'
    : 'w-0 max-w-0 overflow-hidden lg:w-0 lg:overflow-hidden';

  return (
    <Suspense fallback={<ChatFallback />}>
      <div className='flex flex-1 min-w-0 h-full w-full bg-chat text-text-primary overflow-hidden relative'>
        {isSidebarOpen && (
          <div
            className='fixed inset-0 bg-black/60 backdrop-blur-sm z-[40] lg:hidden animate-in fade-in duration-300'
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        <div
          className={`
                    fixed inset-y-0 left-0 z-[60] flex transition-all duration-300 ease-in-out lg:relative lg:translate-x-0 no-print
                    ${isSidebarOpen ? 'translate-x-0 shadow-[0_0_50px_rgba(0,0,0,0.8)]' : '-translate-x-full lg:translate-x-0 invisible lg:visible'}
                    ${sidebarWidthClass} bg-sidebar border-r border-border-subtle lg:border-r-0
                `}
        >
          <button
            type='button'
            onClick={() => setIsSidebarOpen(false)}
            className='lg:hidden absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg bg-surface-2 text-text-muted hover:text-text-primary z-[70] no-print'
          >
            <X size={18} />
          </button>

          {threadDrawerExpanded ? (
            <div className='flex-1 overflow-hidden min-w-0 w-full no-print animate-in slide-in-from-left-2 duration-300'>
              <ThreadPanel
                onSelectAction={() => {
                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>

        <div className='flex flex-1 min-w-0 relative h-full'>
          <div className='flex-1 flex flex-col min-w-0 lg:min-w-[420px] 2xl:min-w-[520px] overflow-hidden no-print'>
            <MessagesStaticShell
              conversationId={currentConversationId}
              isCanvasOpen={isCanvasOpen}
              onOpenCanvasAction={openCanvasFilesTab}
              onToggleSidebarAction={toggleSidebar}
            />
          </div>

          <CanvasPanel
            isOpen={isCanvasOpen}
            onCloseAction={() => setIsCanvasOpen(false)}
            conversationId={currentConversationId || undefined}
          />

          <div className='no-print'>{children}</div>
        </div>
      </div>
    </Suspense>
  );
}
