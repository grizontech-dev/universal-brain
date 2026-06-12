'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import VerifyEmailGate from '@/components/auth/VerifyEmailGate';
import IconRail from '@/components/chat/IconRail';
import {
  ThreadListProvider,
  useThreadList,
} from '@/context/ThreadListContext';

function MainFallback() {
  return (
    <div className='flex h-screen w-full items-center justify-center bg-chat text-text-primary'>
      <div className='h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent' />
    </div>
  );
}

function MainChromeInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const {
    isAuthenticated,
    isLoading,
    openAuthModal,
    needsEmailVerification,
  } = useAuth();
  const { setThreadListOpen, toggleThreadList } = useThreadList();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      openAuthModal('signin-email');
    }
  }, [isLoading, isAuthenticated, openAuthModal]);

  const activeMode = pathname.startsWith('/settings') ? 'settings' : pathname.startsWith('/brain') ? 'brain' : 'chat';
  const isChatRoute = pathname.startsWith('/chat');

  const handleChatClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 2) {
      e.preventDefault();
      if (isChatRoute) {
        toggleThreadList();
      }
      return;
    }
    router.push('/chat');
    setThreadListOpen(true);
  };

  const handleSettingsClick = () => {
    router.push('/settings/general');
  };

  const handleBrainClick = () => {
    router.push('/brain');
  };

  if (!isLoading && needsEmailVerification) {
    return (
      <Suspense fallback={<MainFallback />}>
        <VerifyEmailGate />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<MainFallback />}>
      <div className='flex h-[100dvh] w-full bg-chat text-text-primary overflow-hidden relative'>
        <IconRail
          activeMode={activeMode}
          onChatClick={handleChatClick}
          onSettingsClick={handleSettingsClick}
          onBrainClick={handleBrainClick}
        />
        <div className='flex flex-1 min-w-0 overflow-hidden'>{children}</div>
      </div>
    </Suspense>
  );
}

export default function MainAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThreadListProvider>
      <MainChromeInner>{children}</MainChromeInner>
    </ThreadListProvider>
  );
}
