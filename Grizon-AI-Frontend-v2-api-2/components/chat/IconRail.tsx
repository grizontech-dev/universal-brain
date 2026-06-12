'use client';

import { MessageSquare, Settings, Brain } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface IconRailProps {
  activeMode: 'chat' | 'settings' | 'brain';
  onChatClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onSettingsClick: () => void;
  onBrainClick: () => void;
}

export default function IconRail({
  activeMode,
  onChatClick,
  onSettingsClick,
  onBrainClick,
}: IconRailProps) {
  const { user } = useAuth();
  const initial = user?.name
    ? user.name.charAt(0).toUpperCase()
    : user?.email
      ? user.email.charAt(0).toUpperCase()
      : '?';
  const fullName = user?.name || user?.email || 'User';

  return (
    <div
      className='icon-rail hidden lg:flex flex-col items-center py-4 px-2 gap-2 shrink-0 h-full bg-sidebar border-r border-border-subtle'
      style={{ width: '60px' }}
    >
      <div
        className='relative mb-6 cursor-pointer hover:opacity-80 transition-opacity'
        title='Grizon AI'
      >
        <img
          src='/Logo.svg'
          alt='Grizon'
          className='w-10 h-10 object-contain'
        />
      </div>

      <button
        type='button'
        className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all mb-1 group relative ${
          activeMode === 'chat'
            ? 'bg-surface-3 text-text-primary'
            : 'text-text-faint hover:text-text-secondary hover:bg-surface-2'
        }`}
        onClick={onChatClick}
        aria-label='Chats'
      >
        <MessageSquare
          size={20}
          className='transition-transform duration-200 group-active:scale-95'
        />
        <div className='absolute left-full ml-3 px-2 py-1 bg-elevated border border-border-default text-text-primary text-[11px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-xl'>
          Chats
        </div>
      </button>

      <button
        type='button'
        className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all mb-1 group relative ${
          activeMode === 'brain'
            ? 'bg-surface-3 text-text-primary'
            : 'text-text-faint hover:text-text-secondary hover:bg-surface-2'
        }`}
        onClick={onBrainClick}
        aria-label='Brain'
      >
        <Brain
          size={20}
          className='transition-transform duration-200 group-active:scale-95'
        />
        <div className='absolute left-full ml-3 px-2 py-1 bg-elevated border border-border-default text-text-primary text-[11px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-xl'>
          Brain
        </div>
      </button>

      <div className='flex-1' />

      <button
        type='button'
        className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all mb-1 group relative ${
          activeMode === 'settings'
            ? 'bg-surface-3 text-text-primary'
            : 'text-text-faint hover:text-text-secondary hover:bg-surface-2'
        }`}
        onClick={onSettingsClick}
        aria-label='Settings'
      >
        <Settings size={20} />
        <div className='absolute left-full ml-3 px-2 py-1 bg-elevated border border-border-default text-text-primary text-[11px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-xl'>
          Settings
        </div>
      </button>

      <div
        className='w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center text-[12px] font-bold text-accent cursor-pointer mt-1 hover:brightness-110 transition-all border border-accent/15'
        title={fullName}
      >
        {initial}
      </div>
    </div>
  );
}
