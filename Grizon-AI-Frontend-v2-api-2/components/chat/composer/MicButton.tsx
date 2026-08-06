'use client'

import { useEffect, useRef, useState, type JSX } from 'react'
import { MicIcon } from '@/components/ui/icons'

const AUTO_REVERT_MS = 4000

export function MicButton(): JSX.Element {
  const [recording, setRecording] = useState(false)
  const revertTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(revertTimer.current), [])

  function handleClick(): void {
    clearTimeout(revertTimer.current)
    setRecording((wasRecording) => {
      const next = !wasRecording
      if (next) revertTimer.current = setTimeout(() => setRecording(false), AUTO_REVERT_MS)
      return next
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={recording ? 'Stop recording' : 'Use voice input'}
      className={`relative grid h-9 w-9 flex-none place-items-center rounded-full transition-all duration-200 hover:-translate-y-px ${
        recording ? 'bg-danger text-white animate-pulse' : 'bg-accent/15 text-accent hover:bg-accent hover:text-white'
      }`}
    >
      <MicIcon className="h-4.5 w-4.5" />
    </button>
  )
}
