'use client';

/**
 * lib/hooks/useRerenderAtPromoEnd.ts: gives a client component a render when
 * the launch promo ends.
 *
 * The employer app decides the promo phase while it renders
 * (config.isPromoActive(), currentQuote in lib/next-post-quote.ts,
 * postJobPricingCopy), so every render prints the right copy. A render needs
 * a cause, though, and time passing is not one: a dashboard left open over
 * config.promoEndsAt, or a preview the browser brings back from its
 * back/forward cache, keeps the render it already has, "Free through ..."
 * included, until the employer happens to change some state.
 *
 * This hook is that cause. It subscribes the component to the promo phase,
 * so React re-renders it once, when the phase changes, and never otherwise.
 * The phase is read again
 *   - at config.promoEndsAt, by a timer;
 *   - when the page is shown again (pageshow: a back/forward cache restore,
 *     during which timers were frozen) and when its tab becomes visible
 *     again (visibilitychange: a background tab or a sleeping device runs
 *     timers late).
 * It returns nothing. The component still decides the phase from the clock
 * as it renders; the hook only makes sure it gets to.
 */
import { useSyncExternalStore } from 'react';
import { config } from '@/lib/config';

/**
 * setTimeout keeps its delay in a signed 32-bit integer of milliseconds,
 * about 24.8 days, and a longer delay fires at once. The promo end can be
 * months away, so the timer waits at most this long and is then set again.
 */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** The value React compares between renders: true while the promo runs. */
function promoActiveNow(): boolean {
  return config.isPromoActive();
}

/**
 * The subscribe half of useSyncExternalStore: calls `onPromoEnd` once, at the
 * first check that finds the promo over, and then stops watching (the phase
 * never goes back). Until then it only keeps the timer set. Returns the
 * unsubscribe. Reads window and document, so it runs in the browser only;
 * React calls it after mount.
 */
export function subscribeToPromoEnd(onPromoEnd: () => void): () => void {
  // Mounted after the end: the first render was already the ladder render.
  if (!config.isPromoActive()) return () => undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopWatching = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    window.removeEventListener('pageshow', check);
    document.removeEventListener('visibilitychange', check);
  };

  function check(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const msLeft = Date.parse(config.promoEndsAt) - Date.now();
    if (msLeft > 0) {
      timer = setTimeout(check, Math.min(msLeft, MAX_TIMER_DELAY_MS));
      return;
    }
    stopWatching();
    onPromoEnd();
  }

  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', check);
  check();
  return stopWatching;
}

/** Re-renders the calling component when the launch promo ends. */
export function useRerenderAtPromoEnd(): void {
  useSyncExternalStore(subscribeToPromoEnd, promoActiveNow, promoActiveNow);
}
