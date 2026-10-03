'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { config } from '@/lib/config';
import { currentQuote } from '@/lib/next-post-quote';
import { useRerenderAtPromoEnd } from '@/lib/hooks/useRerenderAtPromoEnd';
import { trackBeginCheckout } from '@/lib/analytics';

interface ScreeningQuestion {
  text: string;
  type: string;
  options?: string[];
  required?: boolean;
  knockout?: boolean;
  knockoutAnswer?: string;
}

interface JobFormData {
  title: string;
  companyName: string;
  companyWebsite?: string;
  contactEmail: string;
  location: string;
  mode: string;
  jobType: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryPeriod?: string;
  salaryCompetitive?: boolean;
  description: string;
  applyUrl?: string;
  applyOnPlatform?: boolean;
  pricingTier: 'pro';
  benefits?: string[];
  setting?: string;
  population?: string;
  companyLogoUrl?: string;
  // Phase 1 experience picker fields — see app/post-job/page.tsx Step 2.
  minYearsExperience?: number;
  maxYearsExperience?: number | null;
  newGradFriendly?: boolean;
  experienceQualifier?: string;
  screeningQuestions?: ScreeningQuestion[];
}

/**
 * The employer's quoted rung for their NEXT post, from
 * GET /api/employer/free-quota-status (see lib/pricing.ts#PricingQuote).
 * The order summary reads the amount from here (intro vs pro), so the
 * number the employer sees matches the Stripe line item create-checkout
 * builds from the same resolution. Every field is optional.
 */
interface PricingQuote {
  eligible: boolean;
  mode?: 'promo' | 'plan' | 'intro' | 'paid';
  tier?: 'intro' | 'pro' | 'plan';
  willBeFree?: boolean;
  price?: number;
  priceCents?: number;
}

type QuoteFetch = 'loading' | 'loaded' | 'failed';

/**
 * What the page may say about the amount. Only the server quote supplies a
 * number: there is no list-price fallback, because the server may charge a
 * different rung (intro) or nothing at all (promo, plan slot).
 *   loading — the quote has not answered yet: no amount, Pay disabled;
 *   free    — the next post needs no payment: no Pay button at all;
 *   paid    — the quoted amount, shown on the summary and the Pay button;
 *   unknown — the quote failed or said nothing usable: no amount is shown,
 *             and Stripe shows the exact amount before anything is charged.
 */
type QuoteView =
  | { kind: 'loading' }
  | { kind: 'free'; mode: PricingQuote['mode'] }
  | { kind: 'paid'; price: number; priceCents: number; isIntro: boolean }
  | { kind: 'unknown' };

function toQuoteView(fetchState: QuoteFetch, quote: PricingQuote | null): QuoteView {
  if (fetchState === 'loading') return { kind: 'loading' };
  if (!quote || quote.eligible !== true) return { kind: 'unknown' };
  if (quote.willBeFree === true) return { kind: 'free', mode: quote.mode };
  if (
    quote.willBeFree === false
    && typeof quote.price === 'number' && quote.price > 0
    && typeof quote.priceCents === 'number' && quote.priceCents > 0
  ) {
    return { kind: 'paid', price: quote.price, priceCents: quote.priceCents, isIntro: quote.mode === 'intro' };
  }
  return { kind: 'unknown' };
}

export default function CheckoutPage() {
  const router = useRouter();
  const [jobData, setJobData] = useState<JobFormData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // F3: server-checked paid-posting availability (ENABLE_PAID_POSTING flag +
  // stripeConfigured). null = unknown → fail open; the create-checkout API
  // still returns a stable 503 code if payment is attempted anyway.
  const [paidPostingAvailable, setPaidPostingAvailable] = useState<boolean | null>(null);
  const [fetchedQuote, setFetchedQuote] = useState<PricingQuote | null>(null);
  const [quoteFetch, setQuoteFetch] = useState<QuoteFetch>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/create-checkout/availability');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPaidPostingAvailable(data?.available === true);
      } catch {
        /* leave null — fail open */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/employer/free-quota-status');
        if (!res.ok) {
          if (!cancelled) setQuoteFetch('failed');
          return;
        }
        const data = (await res.json()) as PricingQuote;
        if (!cancelled) {
          setFetchedQuote(data);
          setQuoteFetch('loaded');
        }
      } catch {
        // No amount is guessed: the summary shows none and Stripe shows the
        // exact amount before the employer pays.
        if (!cancelled) setQuoteFetch('failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Checkout always requires paid form data (this page is only reached
    // when post-free answered requiresPayment — an intro or pro rung)

    // Read jobFormData from localStorage
    const storedData = localStorage.getItem('jobFormData');

    if (!storedData) {
      // No data, redirect to post-job
      router.push('/post-job');
      return;
    }

    try {
      const parsedData: JobFormData = JSON.parse(storedData);
      try {
        const storedQuestions = localStorage.getItem('jobScreeningQuestions');
        if (storedQuestions) parsedData.screeningQuestions = JSON.parse(storedQuestions);
      } catch { /* ignore */ }
      setJobData(parsedData);
    } catch (err) {
      console.error('Error parsing job data:', err);
      router.push('/post-job');
    }
  }, [router]);

  // ─── Quoted amount ────────────────────────────────────────────────────
  // An eligible+free answer (promo / plan) means this page was reached with
  // a stale draft: the banner below sends the employer back to the preview
  // and no Pay button renders, so nothing can be charged from here. A promo
  // answer only counts while the promo is running on this render
  // (currentQuote): fetched before config.promoEndsAt and shown after it, it
  // reads as no quote, because the server now charges this post. The hook
  // renders a page left open over that instant again, so the banner goes.
  useRerenderAtPromoEnd();
  const quoteView = toQuoteView(quoteFetch, currentQuote(fetchedQuote));
  const isIntroRung = quoteView.kind === 'paid' && quoteView.isIntro;
  const nextPostIsFree = quoteView.kind === 'free';

  const handlePayment = async () => {
    if (!jobData || quoteView.kind === 'free' || quoteView.kind === 'loading') return;

    setLoading(true);
    setError(null);

    // P7: fire begin_checkout before redirect to Stripe, with the quoted
    // rung's amount so intro and pro checkouts report their real value.
    // Without a usable quote it waits for the amount the server charges
    // (below) rather than reporting a guessed one.
    if (quoteView.kind === 'paid') trackBeginCheckout(quoteView.priceCents, 'new');

    try {
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: jobData.title,
          companyName: jobData.companyName,
          companyWebsite: jobData.companyWebsite,
          contactEmail: jobData.contactEmail,
          location: jobData.location,
          mode: jobData.mode,
          jobType: jobData.jobType,
          salaryMin: jobData.salaryMin,
          salaryMax: jobData.salaryMax,
          salaryPeriod: jobData.salaryPeriod,
          salaryCompetitive: jobData.salaryCompetitive,
          description: jobData.description,
          applyUrl: jobData.applyOnPlatform ? undefined : jobData.applyUrl,
          applyOnPlatform: jobData.applyOnPlatform || false,
          pricingTier: jobData.pricingTier,
          benefits: jobData.benefits,
          setting: jobData.setting,
          population: jobData.population,
          companyLogoUrl: jobData.companyLogoUrl,
          minYearsExperience: jobData.minYearsExperience ?? null,
          maxYearsExperience: jobData.maxYearsExperience ?? null,
          newGradFriendly: jobData.newGradFriendly ?? false,
          experienceQualifier: jobData.experienceQualifier?.trim() || null,
          screeningQuestions: jobData.screeningQuestions || [],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({} as { error?: string; cause?: string }));
        const baseMsg = errorData.error || 'Failed to create checkout session';
        const fullMsg = errorData.cause ? `${baseMsg}: ${errorData.cause}` : baseMsg;
        throw new Error(fullMsg);
      }

      const { url, price } = (await response.json()) as { url?: string; price?: number };
      if (quoteView.kind !== 'paid' && typeof price === 'number' && price > 0) {
        trackBeginCheckout(Math.round(price * 100), 'new');
      }

      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  };

  // Customer-facing rung names. "Intro" is the company's first paid post;
  // every later post is a Featured post (config.postingPrice). Both carry
  // the identical feature set — the label only explains the amount.
  const getPlanName = () => (isIntroRung ? 'Intro Job Post' : 'Featured Job Post');

  const getDescriptionExcerpt = (html: string, max = 220): string => {
    if (!html) return '';
    // Strip tags, decode common HTML entities, collapse whitespace
    const text = html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max).trimEnd()}…`;
  };

  const formatSalary = () => {
    if (jobData?.salaryCompetitive) {
      return 'Competitive';
    }
    if (jobData?.salaryMin && jobData?.salaryMax) {
      return `$${jobData.salaryMin.toLocaleString()} to $${jobData.salaryMax.toLocaleString()}`;
    }
    if (jobData?.salaryMin) {
      return `$${jobData.salaryMin.toLocaleString()}+`;
    }
    if (jobData?.salaryMax) {
      return `Up to $${jobData.salaryMax.toLocaleString()}`;
    }
    return 'Not specified';
  };

  // F3: paid posting isn't open (flag off or Stripe unconfigured) — show a
  // clear "coming soon" state instead of letting the Pay button 503. A free
  // quote (launch promo, plan slot) skips it: that post needs no checkout,
  // and the page below sends the employer back to the preview to post it.
  if (paidPostingAvailable === false && !nextPostIsFree) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Paid posting is coming soon</h1>
          <p className="text-gray-600 mb-6">
            Checkout is not open yet, so paid job posts cannot be purchased
            right now. Your job details are saved, and we will have this ready shortly.
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/employer/dashboard"
              className="w-full bg-pink-600 text-white py-3 rounded-lg font-semibold hover:bg-pink-700 transition-colors"
            >
              Go to your dashboard
            </Link>
            <Link
              href="/post-job"
              className="w-full text-gray-600 hover:text-pink-600 transition-colors text-sm py-2"
            >
              ← Back to your job post
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Show loading while checking localStorage
  if (!jobData) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8">
      {/* Page Header */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold mb-1">Confirm Your Job Posting</h1>
        <p className="text-gray-600">
          {nextPostIsFree ? 'Review your listing, then post it from the preview' : 'Review your listing before payment'}
        </p>
      </div>

      {/* Job Summary Card */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Job Posting Summary</h2>

        <div className="space-y-4">
          {/* Title and Company */}
          <div className="border-b pb-4">
            <h3 className="text-lg font-semibold text-gray-900">{jobData.title}</h3>
            <p className="text-gray-600">{jobData.companyName}</p>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="text-sm font-medium text-gray-500">Location</span>
              <p className="text-gray-900">{jobData.location}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Work Mode</span>
              <p className="text-gray-900">{jobData.mode}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Job Type</span>
              <p className="text-gray-900">{jobData.jobType}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Salary</span>
              <p className="text-gray-900">{formatSalary()}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">Contact Email</span>
              <p className="text-gray-900">{jobData.contactEmail}</p>
            </div>
            {jobData.companyWebsite && (
              <div>
                <span className="text-sm font-medium text-gray-500">Company Website</span>
                <p className="text-gray-900 truncate">{jobData.companyWebsite}</p>
              </div>
            )}
          </div>

          {/* Apply URL */}
          <div>
            <span className="text-sm font-medium text-gray-500">Application URL</span>
            <p className="text-gray-900 truncate">{jobData.applyUrl}</p>
          </div>

          {/* Description Preview */}
          <div>
            <span className="text-sm font-medium text-gray-500">Description Preview</span>
            <p className="text-gray-700 text-sm mt-1 leading-relaxed">
              {getDescriptionExcerpt(jobData.description)}
            </p>
          </div>
        </div>
      </div>

      {/* Stale-draft guard: the quote says this employer's next post needs no
          payment (launch promo or an Employer-plan slot). Charging them
          anyway would be the worst outcome on this page, so point them back
          to the preview, whose primary button posts without Stripe. */}
      {quoteView.kind === 'free' && (
        <div className="bg-pink-50 border border-pink-200 rounded-lg p-4 mb-6">
          <p className="text-pink-800 text-sm">
            Good news: your next post doesn&apos;t need a payment
            {/* The promo reason only for a promo quote, which currentQuote
                keeps only while the promo runs; a free quote without a
                mode states no reason rather than a promo it cannot vouch for. */}
            {quoteView.mode === 'plan'
              ? ' (it uses a slot on your Employer plan)'
              : quoteView.mode === 'promo'
                ? ` (every post is free through ${config.promoEndsLabel})`
                : ''}
            .{' '}
            <Link href="/post-job/preview" className="font-semibold underline">
              Go back to the preview and post it
            </Link>
            .
          </p>
        </div>
      )}

      {/* Pricing Card */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-start justify-between gap-6 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{getPlanName()}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{config.durationDays}-day listing</p>
            {isIntroRung && (
              <p className="text-xs text-gray-500 mt-1">
                Intro price for your company&apos;s first paid post. Every post after this one is ${config.postingPrice}.
              </p>
            )}
          </div>
          {/* The amount comes from the server quote only; see QuoteView. */}
          <div className="text-right shrink-0">
            {quoteView.kind === 'paid' && (
              <>
                <span className="text-3xl font-bold text-gray-900">${quoteView.price}</span>
                <p className="text-sm text-gray-500">one-time</p>
              </>
            )}
            {quoteView.kind === 'free' && (
              <>
                <span className="text-3xl font-bold text-gray-900">Free</span>
                <p className="text-sm text-gray-500">no payment needed</p>
              </>
            )}
            {quoteView.kind === 'loading' && (
              <p className="text-sm text-gray-500">Checking your price...</p>
            )}
            {quoteView.kind === 'unknown' && (
              <p className="text-sm text-gray-500 max-w-[12rem]">Stripe shows the exact amount before you pay.</p>
            )}
          </div>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-700">
          <li className="flex items-center gap-2">
            <span className="text-pink-600">✓</span> Top search placement
          </li>
          <li className="flex items-center gap-2">
            <span className="text-pink-600">✓</span> {config.limits.candidateUnlocksPerPosting} candidate unlocks
          </li>
          <li className="flex items-center gap-2">
            <span className="text-pink-600">✓</span> {config.limits.inmailsPerPosting} InMail credits
          </li>
          <li className="flex items-center gap-2">
            <span className="text-pink-600">✓</span> Applicant analytics
          </li>
          <li className="flex items-center gap-2">
            <span className="text-pink-600">✓</span> Email candidate alerts
          </li>
        </ul>
        <p className="text-xs text-gray-500 mt-4">
          Hiring for several roles? The Employer plan is ${config.planPrice}/month for {config.planSlots} active jobs.{' '}
          <Link href="/pricing" className="text-pink-700 hover:text-pink-800 underline">See pricing</Link>.
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Payment Button. A free quote (promo or plan slot) renders no Pay
          button at all, only the way back to the preview, which posts
          without Stripe; the server refuses a promo checkout as well. */}
      {quoteView.kind === 'free' ? (
        <Link
          href="/post-job/preview"
          className="w-full bg-pink-600 text-white py-3 rounded-lg font-semibold hover:bg-pink-700 transition-colors flex items-center justify-center gap-2"
        >
          Go back to the preview to post it
        </Link>
      ) : (
        <>
          <button
            onClick={handlePayment}
            disabled={loading || quoteView.kind === 'loading'}
            className="w-full bg-pink-600 text-white py-3 rounded-lg font-semibold hover:bg-pink-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                Creating checkout session...
              </>
            ) : quoteView.kind === 'paid' ? (
              `Proceed to Payment: $${quoteView.price}`
            ) : quoteView.kind === 'loading' ? (
              'Checking your price...'
            ) : (
              'Proceed to Payment'
            )}
          </button>

          {/* Terms acknowledgement — visible at point-of-purchase per consumer
              protection norms. Reduces post-charge "I didn't know it was
              non-refundable" support tickets and chargeback risk. */}
          <p className="text-center text-xs text-gray-500 mt-3">
            By clicking Pay, you agree to our{' '}
            <Link href="/terms" className="text-pink-700 hover:text-pink-800 underline">
              Terms of Service
            </Link>
            .
          </p>
        </>
      )}

      {/* Back Link */}
      <div className="text-center mt-4">
        <Link
          href="/post-job"
          className="text-gray-600 hover:text-pink-600 transition-colors text-sm"
        >
          ← Back to edit job posting
        </Link>
      </div>

      {/* Secure Payment Note */}
      <p className="text-center text-xs text-gray-400 mt-6">
        Secure payment powered by Stripe. Your card details are never stored on our servers.
      </p>
    </div>
  );
}

