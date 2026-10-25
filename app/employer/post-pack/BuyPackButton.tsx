'use client';

/**
 * The 5-post pack's Buy button on /employer/post-pack (2027 re-price, phase
 * 3). The server page renders it only while the pack can be sold
 * (lib/post-pack-sale.ts#isPackSaleOpen) to an employer account with a
 * company email; POST /api/create-pack-checkout checks all of it again and
 * answers with the Stripe Checkout URL. GA's begin_checkout carries the
 * pack's price with checkout_type 'pack'.
 */
import { useState } from 'react';
import { config } from '@/lib/config';
import { trackBeginCheckout } from '@/lib/analytics';

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
  padding: '13px 26px', borderRadius: '14px', fontSize: '15px', fontWeight: 700,
  color: '#fff', background: 'linear-gradient(145deg, #BE185D, #9D174D)', border: 'none',
  boxShadow: '4px 4px 12px rgba(190,24,93,0.25), inset 1px 1px 2px rgba(255,255,255,0.15)',
  cursor: 'pointer',
};

export default function BuyPackButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buy = async () => {
    setBusy(true);
    setError(null);
    trackBeginCheckout(config.stripePackPriceInCents, 'pack');
    try {
      const res = await fetch('/api/create-pack-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message || data.error || 'We could not open checkout. Please try again.');
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not open checkout. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={buy} disabled={busy} style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Opening checkout…' : `Buy ${config.packPosts} posts · ${config.formatDollars(config.packPrice)}`}
      </button>
      {error && (
        <p role="alert" style={{ fontSize: '13px', fontWeight: 600, color: '#DC2626', margin: '10px 0 0' }}>{error}</p>
      )}
    </div>
  );
}
