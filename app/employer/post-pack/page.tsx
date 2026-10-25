/**
 * /employer/post-pack — the 5-post pack: the offer, the Buy button, the
 * return from Stripe Checkout, and the account's own packs (2027 re-price,
 * phase 3; plan sections 3.3 and 3.9).
 *
 * Server page behind requireEmployer, noindex like the rest of /employer
 * (app/employer/layout.tsx), rendered per request: it reads the account's
 * packs and the sale gate, and /api/create-pack-checkout sends the buyer back
 * here with ?session_id=.
 *
 *   while the promo runs     the pack price dated from config.ladderStartsLabel,
 *                            no way to buy (owner decision: sold from the
 *                            ladder's start)
 *   sale open                the Buy button (POST /api/create-pack-checkout)
 *   sale closed              the support email, as /pricing's pack card
 *   free-email signup        the company email requirement post-free enforces
 *
 * Every price is a config token, and the pack's terms are the shared
 * sentences of lib/pricing-copy.ts; no copy names a saving.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Package, FileText } from 'lucide-react';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { requireEmployer } from '@/lib/auth/protect';
import { domainOf, isFreeEmailDomain } from '@/lib/pricing';
import { isPackSaleOpen } from '@/lib/post-pack-sale';
import { FULL_PACKAGE, PACK_COMPARISON, packDateLabel, packPriceLine } from '@/lib/pricing-copy';
import {
  MAX_PACKS_LISTED,
  POST_PACK_VIEW_SELECT,
  packCreditsLine,
  packInvoiceHref,
  packStatusLine,
  toPostPackView,
  type PostPackView,
} from '@/lib/post-pack-view';
import BuyPackButton from './BuyPackButton';
import PackCheckoutReturn from './PackCheckoutReturn';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${config.packPosts}-Post Pack`,
  robots: { index: false, follow: false },
};

/** A Checkout Session id as Stripe mints them; anything else is not handed to the check. */
const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/;

const card: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px', border: '1px solid rgba(0,0,0,0.06)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
  padding: '28px', marginBottom: '20px',
};
const muted: React.CSSProperties = { fontSize: '13px', color: '#5A6E7A', lineHeight: 1.6, margin: 0 };
const linkButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '13px 26px', borderRadius: '14px',
  fontSize: '15px', fontWeight: 700, color: '#BE185D', background: '#FFFFFF', textDecoration: 'none',
  border: '1px solid rgba(190,24,93,0.25)', boxShadow: '4px 4px 10px rgba(0,0,0,0.05)',
};

interface PostPackPageProps {
  searchParams: Promise<{ session_id?: string | string[] }>;
}

export default async function PostPackPage({ searchParams }: PostPackPageProps) {
  const { user, profile } = await requireEmployer('/employer/post-pack');
  const { session_id: rawSessionId } = await searchParams;
  const sessionId = typeof rawSessionId === 'string' && CHECKOUT_SESSION_ID.test(rawSessionId) ? rawSessionId : null;

  const now = new Date();
  const rows = await prisma.employerPostPack.findMany({
    where: { userId: user.id },
    orderBy: { purchasedAt: 'desc' },
    take: MAX_PACKS_LISTED,
    select: POST_PACK_VIEW_SELECT,
  });
  const packs = rows.map((row) => toPostPackView(row, now));

  const promoActive = config.isPromoActive(now);
  const saleOpen = isPackSaleOpen(now);
  const domain = domainOf(user.email);
  const companyEmail = !!domain && !isFreeEmailDomain(domain);
  const perPost = config.formatDollars(config.packPrice / config.packPosts);

  let buyArea: React.ReactNode;
  if (promoActive) {
    buyArea = <p style={{ fontSize: '15px', fontWeight: 700, color: '#831843', margin: 0 }}>{packPriceLine(now)}</p>;
  } else if (saleOpen && profile.role === 'employer' && companyEmail) {
    buyArea = <BuyPackButton />;
  } else if (saleOpen && !companyEmail) {
    buyArea = <p style={muted}>Packs are sold to employer accounts with a company email address.</p>;
  } else if (saleOpen) {
    buyArea = <p style={muted}>Only employer accounts can buy a {config.packPosts}-post pack.</p>;
  } else {
    buyArea = <a href={`mailto:${brand.email.support}`} style={linkButton}>Ask about the pack</a>;
  }

  return (
    <main style={{ background: '#F5F0EB', minHeight: '100vh', padding: '32px 16px 64px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        {sessionId && <PackCheckoutReturn sessionId={sessionId} />}

        <section aria-labelledby="pack-offer-heading" style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
            <span style={{
              width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(190,24,93,0.1)', color: '#BE185D',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Package size={22} aria-hidden="true" />
            </span>
            <h1 id="pack-offer-heading" style={{ fontSize: '26px', fontWeight: 800, fontFamily: 'var(--font-lora), Georgia, serif', color: '#1A2E35', margin: 0 }}>
              {config.packPosts}-post pack
            </h1>
          </div>
          <p style={{ margin: '0 0 6px', display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '40px', fontWeight: 800, color: '#831843', lineHeight: 1 }}>{config.formatDollars(config.packPrice)}</span>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#BE185D' }}>for {config.packPosts} posts</span>
          </p>
          <p style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 16px' }}>
            {perPost} a post, to use within {config.packValidityMonths} months
          </p>
          <ul style={{ margin: '0 0 22px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li style={muted}>{FULL_PACKAGE}</li>
            <li style={muted}>The posts belong to this account and renew for ${config.renewalPrice}.</li>
            <li style={muted}>Buying a pack uses your company&apos;s intro price, so single posts after it are ${config.postingPrice}.</li>
            <li style={muted}>{PACK_COMPARISON}</li>
          </ul>
          {buyArea}
          <p style={{ ...muted, fontSize: '12px', marginTop: '14px' }}>
            All sales are final (<Link href="/terms#refund-policy" style={{ color: '#BE185D', textDecoration: 'underline' }}>Terms §8</Link>).
          </p>
        </section>

        {packs.length > 0 && <YourPacks packs={packs} />}
      </div>
    </main>
  );
}

/** The account's packs, newest first, with Stripe's hosted invoice for each. */
function YourPacks({ packs }: { packs: PostPackView[] }) {
  const canPost = packs.some((pack) => pack.state === 'active');
  return (
    <section aria-labelledby="your-packs-heading" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <h2 id="your-packs-heading" style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Your packs</h2>
        {canPost && <Link href="/post-job" style={{ fontSize: '14px', fontWeight: 700, color: '#BE185D' }}>Post a Job</Link>}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {packs.map((pack) => {
          const status = packStatusLine(pack);
          const invoiceHref = packInvoiceHref(pack);
          return (
            <li key={pack.id} style={{ padding: '14px 0', borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: '15px', fontWeight: 700, color: '#1A2E35' }}>{packCreditsLine(pack)}</p>
                <p style={muted}>
                  Bought {packDateLabel(new Date(pack.purchasedAt))} · {config.formatDollars(pack.amountCents / 100)}
                  {status ? ` · ${status}` : ''}
                </p>
              </div>
              {invoiceHref && (
                <a
                  href={invoiceHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#BE185D', textDecoration: 'none', alignSelf: 'center' }}
                >
                  <FileText size={13} aria-hidden="true" /> Invoice{pack.invoiceNumber ? ` #${pack.invoiceNumber}` : ''}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
