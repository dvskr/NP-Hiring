'use client'

import { useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import { LINKEDIN_LIMIT_NOTE, REDDIT_LIMIT_NOTE } from '@/lib/social-kit/limits'
import { isRecent, postedAgoLabel, type PostLogEntry } from '@/lib/social-kit/tracker'
import type { PostPart, SocialKitEntry, SocialPlatform, SocialPost } from '@/lib/social-kit/types'
import PostLogPanel from './PostLogPanel'
import { C, card, copyText, CopyButton, pill, platformLabel, shortDate } from './ui'

const TRIM_NOTE: Partial<Record<SocialPlatform, string>> = {
  linkedin: LINKEDIN_LIMIT_NOTE,
  reddit: REDDIT_LIMIT_NOTE,
}

function PartBox({ part }: { part: PostPart }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const over = part.limit !== null && part.length > part.limit
  const lines = part.text.split('\n').length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
          {part.label}
          <span style={{ marginLeft: 8, fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: over ? C.red : C.muted, fontVariantNumeric: 'tabular-nums' }}>
            {part.length.toLocaleString('en-US')}
            {part.limit !== null ? ` / ${part.limit.toLocaleString('en-US')}` : ' characters'}
            {over ? ', over the limit' : ''}
          </span>
        </span>
        <CopyButton label={`Copy ${part.label.toLowerCase()}`} onCopy={() => copyText(part.text, ref.current)} />
      </div>
      <textarea
        ref={ref}
        readOnly
        value={part.text}
        rows={Math.min(Math.max(lines, 2), 16)}
        aria-label={part.label}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          resize: 'vertical',
          padding: '10px 12px',
          borderRadius: 10,
          border: `1px solid ${C.line}`,
          background: C.sunk,
          color: C.ink,
          font: '13.5px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      />
    </div>
  )
}

function LinkRow({ post, clicks }: { post: SocialPost; clicks: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: C.muted }}>
      <span>Tracked link</span>
      <code style={{ color: C.ink, background: C.sunk, padding: '3px 8px', borderRadius: 6, wordBreak: 'break-all' }}>{post.link}</code>
      <CopyButton label="Copy link" onCopy={() => copyText(post.link, null)} />
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {clicks} {clicks === 1 ? 'click' : 'clicks'}
      </span>
    </div>
  )
}

function PostedBadge({ last, platform, now }: { last: PostLogEntry | undefined; platform: SocialPlatform; now: Date }) {
  const label = platformLabel(platform)
  if (!last) return <span style={pill(C.amber, C.amberSoft)}>Not posted on {label}</span>
  const ago = postedAgoLabel(last.postedAt, now)
  return isRecent(last.postedAt, now)
    ? <span style={pill(C.accent, C.accentSoft)}>Posted on {label} {ago.toLowerCase()}</span>
    : <span style={pill(C.muted, C.sunk)}>Last on {label} {ago.toLowerCase()}</span>
}

function Details({ entry, clicks }: { entry: SocialKitEntry; clicks: Readonly<Record<string, number>> }) {
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.ink }}>Full job details and every platform&apos;s link</summary>
      <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(90px, max-content) 1fr', gap: '6px 16px', fontSize: 13.5 }}>
          {entry.facts.map((fact) => (
            <div key={fact.label} style={{ display: 'contents' }}>
              <dt style={{ color: C.muted }}>{fact.label}</dt>
              <dd style={{ margin: 0, color: C.ink }}>{fact.value}</dd>
            </div>
          ))}
          {entry.companyWebsite && (
            <div style={{ display: 'contents' }}>
              <dt style={{ color: C.muted }}>Website</dt>
              <dd style={{ margin: 0, wordBreak: 'break-all' }}>{entry.companyWebsite}</dd>
            </div>
          )}
        </dl>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6, color: C.ink, background: C.sunk, borderRadius: 10, padding: '12px 14px' }}>
          {entry.descriptionText || 'No description on file.'}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {entry.posts.map((p) => (
            <div key={p.platform} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <span style={{ width: 84, color: C.muted }}>{p.label}</span>
              <code style={{ color: C.ink, wordBreak: 'break-all' }}>{p.link}</code>
              <span style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{clicks[p.code] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}

interface Props {
  readonly entry: SocialKitEntry
  readonly platform: SocialPlatform
  readonly clicks: Readonly<Record<string, number>>
  /** This job's logs on the selected platform, newest first. */
  readonly logs: readonly PostLogEntry[]
  readonly now: Date
  readonly trackerAvailable: boolean
  readonly onAdded: (entry: PostLogEntry) => void
  readonly onRemoved: (id: string) => void
}

export default function JobCard({ entry, platform, clicks, logs, now, trackerAvailable, onAdded, onRemoved }: Props) {
  const post = entry.posts.find((p) => p.platform === platform) ?? entry.posts[0]
  const totalClicks = entry.posts.reduce((sum, p) => sum + (clicks[p.code] ?? 0), 0)
  return (
    <article id={`kit-${entry.id}`} style={{ ...card, scrollMarginTop: 16 }} aria-labelledby={`job-${entry.id}`}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {entry.isNew && <span style={pill(C.accent, C.accentSoft)}>New</span>}
            {trackerAvailable && <PostedBadge last={logs[0]} platform={platform} now={now} />}
          </div>
          <h2 id={`job-${entry.id}`} style={{ margin: '6px 0 2px', fontSize: 18, fontWeight: 800, color: C.ink, textWrap: 'balance' }}>
            {entry.title}
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{entry.employer}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, fontSize: 12.5, color: C.muted, textAlign: 'right' }}>
          <span>Live since {shortDate(entry.postedAt)}</span>
          <span>{entry.expiresAt ? `Expires ${shortDate(entry.expiresAt)}` : 'No expiry date'}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalClicks} tracked {totalClicks === 1 ? 'click' : 'clicks'}, all platforms</span>
          <a href={entry.jobUrl} target="_blank" rel="noreferrer" style={{ color: C.accent, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Job page <ExternalLink size={13} aria-hidden />
          </a>
        </div>
      </header>

      {post.trimmed && TRIM_NOTE[post.platform] && (
        <p style={{ margin: 0, fontSize: 13, color: C.amber, background: C.amberSoft, padding: '8px 12px', borderRadius: 8 }}>
          {TRIM_NOTE[post.platform]}
        </p>
      )}

      {post.parts.map((part) => (
        <PartBox key={`${post.platform}-${part.label}`} part={part} />
      ))}

      <LinkRow post={post} clicks={clicks[post.code] ?? 0} />

      {trackerAvailable && (
        <PostLogPanel
          key={`${entry.id}-${post.platform}`}
          jobId={entry.id}
          platform={post.platform}
          logs={logs}
          now={now}
          onAdded={onAdded}
          onRemoved={onRemoved}
        />
      )}

      <Details entry={entry} clicks={clicks} />
    </article>
  )
}
