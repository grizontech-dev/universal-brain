'use client'

import { useCallback, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { AddAttachmentButton } from './AddAttachmentButton'
import { ComposerActions } from './ComposerActions'

export interface ComposerSubmitPayload {
  message: string
  agentSlug: string | null
  attachedFileIds?: string[]
}

interface AttachedItem {
  id: string
  name: string
  size: number
  type: string
  status: 'uploading' | 'ready' | 'error'
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
  const [attachments, setAttachments] = useState<AttachedItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasContent = value.trim().length > 0 || attachments.some(a => a.status === 'ready')
  const canSubmit = !disabled && hasContent && !isUploading

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    setIsUploading(true)
    const fileList = Array.from(files)

    for (const file of fileList) {
      const tempId = crypto.randomUUID()
      const newItem: AttachedItem = {
        id: tempId,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'uploading',
      }
      setAttachments((prev) => [...prev, newItem])

      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const res = reader.result as string
            resolve(res.split(',')[1] || '')
          }
          reader.onerror = reject
          reader.readAsDataURL(file)
        })

        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') || localStorage.getItem('access_token') || localStorage.getItem('grizon_access_token') : null

        const reqHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }

        let res = await fetch('/api/v1/files/upload', {
          method: 'POST',
          headers: reqHeaders,
          credentials: 'include',
          body: JSON.stringify({
            conversationId,
            fileName: file.name,
            fileType: file.type || 'application/pdf',
            fileSize: file.size,
            contentBase64: base64,
          }),
        }).catch(() => null)

        if (!res || !res.ok) {
          res = await fetch('http://localhost:4000/api/v1/files/upload', {
            method: 'POST',
            headers: reqHeaders,
            credentials: 'include',
            body: JSON.stringify({
              conversationId,
              fileName: file.name,
              fileType: file.type || 'application/pdf',
              fileSize: file.size,
              contentBase64: base64,
            }),
          }).catch(() => null)
        }

        if (res && res.ok) {
          const data = await res.json()
          const uploadedId = data.data?.file?.id || tempId
          setAttachments((prev) =>
            prev.map((item) => (item.id === tempId ? { ...item, id: uploadedId, status: 'ready' } : item))
          )
        } else {
          setAttachments((prev) => prev.filter((item) => item.id !== tempId))
        }
      } catch (err) {
        setAttachments((prev) => prev.filter((item) => item.id !== tempId))
      }
    }
    setIsUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!canSubmit) return
    const readyFileIds = attachments.filter((a) => a.status === 'ready').map((a) => a.id)
    onSubmit?.({ message: value.trim(), agentSlug: selectedAgentSlug, attachedFileIds: readyFileIds })
    setValue('')
    setAttachments([])
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey || disabled) return
    event.preventDefault()
    if (!canSubmit) return
    const readyFileIds = attachments.filter((a) => a.status === 'ready').map((a) => a.id)
    onSubmit?.({ message: value.trim(), agentSlug: selectedAgentSlug, attachedFileIds: readyFileIds })
    setValue('')
    setAttachments([])
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl flex flex-col gap-2 rounded-2xl border border-border-default bg-surface-2/80 backdrop-blur-md px-4 py-2.5 shadow-xl focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20 transition-all duration-200"
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1 border-b border-border-default/40 pb-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-3 text-xs text-text-primary border border-border-default"
            >
              <span className="truncate max-w-[120px]">{att.name}</span>
              {att.status === 'uploading' ? (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              ) : (
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="text-text-muted hover:text-red-400 ml-1 font-bold"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
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
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </form>
  )
}
