'use client';

import { Suspense, useState, useEffect } from 'react';
import { X } from 'lucide-react';
import ThreadPanel from '@/components/chat/ThreadPanel';
import { useThreadList } from '@/context/ThreadListContext';

function BrainFallback() {
  return (
    <div className='flex h-screen w-full items-center justify-center bg-[#0a0a0a] text-white'>
      <div className='h-8 w-8 animate-spin rounded-full border-2 border-[#976df8] border-t-transparent' />
    </div>
  );
}

export default function BrainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { threadListOpen } = useThreadList();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const handleToggleSidebar = () => {
      setIsSidebarOpen((prev) => !prev);
    };

    window.addEventListener('toggleBrainSidebar', handleToggleSidebar);
    return () => {
      window.removeEventListener('toggleBrainSidebar', handleToggleSidebar);
    };
  }, []);

  const showThreadDesktop = threadListOpen;
  const threadDrawerExpanded = showThreadDesktop || isSidebarOpen;
  const sidebarWidthClass = threadDrawerExpanded
    ? 'w-[290px] sm:w-[320px] lg:w-[260px]'
    : 'w-0 max-w-0 overflow-hidden lg:w-0 lg:overflow-hidden';

  return (
    <Suspense fallback={<BrainFallback />}>
      <div className='flex flex-1 min-w-0 h-full w-full bg-[#0a0a0a] text-white overflow-hidden relative'>
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

        <div className='flex-1 flex flex-col min-w-0 overflow-hidden relative h-full'>
          {children}
        </div>
      </div>
    </Suspense>
  );
}
