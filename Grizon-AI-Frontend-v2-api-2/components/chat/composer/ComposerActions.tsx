'use client'

import type { JSX } from 'react'
import { MicButton } from './MicButton'
import { SendButton } from './SendButton'

interface ComposerActionsProps {
  showSend: boolean
  canSubmit: boolean
  selectedAgentSlug: string | null
  onAgentSelect: (slug: string | null) => void
}

export function ComposerActions({
  showSend,
  canSubmit,
  selectedAgentSlug,
  onAgentSelect,
}: ComposerActionsProps): JSX.Element {
  return (
    <div className="flex items-center gap-2 self-center">
      {showSend ? <SendButton disabled={!canSubmit} /> : <MicButton />}
    </div>
  )
}
