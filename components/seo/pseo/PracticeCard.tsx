import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PracticeAuthority } from '@/lib/state-practice-authority';
import { NLC_VERIFIED_LABEL, type PracticeEnvironment } from '@/lib/pseo/practice-environment';
import {
  buildLicensureSentences,
  buildPracticingAsRoleParagraph,
  buildPracticingInStateParagraph,
  buildSalaryPracticeEnvironmentParagraph,
} from '@/lib/pseo/listing-narrative';
import { clayDesc, clayLink, clayList, clayRow } from './clay';
import ClayCard from './ClayCard';
import type { SectionGlyph } from './section-icon';
import type { SectionHeadingLevel } from './types';

export type PracticeCardVariant =
  /** CS-S6: classification, compact status, board and (APRN slugs only) certification. */
  | { kind: 'licensure'; slug?: string }
  /** CITY-C6 (no certification) and CC-K6 (with the role's certification). */
  | { kind: 'practicing'; certification?: string }
  /** SAL-S1: the practice environment paragraph with the NCSBN verification date. */
  | { kind: 'salary' };

/**
 * Chip fill by AANP tier, indexed into CLAY_FILLS: full practice on mint
 * (1), reduced on peach (2), restricted on blush (0).
 */
export const AUTHORITY_FILL_INDEX: Readonly<Record<PracticeAuthority, number>> = {
  full: 1,
  reduced: 2,
  restricted: 0,
};

/** The variant's paragraphs, board name still inline (the component links it). */
export function practiceParagraphs(env: PracticeEnvironment, variant: PracticeCardVariant): string[] {
  switch (variant.kind) {
    case 'licensure': {
      const s = buildLicensureSentences(env, variant.slug);
      return [s.classification, s.nlc, s.board, s.certification].filter((p): p is string => p !== null);
    }
    case 'practicing':
      return [
        variant.certification
          ? buildPracticingAsRoleParagraph(env, variant.certification)
          : buildPracticingInStateParagraph(env),
      ];
    case 'salary':
      return [buildSalaryPracticeEnvironmentParagraph(env, NLC_VERIFIED_LABEL)];
  }
}

/** The paragraph with its first mention of the board linked to the board site (nofollow). */
function withBoardLink(text: string, env: PracticeEnvironment): ReactNode {
  const at = text.indexOf(env.boardName);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href={env.boardUrl} rel="nofollow noopener" style={clayLink}>{env.boardName}</a>
      {text.slice(at + env.boardName.length)}
    </>
  );
}

interface PracticeCardProps {
  env: PracticeEnvironment | null;
  variant?: PracticeCardVariant;
  /** isLicenseGuideLive(env.stateSlug): the guide link renders only when true. */
  licenseGuideLive: boolean;
  guideLabel?: string;
  /** Static resource links (both routes always render). */
  links?: { fpaGuide?: boolean; scopeOfPractice?: boolean };
  title?: string;
  icon?: SectionGlyph;
  headingLevel?: SectionHeadingLevel;
  className?: string;
}

/**
 * Licensure and practice rules for one state: the AANP tier on the chip
 * (filled by authority), the dataset sentences, the board linked with
 * rel="nofollow noopener", and the license guide linked only while the
 * guide is published. Renders nothing off the dataset.
 *
 * The chip is AANP's tier name only ("Full Practice", "Reduced Practice",
 * "Restricted Practice", from getAuthorityLabel), never a rule and never the
 * dataset's "Full Practice Authority" above a state whose details describe a
 * transition period. Every paragraph opens by attributing the tier to AANP,
 * and what the state requires is its details.
 */
export default function PracticeCard({
  env,
  variant = { kind: 'licensure' },
  licenseGuideLive,
  guideLabel,
  links = { fpaGuide: true, scopeOfPractice: true },
  title,
  icon = ShieldCheck,
  headingLevel = 3,
  className,
}: PracticeCardProps) {
  if (!env) return null;
  const paragraphs = practiceParagraphs(env, variant);
  const rows: Array<{ href: string; label: string }> = [];
  if (licenseGuideLive) {
    rows.push({ href: `/blog/${env.licenseGuideSlug}`, label: guideLabel ?? `Read the ${env.stateName} license guide` });
  }
  if (links.fpaGuide) rows.push({ href: '/resources/fpa-guide', label: 'Full practice authority guide' });
  if (links.scopeOfPractice) rows.push({ href: `/scope-of-practice#${env.stateSlug}`, label: 'Scope of practice by state' });
  return (
    <ClayCard
      chip={env.authorityLabel}
      index={AUTHORITY_FILL_INDEX[env.authority]}
      title={title ?? `Practicing in ${env.stateName}`}
      icon={icon}
      headingLevel={headingLevel}
      className={className}
    >
      {paragraphs.map((paragraph, i) => (
        <p key={paragraph} style={{ ...clayDesc, margin: i === paragraphs.length - 1 ? 0 : '0 0 10px' }}>
          {withBoardLink(paragraph, env)}
        </p>
      ))}
      {rows.length > 0 && (
        <ul className="pseo-clay-list" style={clayList}>
          {rows.map((row, i) => (
            <li key={row.href} style={clayRow(i === rows.length - 1)}>
              <Link href={row.href} style={clayLink}>{row.label}</Link>
            </li>
          ))}
        </ul>
      )}
    </ClayCard>
  );
}
