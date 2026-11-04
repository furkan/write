export const CALLOUT_VARIANTS = {
  info: { icon: 'ℹ️', label: 'Info', alert: 'NOTE' },
  success: { icon: '✅', label: 'Success', alert: 'TIP' },
  warning: { icon: '⚠️', label: 'Warning', alert: 'WARNING' },
  danger: { icon: '🛑', label: 'Danger', alert: 'CAUTION' },
} as const

export type CalloutVariant = keyof typeof CALLOUT_VARIANTS

export const variantList = Object.keys(CALLOUT_VARIANTS) as CalloutVariant[]

export const isVariant = (value: unknown): value is CalloutVariant =>
  typeof value === 'string' && value in CALLOUT_VARIANTS
