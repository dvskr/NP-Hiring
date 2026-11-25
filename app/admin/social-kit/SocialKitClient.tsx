'use client'

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { formatCT } from '@/lib/format-ct'
import { groupPostLogs, isRecent, trackerKey, RECENT_POST_DAYS, type PostLogEntry } from '@/lib/social-kit/tracker'
import type { SocialKitEntry, SocialPlatform } from '@/lib/social-kit/types'
import JobCard from './JobCard'
import TrackerGrid from './TrackerGrid'
import { C, card, PLATFORMS, platformLabel } from './ui'

interface Props {
  readonly entries: readonly SocialKitEntry[]
  readonly clicks: Readonly<Record<string, number>>
  /** False when the click counts could not be read; the posts still work. */
  readonly clicksAvailable: boolean
  readonly logs: readonly PostLogEntry[]
  /** False when the tracker table could not be read; the posts still work. */
  readonly trackerAvailable: boolean
  readonly generatedAt: string
}

const PLATFORM_KEY = 'social-kit:platform'
const STORAGE_EVENT = 'social-kit-storage'

function readPlatform(): string | null {
  try {
    return window.localStorage.getItem(PLATFORM_KEY)
  } catch {
    // Private windows and blocked storage: the default tab is used.
    return null
  }
}

function savePlatform(id: SocialPlatform): void {
  try {
    window.localStorage.setItem(PLATFORM_KEY, id)
  } catch {
    // Private windows and blocked storage: the choice lasts for this visit.
  }
  window.dispatchEvent(new Event(STORAGE_EVENT))
}

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(STORAGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(STORAGE_EVENT, onChange)
  }
}

interface ToggleProps {
  readonly id: string
  readonly checked: boolean
  readonly onChange: (value: boolean) => void
  readonly children: ReactNode
}

function Toggle({ id, checked, onChange, children }: ToggleProps) {
  return (
    <label htmlFor={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: C.ink, cursor: 'pointer' }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

interface PlatformTabsProps {
  readonly platform: SocialPlatform
  readonly onChoose: (id: SocialPlatform) => void
}

function PlatformTabs({ platform, onChoose }: PlatformTabsProps) {
  return (
    <div role="tablist" aria-label="Platform" style={{ display: 'flex', gap: 4, padding: 4, background: C.sunk, border: `1px solid ${C.line}`, borderRadius: 10, flexWrap: 'wrap', alignSelf: 'flex-start' }}>
      {PLATFORMS.map((p) => (
        <button
          key={p.id}
          id={`social-kit-tab-${p.id}`}
          type="button"
          role="tab"
          aria-selected={platform === p.id}
          aria-controls="social-kit-posts"
          onClick={() => onChoose(p.id)}
          style={{
            padding: '7px 14px',
            borderRadius: 7,
            border: 'none',
            background: platform === p.id ? C.surface : 'transparent',
            boxShadow: platform === p.id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            color: platform === p.id ? C.accent : C.muted,
            fontWeight: platform === p.id ? 700 : 600,
            fontSize: 13.5,
            cursor: 'pointer',
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

function ClicksUnavailable() {
  return (
    <p role="status" style={{ margin: 0, fontSize: 13, color: C.amber, background: C.amberSoft, padding: '8px 12px', borderRadius: 8 }}>
      The click counts could not be loaded, so every count on this page reads 0 for now. The posts and links still work. Reload the page to try again.
    </p>
  )
}

export default function SocialKitClient({ entries, clicks, clicksAvailable, logs: initialLogs, trackerAvailable, generatedAt }: Props) {
  // One clock for the whole render, from the server, so "today" and the
  // 7-day window agree between the server render and the browser.
  const now = useMemo(() => new Date(generatedAt), [generatedAt])

  // The last platform persists in this browser; local state covers blocked storage.
  const storedPlatform = useSyncExternalStore(subscribeStorage, readPlatform, () => null)
  const [pickedPlatform, setPickedPlatform] = useState<SocialPlatform | null>(null)
  const platform = pickedPlatform ?? PLATFORMS.find((p) => p.id === storedPlatform)?.id ?? 'linkedin'

  const [logs, setLogs] = useState<readonly PostLogEntry[]>(initialLogs)
  const groups = useMemo(() => groupPostLogs(logs), [logs])
  const [onlyNew, setOnlyNew] = useState(false)
  const [hideRecent, setHideRecent] = useState(false)

  // A new object per click, so the effect runs after the card for the new
  // platform and the cleared filters has rendered, even for the same job.
  const [scrollRequest, setScrollRequest] = useState<{ readonly jobId: string } | null>(null)
  useEffect(() => {
    if (scrollRequest) document.getElementById(`kit-${scrollRequest.jobId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollRequest])

  const choosePlatform = (id: SocialPlatform) => {
    setPickedPlatform(id)
    savePlatform(id)
  }

  const openJob = (jobId: string, id: SocialPlatform) => {
    choosePlatform(id)
    setOnlyNew(false)
    setHideRecent(false)
    setScrollRequest({ jobId })
  }

  const logsFor = (jobId: string) => groups.get(trackerKey(jobId, platform)) ?? []
  const shown = entries
    .filter((e) => !onlyNew || e.isNew)
    .filter((e) => !hideRecent || !isRecent(logsFor(e.id)[0]?.postedAt, now))
  const newCount = entries.filter((e) => e.isNew).length

  return (
    <div style={{ padding: '32px 24px', maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: C.ink }}>Social Kit</h1>
        <p style={{ margin: 0, color: C.muted, fontSize: 14, maxWidth: 680 }}>
          Ready-to-paste posts for every live paid job, with a tracked link per platform. Built from the database each
          time this page loads ({formatCT(generatedAt)}), so new paid posts show up as soon as they go live. Mark each
          post once it is up, and the tracker shows what went where.
        </p>
      </header>

      <PlatformTabs platform={platform} onChoose={choosePlatform} />

      {!clicksAvailable && <ClicksUnavailable />}

      <TrackerGrid entries={entries} groups={groups} clicks={clicks} platform={platform} now={now} available={trackerAvailable} onPick={openJob} />

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <Toggle id="social-kit-only-new" checked={onlyNew} onChange={setOnlyNew}>
          Only new in the last 48 hours ({newCount})
        </Toggle>
        <Toggle id="social-kit-hide-recent" checked={hideRecent} onChange={setHideRecent}>
          Hide jobs posted on {platformLabel(platform)} in the last {RECENT_POST_DAYS} days
        </Toggle>
      </div>

      <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
        Showing {shown.length} of {entries.length} live paid {entries.length === 1 ? 'job' : 'jobs'}. Clicks are people only; link previews and bots are not counted.
      </p>

      <div id="social-kit-posts" role="tabpanel" aria-labelledby={`social-kit-tab-${platform}`} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {shown.length === 0 ? (
          <div style={{ ...card, alignItems: 'center', textAlign: 'center', color: C.muted, padding: 32 }}>
            {entries.length === 0
              ? 'No paid jobs are live right now. Posts appear here as soon as one is paid for and published.'
              : 'Every job is hidden by the filters above. Clear them to see the posts.'}
          </div>
        ) : (
          shown.map((entry) => (
            <JobCard
              key={entry.id}
              entry={entry}
              platform={platform}
              clicks={clicks}
              logs={logsFor(entry.id)}
              now={now}
              trackerAvailable={trackerAvailable}
              onAdded={(added) => setLogs((prev) => [added, ...prev])}
              onRemoved={(id) => setLogs((prev) => prev.filter((log) => log.id !== id))}
            />
          ))
        )}
      </div>
    </div>
  )
}
