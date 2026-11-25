'use client'

import { useState, type FormEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { adminFetch } from '@/lib/admin/admin-fetch'
import { formatCT } from '@/lib/format-ct'
import { VENUE_HINT } from '@/lib/social-kit/platforms'
import { POST_URL_MAX_LENGTH, VENUE_MAX_LENGTH, postedAgoLabel, type PostLogEntry } from '@/lib/social-kit/tracker'
import type { SocialPlatform } from '@/lib/social-kit/types'
import { C, platformLabel } from './ui'

const ENDPOINT = '/api/admin/social-kit/posts'

interface Props {
  readonly jobId: string
  readonly platform: SocialPlatform
  /** This job's logs on this platform, newest first. */
  readonly logs: readonly PostLogEntry[]
  readonly now: Date
  readonly onAdded: (entry: PostLogEntry) => void
  readonly onRemoved: (id: string) => void
}

/** The created log from a 201 body, or null when the body is not the shape the route sends. */
function readCreated(body: { data?: unknown }): PostLogEntry | null {
  const data = body.data
  if (!data || typeof data !== 'object') return null
  const entry = data as Partial<PostLogEntry>
  return typeof entry.id === 'string' && typeof entry.jobId === 'string' && typeof entry.postedAt === 'string'
    ? (entry as PostLogEntry)
    : null
}

const input = {
  flex: '1 1 180px',
  minWidth: 0,
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${C.line}`,
  fontSize: 13.5,
  color: C.ink,
  background: C.surface,
} as const

/** Log that this job went out on this platform, and see or undo earlier logs. */
export default function PostLogPanel({ jobId, platform, logs, now, onAdded, onRemoved }: Props) {
  const [venue, setVenue] = useState('')
  const [postUrl, setPostUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const label = platformLabel(platform)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const result = await adminFetch<{ data?: unknown }>(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, platform, venue, postUrl }),
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const created = readCreated(result.data)
    if (!created) {
      setError('The post was saved, but the answer could not be read. Reload the page to see it.')
      return
    }
    onAdded(created)
    setVenue('')
    setPostUrl('')
  }

  async function remove(id: string) {
    if (confirming !== id) {
      setConfirming(id)
      return
    }
    setConfirming(null)
    setError(null)
    // The route is idempotent: an entry already gone answers ok too.
    const result = await adminFetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!result.ok) {
      setError(result.error)
      return
    }
    onRemoved(id)
  }

  return (
    <section
      aria-label={`${label} post log`}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 10, background: C.sunk, border: `1px solid ${C.line}` }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
        <strong style={{ color: C.ink }}>{label} post log</strong>
        <span style={{ color: logs.length ? C.muted : C.amber }}>
          {logs.length
            ? `Posted ${logs.length} ${logs.length === 1 ? 'time' : 'times'}, last ${postedAgoLabel(logs[0].postedAt, now).toLowerCase()}`
            : `Not posted on ${label} yet`}
        </span>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          id={`venue-${jobId}-${platform}`}
          aria-label={`Where on ${label} (optional)`}
          placeholder={`Where (optional): ${VENUE_HINT[platform]}`}
          value={venue}
          maxLength={VENUE_MAX_LENGTH}
          onChange={(e) => setVenue(e.target.value)}
          style={input}
        />
        <input
          id={`url-${jobId}-${platform}`}
          aria-label="Link to the post (optional)"
          placeholder="Link to the post (optional)"
          type="url"
          value={postUrl}
          maxLength={POST_URL_MAX_LENGTH}
          onChange={(e) => setPostUrl(e.target.value)}
          style={input}
        />
        <button
          type="submit"
          disabled={saving}
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: C.accent, color: '#FFFFFF', fontWeight: 700, fontSize: 13.5, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, whiteSpace: 'nowrap' }}
        >
          {saving ? 'Saving' : 'Mark as posted'}
        </button>
      </form>

      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: C.red }}>{error}</p>}

      {logs.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {logs.map((log) => (
            <li key={log.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: C.ink }}>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: C.muted }}>{formatCT(log.postedAt)}</span>
              {log.venue && <span>{log.venue}</span>}
              {log.postUrl && (
                <a href={log.postUrl} target="_blank" rel="noreferrer noopener" style={{ color: C.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  View post <ExternalLink size={12} aria-hidden />
                </a>
              )}
              <button
                type="button"
                onClick={() => remove(log.id)}
                onBlur={() => setConfirming((current) => (current === log.id ? null : current))}
                style={{ marginLeft: 'auto', border: 'none', background: 'none', color: confirming === log.id ? C.red : C.muted, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}
              >
                {confirming === log.id ? 'Click again to remove' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
