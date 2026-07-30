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
    <div className="relative flex flex-1 flex-col items-center justify-center w-full px-4 py-8 text-center min-h-[75vh]">
      <AmbientBackground />
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center">
        <p className="mb-3 min-h-[1.4em] text-sm text-text-muted font-medium">{dateLabel || ' '}</p>
        <h1 className="max-w-[20ch] text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight tracking-tight text-text-primary">
          {greeting}
        </h1>
        <p className="mt-3 max-w-[42ch] text-base text-text-secondary">
          What should we <span className="font-semibold text-accent">focus on</span> today?
        </p>
      </div>

      <div className="relative z-10 mt-8 flex w-full max-w-[800px] justify-center px-2">
        <ChatComposer
          onSubmit={(payload) => onSelectAction(payload.message, payload.agentSlug)}
        />
      </div>

      <p className="relative z-10 mt-6 max-w-full text-xs text-text-muted">
        Grizon can make mistakes. Check important info before you rely on it.
      </p>
    </div>
  )
}
