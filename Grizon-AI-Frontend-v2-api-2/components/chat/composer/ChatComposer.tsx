'use client'

import { useCallback, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { AddAttachmentButton } from './AddAttachmentButton'
import { ComposerActions } from './ComposerActions'

export interface ComposerSubmitPayload {
  message: string
  agentSlug: string | null
}

interface ChatComposerProps {
  onSubmit?: (payload: ComposerSubmitPayload) => void
  disabled?: boolean
  conversationId?: string | null
}

export function ChatComposer({
  onSubmit,
  disabled,
  conversationId = null,
}: ChatComposerProps): JSX.Element {
  const [value, setValue] = useState('')
  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasContent = value.trim().length > 0
  const canSubmit = !disabled && hasContent

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit?.({ message: value.trim(), agentSlug: selectedAgentSlug })
    setValue('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey || disabled) return
    event.preventDefault()
    if (!canSubmit) return
    onSubmit?.({ message: value.trim(), agentSlug: selectedAgentSlug })
    setValue('')
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl flex items-center gap-2 rounded-full border border-border-default bg-surface-2/80 backdrop-blur-md px-4 py-2 shadow-xl focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-200"
    >
      <AddAttachmentButton onClick={() => fileInputRef.current?.click()} />

      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Grizon..."
        aria-label="Ask Grizon"
        disabled={disabled}
        className="w-full resize-none border-0 bg-transparent py-1.5 px-2 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60 max-h-32"
      />

      <ComposerActions
        showSend={hasContent}
        canSubmit={canSubmit}
        selectedAgentSlug={selectedAgentSlug}
        onAgentSelect={setSelectedAgentSlug}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={() => {}}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </form>
  )
}
