'use client'

import { isRecent, postedAgoLabel, trackerKey, RECENT_POST_DAYS, type PostLogEntry } from '@/lib/social-kit/tracker'
import type { SocialKitEntry, SocialPlatform } from '@/lib/social-kit/types'
import { C, card, PLATFORMS, platformLabel } from './ui'

interface Props {
  readonly entries: readonly SocialKitEntry[]
  readonly groups: ReadonlyMap<string, readonly PostLogEntry[]>
  readonly clicks: Readonly<Record<string, number>>
  readonly platform: SocialPlatform
  readonly now: Date
  /** False when the tracker table could not be read. */
  readonly available: boolean
  readonly onPick: (jobId: string, platform: SocialPlatform) => void
}

interface CellProps {
  readonly logs: readonly PostLogEntry[]
  readonly clicks: number
  readonly now: Date
  readonly selected: boolean
  readonly onClick: () => void
  readonly label: string
}

function Cell({ logs, clicks, now, selected, onClick, label }: CellProps) {
  const last = logs[0]
  const recent = isRecent(last?.postedAt, now)
  const tone = !last
    ? { color: C.amber, background: 'transparent' }
    : recent
      ? { color: C.accent, background: C.accentSoft }
      : { color: C.ink, background: C.sunk }
  return (
    <td style={{ padding: 4, background: selected ? 'rgba(190,24,93,0.04)' : undefined }}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        style={{
          width: '100%',
          minWidth: 92,
          textAlign: 'left',
          border: `1px solid ${last ? 'transparent' : C.line}`,
          borderRadius: 8,
          padding: '6px 8px',
          cursor: 'pointer',
          ...tone,
        }}
      >
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{last ? postedAgoLabel(last.postedAt, now) : 'Not yet'}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
          {logs.length} {logs.length === 1 ? 'post' : 'posts'}, {clicks} {clicks === 1 ? 'click' : 'clicks'}
        </span>
      </button>
    </td>
  )
}

function TrackerUnavailable() {
  return (
    <section style={card} aria-labelledby="posting-tracker-heading">
      <h2 id="posting-tracker-heading" style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.ink }}>Posting tracker</h2>
      <p role="status" style={{ margin: 0, fontSize: 13, color: C.amber }}>
        The posting history could not be loaded, so the tracker is hidden for now. The posts and links below still work. Reload the page to try again.
      </p>
    </section>
  )
}

/** Every live paid job against every platform: when it last went out, how often, and the clicks it got. */
export default function TrackerGrid({ entries, groups, clicks, platform, now, available, onPick }: Props) {
  if (!available) return <TrackerUnavailable />
  const lastOn = (jobId: string) => groups.get(trackerKey(jobId, platform))?.[0]?.postedAt
  const recentCount = entries.filter((e) => isRecent(lastOn(e.id), now)).length
  const neverCount = entries.filter((e) => !lastOn(e.id)).length

  return (
    <section style={card} aria-labelledby="posting-tracker-heading">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 id="posting-tracker-heading" style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.ink }}>Posting tracker</h2>
        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
          {platformLabel(platform)}: {recentCount} of {entries.length} posted in the last {RECENT_POST_DAYS} days, {neverCount} never.
          Highlighted cells were posted in the last {RECENT_POST_DAYS} days. Click a cell to open that job on that platform.
        </p>
      </div>
      <div style={{ overflowX: 'auto', margin: '0 -4px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left', padding: '4px 8px', color: C.muted, fontWeight: 600 }}>Job</th>
              {PLATFORMS.map((p) => (
                <th
                  key={p.id}
                  scope="col"
                  style={{ textAlign: 'left', padding: '4px 8px', whiteSpace: 'nowrap', color: p.id === platform ? C.accent : C.muted, fontWeight: p.id === platform ? 800 : 600 }}
                >
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} style={{ borderTop: `1px solid ${C.line}` }}>
                <th scope="row" style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: C.ink, minWidth: 160, maxWidth: 240 }}>
                  <span style={{ display: 'block' }}>{entry.employer}</span>
                  <span style={{ display: 'block', fontWeight: 400, fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.title}
                  </span>
                </th>
                {PLATFORMS.map((p) => {
                  const post = entry.posts.find((x) => x.platform === p.id)
                  return (
                    <Cell
                      key={p.id}
                      logs={groups.get(trackerKey(entry.id, p.id)) ?? []}
                      clicks={post ? clicks[post.code] ?? 0 : 0}
                      now={now}
                      selected={p.id === platform}
                      onClick={() => onPick(entry.id, p.id)}
                      label={`${entry.employer} on ${p.label}`}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
