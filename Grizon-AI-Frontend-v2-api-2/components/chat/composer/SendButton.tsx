'use client'

import type { JSX } from 'react'
import { ArrowRightIcon } from '@/components/ui/icons'

interface SendButtonProps {
  disabled: boolean
}

export function SendButton({ disabled }: SendButtonProps): JSX.Element {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-label="Send message"
      className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent text-white transition-all duration-200 hover:not-disabled:-translate-y-px hover:not-disabled:brightness-110 active:not-disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
    >
      <ArrowRightIcon className="h-4.5 w-4.5 -rotate-90" />
    </button>
  )
}
