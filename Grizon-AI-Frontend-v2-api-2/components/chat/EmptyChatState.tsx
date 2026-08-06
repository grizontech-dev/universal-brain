'use client'

import { useState, type JSX } from 'react'
import { useAuth } from '@/context/AuthContext'
import { AmbientBackground } from './AmbientBackground'
import { useGreeting } from '@/lib/useGreeting'
import { ChatComposer } from './composer/ChatComposer'

interface EmptyChatStateProps {
  onSelectAction: (text: string, agentSlug: string | null) => void
}

export function EmptyChatState({ onSelectAction }: EmptyChatStateProps): JSX.Element {
  const { user } = useAuth()
  const { dateLabel, greeting } = useGreeting(user?.name || user?.email || 'there')

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center w-full px-4 sm:px-6 py-8 text-center min-h-[75vh]">
      <AmbientBackground />
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center">
        <p className="mb-3 min-h-[1.4em] text-xs sm:text-sm text-text-muted font-medium">{dateLabel || ' '}</p>
        <h1 className="w-full max-w-full text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold leading-tight tracking-tight text-text-primary break-words">
          {greeting}
        </h1>
        <p className="mt-3 max-w-[42ch] text-sm sm:text-base text-text-secondary">
          What should we <span className="font-semibold text-accent">focus on</span> today?
        </p>
      </div>

      <div className="relative z-10 mt-6 sm:mt-8 w-full max-w-[800px] justify-center px-2">
        <ChatComposer
          onSubmit={(payload) => onSelectAction(payload.message, payload.agentSlug)}
        />
      </div>

      <p className="relative z-10 mt-4 sm:mt-6 max-w-full text-[11px] sm:text-xs text-text-muted px-4">
        Grizon can make mistakes. Check important info before you rely on it.
      </p>
    </div>
  )
}
