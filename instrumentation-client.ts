/**
 * Sentry — browser (client) runtime init. Picked up automatically by
 * withSentryConfig. No-op when NEXT_PUBLIC_SENTRY_DSN is unset.
 *
 * Deliberately LEAN: Session Replay and BrowserTracing are filtered out to
 * preserve the bundle-size win documented in next.config.ts (those pulled in
 * ~75KB gz of @sentry/replay-internal + d3). This keeps client-side *error*
 * capture while leaving the heavy perf/replay machinery out of the bundle.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/private-url';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  // Guide library tokens and checkout session ids never reach Sentry.
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
  integrations: (defaults) =>
    defaults.filter(
      (i) => !['Replay', 'ReplayCanvas', 'BrowserTracing', 'Feedback'].includes(i.name),
    ),
});

// Required by Sentry to instrument App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
