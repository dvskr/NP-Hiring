'use client'

import { useState, type CSSProperties } from 'react'
import { Check, Copy } from 'lucide-react'
import { formatCT } from '@/lib/format-ct'
import { PLATFORM_LABEL } from '@/lib/social-kit/platforms'
import { SOCIAL_PLATFORMS } from '@/lib/social-kit/tracker'
import type { SocialPlatform } from '@/lib/social-kit/types'

/** Shared look and helpers for the social kit's client components. */

/** The admin panel's palette: ink and muted text, the board's accent (AdminSidebar). */
export const C = {
  ink: '#1A2E35',
  muted: '#64748B',
  line: 'rgba(0,0,0,0.08)',
  accent: '#BE185D',
  accentSoft: '#FDF2F8',
  amber: '#B45309',
  amberSoft: '#FEF3C7',
  red: '#B91C1C',
  surface: '#FFFFFF',
  sunk: '#F8FAFC',
} as const

export const card: CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.line}`,
  borderRadius: 14,
  padding: '20px 20px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 0,
}

export const pill = (color: string, background: string): CSSProperties => ({
  fontSize: 11,
  fontWeight: 700,
  color,
  background,
  padding: '2px 8px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
})

/** The platform tabs, in post order, with the names the posts use (lib/social-kit/platforms.ts). */
export const PLATFORMS: readonly { readonly id: SocialPlatform; readonly label: string }[] = SOCIAL_PLATFORMS.map((id) => ({
  id,
  label: PLATFORM_LABEL[id],
}))

export function platformLabel(id: SocialPlatform): string {
  return PLATFORM_LABEL[id] ?? id
}

/** "Oct 23, 2026" in Central time. */
export function shortDate(iso: string): string {
  return formatCT(iso, 'date').replace(/ CT$/, '')
}

/** Clipboard first; if the browser refuses, select the text so Ctrl+C works. */
export async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    fallback?.focus()
    fallback?.select()
    return false
  }
}

const COPY_RESET_MS = 1800

export function CopyButton({ onCopy, label }: { onCopy: () => Promise<boolean>; label: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'selected' | 'failed'>('idle')
  const copy = async () => {
    setState((await onCopy()) ? 'done' : 'selected')
    window.setTimeout(() => setState('idle'), COPY_RESET_MS)
  }
  const text =
    state === 'done' ? 'Copied' : state === 'selected' ? 'Selected, press Ctrl+C' : state === 'failed' ? 'Copy failed' : label
  return (
    <button
      type="button"
      onClick={() => {
        copy().catch(() => setState('failed'))
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 12px',
        borderRadius: 8,
        border: `1px solid ${state === 'done' ? C.accent : C.line}`,
        background: state === 'done' ? C.accentSoft : C.surface,
        color: state === 'done' ? C.accent : C.ink,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {state === 'done' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span aria-live="polite">{text}</span>
    </button>
  )
}
