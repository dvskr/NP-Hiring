/**
 * Sentry — Edge runtime init (middleware + edge routes). Loaded by
 * instrumentation.ts's register() when NEXT_RUNTIME === 'edge'. No-op when
 * SENTRY_DSN is unset.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/private-url';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  sendDefaultPii: false,
  // Guide library tokens and checkout session ids never reach Sentry.
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
});
