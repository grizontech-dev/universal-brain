export type ButtonVariant = 'accent' | 'outline' | 'text'
export type ButtonSize = 'sm' | 'md'

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-display text-sm font-semibold transition-all duration-short ease-out active:translate-y-px'

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-[1.1rem] py-[0.55rem]',
  md: 'px-[1.4rem] py-[0.7rem]',
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  accent: 'bg-accent-deep text-accent-ink hover:-translate-y-0.5 hover:bg-accent',
  outline: 'border border-rule text-ink hover:-translate-y-0.5 hover:border-accent hover:text-accent-text',
  text: 'text-ink-2 hover:bg-paper-3 hover:text-ink',
}

const ACCENT_SHADOW_CLASSES = 'shadow-sm hover:shadow-md'

interface ButtonClassesOptions {
  shadow?: boolean
}

export function buttonClasses(
  variant: ButtonVariant = 'accent',
  size: ButtonSize = 'sm',
  { shadow = true }: ButtonClassesOptions = {},
): string {
  const shadowClasses = variant === 'accent' && shadow ? ACCENT_SHADOW_CLASSES : ''
  return `${BASE_CLASSES} ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${shadowClasses}`.trim()
}

export const TEXT_LINK_CLASSES =
  'inline-flex items-center gap-1 border-b border-accent/40 pb-px font-semibold text-accent-text transition-all duration-short ease-out hover:gap-2 hover:border-accent-text'
