'use client'

import type { JSX } from 'react'
import { PlusIcon } from '@/components/ui/icons'

interface AddAttachmentButtonProps {
  onClick: () => void
}

export function AddAttachmentButton({ onClick }: AddAttachmentButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add attachment"
      className="grid h-8.5 w-8.5 flex-none place-items-center self-center rounded-full text-text-muted transition-colors duration-200 hover:bg-surface-3 hover:text-text-primary focus-visible:bg-surface-3"
    >
      <PlusIcon className="h-4.5 w-4.5" />
    </button>
  )
}
