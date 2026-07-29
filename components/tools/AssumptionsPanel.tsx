/**
 * Visible assumptions block shared by every /tools surface (P2 #4, #5, #6, #17).
 *
 * House rule for this package: a tool that produces a number must show, on the
 * page and without interaction, (a) what it assumes, (b) what it excludes, and
 * (c) where its inputs came from. This component is that contract in one place
 * so no tool can ship an estimate with the caveats buried in a tooltip.
 *
 * Plain presentational component — no client state, safe in server components.
 */
import { AlertCircle, ExternalLink } from 'lucide-react';
import ToolStyles from './ToolStyles';
import { clayCard } from './tool-theme';

export interface AssumptionSource {
  label: string;
  /** Absolute URL for an external source, or an internal path. */
  url: string;
}

interface Props {
  /** e.g. "How this estimate is built". */
  title: string;
  /** One-line framing sentence rendered above the lists. */
  intro?: string;
  /** What the tool assumes / how it computes. */
  assumptions: readonly string[];
  /** What the tool deliberately does not compute. Rendered as its own list. */
  exclusions?: readonly string[];
  /** Where the numbers come from. */
  sources?: readonly AssumptionSource[];
  /** ISO date the underlying model or dataset was last reviewed. */
  reviewedOn?: string;
}

function formatReviewed(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function AssumptionsPanel({
  title,
  intro,
  assumptions,
  exclusions,
  sources,
  reviewedOn,
}: Props) {
  return (
    <section
      aria-labelledby="tool-assumptions-heading"
      style={{ ...clayCard, padding: '28px 28px 24px', border: '1.5px solid rgba(190,24,93,0.14)' }}
    >
      <ToolStyles />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <span
          style={{
            width: '38px', height: '38px', borderRadius: '12px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(190,24,93,0.10)', color: '#BE185D',
          }}
          aria-hidden="true"
        >
          <AlertCircle size={20} />
        </span>
        <h2 id="tool-assumptions-heading" style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
          {title}
        </h2>
      </div>

      {intro && (
        <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.65, margin: '0 0 16px' }}>{intro}</p>
      )}

      <h3 style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
        What it assumes
      </h3>
      <ul style={{ margin: '0 0 20px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {assumptions.map((line) => (
          <li key={line} style={{ fontSize: '13.5px', color: '#5A4A42', lineHeight: 1.6 }}>{line}</li>
        ))}
      </ul>

      {exclusions && exclusions.length > 0 && (
        <>
          <h3 style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
            What it does not include
          </h3>
          <ul style={{ margin: '0 0 20px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {exclusions.map((line) => (
              <li key={line} style={{ fontSize: '13.5px', color: '#5A4A42', lineHeight: 1.6 }}>{line}</li>
            ))}
          </ul>
        </>
      )}

      {sources && sources.length > 0 && (
        <>
          <h3 style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
            Sources
          </h3>
          <ul style={{ margin: '0 0 16px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {sources.map((s) => {
              const isExternal = s.url.startsWith('http');
              return (
                <li key={s.url} style={{ fontSize: '13.5px', lineHeight: 1.6 }}>
                  <a
                    href={s.url}
                    className="tool-link"
                    style={{ color: '#BE185D', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {s.label}
                    {isExternal && <ExternalLink size={12} aria-hidden="true" />}
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {reviewedOn && (
        <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0 }}>
          Model last reviewed {formatReviewed(reviewedOn)}. This is an estimate for planning, not tax,
          legal, or financial advice — verify anything you act on with a qualified professional.
        </p>
      )}
    </section>
  );
}
