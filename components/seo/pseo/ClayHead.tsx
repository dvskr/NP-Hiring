import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { CLAY_ACCENT, clayEyebrow, clayH2, clayLede } from './clay';

export interface ClayHeadAction {
  href: string;
  label: string;
}

interface ClayHeadProps {
  eyebrow?: string;
  title: ReactNode;
  id?: string;
  lede?: ReactNode;
  /** Left-aligned heads only: the "View all" link on the right. */
  action?: ClayHeadAction;
  align?: 'center' | 'left';
  headingLevel?: 1 | 2 | 3;
}

/**
 * Band head on the page ground: eyebrow, Lora heading and lede, centered;
 * or the left-aligned listings head with its action link on the right.
 */
export default function ClayHead({
  eyebrow,
  title,
  id,
  lede,
  action,
  align = 'center',
  headingLevel = 2,
}: ClayHeadProps) {
  const Heading = `h${headingLevel}` as const;
  if (align === 'left') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          {eyebrow && <p style={clayEyebrow}>{eyebrow}</p>}
          <Heading id={id} className="font-lora" style={{ ...clayH2, fontSize: '20px' }}>
            {title}
          </Heading>
          {lede && <p style={clayLede}>{lede}</p>}
        </div>
        {action && (
          <Link
            href={action.href}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px',
              fontWeight: 600,
              color: CLAY_ACCENT,
              textDecoration: 'none',
            }}
          >
            {action.label}
            <ArrowRight size={14} />
          </Link>
        )}
      </div>
    );
  }
  return (
    <div style={{ textAlign: 'center', marginBottom: '40px' }}>
      {eyebrow && <p style={clayEyebrow}>{eyebrow}</p>}
      <Heading id={id} className="font-lora" style={clayH2}>
        {title}
      </Heading>
      {lede && <p style={{ ...clayLede, margin: '12px auto 0' }}>{lede}</p>}
    </div>
  );
}
