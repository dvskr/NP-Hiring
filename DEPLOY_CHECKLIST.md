# Deploy Checklist — NP Hiring (nphiring.com)

> Run this end-to-end the first time you deploy. Tick boxes as you go.
> Delete this file after successful production launch.

**Repo:** https://github.com/dvskr/NP-Hiring
**DB:** Supabase project `ytpmrlpnpbdylujbtgij` (East US — North Virginia)
**Domain:** nphiring.com

---

## Phase 10.1 — Pre-deploy sanity (10 min, local)

- [ ] `npm run type-check` returns 0 errors
- [ ] `.env.local` exists and has all required keys (see §10.2)
- [ ] `.env.local` is gitignored (verify: `git check-ignore .env.local` → prints `.env.local`)
- [ ] Local dev server runs: `npm run dev` → http://localhost:3000 loads homepage
- [ ] `/jobs` page renders the 335 jobs from smoke ingest (visit http://localhost:3000/jobs)
- [ ] One category page renders: http://localhost:3000/jobs/psychiatric-mental-health
- [ ] State page renders: http://localhost:3000/jobs/psychiatric-mental-health/california

---

## Phase 10.2 — Required env vars (fill in Vercel after project creation)

Copy these from `.env.local` into Vercel dashboard. **Do NOT commit values.**

### Critical (deploy fails without these)

| Key | Source | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string → **Transaction pooler** (port 6543) | For Vercel runtime |
| `DIRECT_URL` | Same page → **Direct connection** (port 5432) | For Prisma migrations |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → `service_role` key | **Secret** — bypasses RLS |
| `NEXT_PUBLIC_BASE_URL` | `https://nphiring.com` | Production URL |
| `CRON_SECRET` | Already generated in `.env.local` | Min 16 chars |
| `NODE_ENV` | `production` | Vercel sets automatically |

### Inngest (required for crons to fire)

| Key | Source |
|---|---|
| `INNGEST_EVENT_KEY` | https://app.inngest.com → app `np-hiring` → Event Keys |
| `INNGEST_SIGNING_KEY` | Same page → Signing Keys |

### Resend (required for email sends — alerts, confirmations, employer notifications)

| Key | Source |
|---|---|
| `RESEND_API_KEY` | https://resend.com → API Keys → Create |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks → Add endpoint → `https://nphiring.com/api/webhooks/resend` → save signing secret |
| `EMAIL_FROM` | `NP Hiring <noreply@nphiring.com>` (after DNS verified) |
| `EMAIL_FROM_MARKETING` | `NP Hiring <alerts@nphiring.com>` |
| `EMAIL_REPLY_TO` | `support@nphiring.com` |

### Stripe (required only if employers will pay to post)

| Key | Source |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys (live mode after testing) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → Add endpoint → `https://nphiring.com/api/webhooks/stripe` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API keys |
| `ENABLE_PAID_POSTING` | `true` if charging, `false` if free posting |

### AI (optional but improves ingestion quality)

| Key | Source |
|---|---|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys |

### Rate limiting (recommended pre-launch)

| Key | Source |
|---|---|
| `UPSTASH_REDIS_REST_URL` | https://upstash.com → Create Redis → REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Same page → REST Token |

### SEO indexing (post-launch, when domain is verified)

| Key | Source |
|---|---|
| `INDEXNOW_API_KEY` | Generate any 8–128 char hex (also serve from `/<key>.txt` in `public/`) |
| `BING_WEBMASTER_API_KEY` | Bing Webmaster → Settings → API Access |
| `BING_WEBMASTER_VERIFICATION` | Bing Webmaster → Site verification → HTML meta tag |
| `GOOGLE_INDEXING_CREDENTIALS` | Google Cloud → IAM → Service account JSON (stringified) |

### Monitoring (optional)

| Key | Source |
|---|---|
| `SENTRY_DSN` | https://sentry.io → New project → DSN |
| `DISCORD_WEBHOOK_URL` | Discord server → Edit channel → Integrations → Webhooks |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | https://analytics.google.com → new property → Measurement ID `G-XXXXXXXXXX` |

---

## Phase 10.3 — Vercel project setup (20 min)

- [ ] Go to https://vercel.com/new
- [ ] Import `dvskr/NP-Hiring` from GitHub
- [ ] Framework preset: **Next.js** (auto-detected)
- [ ] Build command: `npm run build` (uses `prisma migrate deploy && prisma generate && next build`)
- [ ] Install command: `npm install`
- [ ] Root directory: `./` (leave default)
- [ ] Node version: 20.x
- [ ] Paste all env vars from §10.2 into **Environment Variables** section (Production + Preview both checked)
- [ ] Click **Deploy**
- [ ] First deploy will take ~3-5 min. Watch for errors in build log.

---

## Phase 10.4 — Domain setup (10 min)

- [ ] Vercel project → Settings → Domains → Add `nphiring.com` and `www.nphiring.com`
- [ ] Vercel shows DNS records to set. In GoDaddy DNS settings:
  - A record `@` → `76.76.21.21` (or Vercel-provided IP)
  - CNAME `www` → `cname.vercel-dns.com`
- [ ] Wait for DNS propagation (5–30 min)
- [ ] HTTPS auto-issues via Vercel (no manual cert work)
- [ ] Verify https://nphiring.com loads

---

## Phase 10.5 — Database migration on Vercel (5 min)

- [ ] `prisma migrate deploy` runs automatically via `npm run build`
- [ ] Verify schema is in production Supabase: Dashboard → Table editor → confirm `jobs`, `user_profiles`, etc. tables exist
- [ ] If the first deploy fails on migrations, run `npx prisma migrate resolve --applied 0_baseline` against prod URL once

---

## Phase 10.6 — Inngest activation (5 min)

- [ ] Sign in at https://app.inngest.com
- [ ] Create environment `Production` for app `np-hiring`
- [ ] Copy Event Key + Signing Key into Vercel env (you should have done this in §10.3)
- [ ] Inngest → app → **Sync** → enter `https://nphiring.com/api/inngest`
- [ ] Inngest dashboard should show all 53 scheduled functions registered
- [ ] First scheduled cron runs automatically per the cron expression

---

## Phase 10.7 — Stripe webhook setup (if paid posting enabled)

- [ ] Stripe Dashboard → Developers → Webhooks → Add endpoint
- [ ] URL: `https://nphiring.com/api/webhooks/stripe`
- [ ] Events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`
- [ ] Copy Signing Secret → paste into Vercel env as `STRIPE_WEBHOOK_SECRET`
- [ ] Redeploy from Vercel to pick up new env

---

## Phase 10.8 — Resend domain verification (15 min)

- [ ] Resend → Domains → Add `nphiring.com`
- [ ] Add SPF, DKIM, DMARC records to GoDaddy DNS (Resend shows exact values)
- [ ] Wait for verification (~10 min)
- [ ] Resend → Webhooks → Add endpoint → `https://nphiring.com/api/webhooks/resend`
- [ ] Events: `email.delivered`, `email.bounced`, `email.complained`
- [ ] Test send: `https://nphiring.com/contact` → submit form → verify email arrives

---

## Phase 10.9 — Post-deploy sanity (15 min)

- [ ] https://nphiring.com loads, no console errors
- [ ] https://nphiring.com/api/health returns 200
- [ ] https://nphiring.com/sitemap.xml generates valid XML
- [ ] https://nphiring.com/robots.txt correct
- [ ] https://nphiring.com/jobs lists jobs (should show 335+ NP jobs from smoke ingest)
- [ ] https://nphiring.com/jobs/psychiatric-mental-health renders
- [ ] https://nphiring.com/jobs/family-practice/california renders (or shows zero-job redirect)
- [ ] Sign-up flow works: https://nphiring.com/signup → create account → confirmation email arrives
- [ ] Sign-in flow works
- [ ] Mobile rendering acceptable
- [ ] Lighthouse: Performance >85, SEO >95

---

## Phase 10.10 — SEO setup (post-launch, when domain is live)

- [ ] Google Search Console → Add property `https://nphiring.com` → verify via DNS TXT or HTML meta
- [ ] Submit sitemap: `https://nphiring.com/sitemap.xml`
- [ ] Bing Webmaster Tools → Add site → verify → submit sitemap
- [ ] Generate IndexNow key, save to `public/<key>.txt`, set env var
- [ ] Update env vars in Vercel: `INDEXNOW_API_KEY`, `BING_WEBMASTER_API_KEY`, `BING_WEBMASTER_VERIFICATION`
- [ ] Redeploy

---

## Phase 10.11 — Stripe live mode (when ready to charge)

- [ ] Stripe test → live mode switch
- [ ] Replace `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` with live keys in Vercel
- [ ] Add live webhook endpoint, copy new signing secret
- [ ] Test with real card (refund yourself)
- [ ] Set `ENABLE_PAID_POSTING=true` in Vercel env

---

## Risk log

| Risk | Mitigation |
|---|---|
| First migration fails because DB still has stale state | Already handled: dropped public schema + re-pushed during Phase 3. Should be clean. |
| Inngest crons don't fire | Verify `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` are set. Inngest dashboard → app → check sync status. |
| Email sends silently fail | `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` both required. Domain DNS must verify. |
| Stripe webhook 500s | `STRIPE_WEBHOOK_SECRET` must match the secret shown when you added the endpoint. |
| OG images 404 | `OG_IMAGE_URL` / homepage hero asset URLs still point at PMHNP's Supabase project. Upload new assets to your new bucket OR accept blank OG until Phase 8 deep-asset work. |

---

## Smoke test after deploy

```powershell
# Hit the deployed app from your local machine
$baseUrl = "https://nphiring.com"

# Health check
curl $baseUrl/api/health

# Sitemap
curl -I $baseUrl/sitemap.xml

# A category page
curl -I $baseUrl/jobs/psychiatric-mental-health

# Trigger a cron manually (requires CRON_SECRET in your local env or pasted directly)
$cron = $env:CRON_SECRET
curl -H "Authorization: Bearer $cron" "$baseUrl/api/cron/ingest?source=lever"
```

---

## After launch

- [ ] Update [BOARD_LAUNCH_PLAN.md](BOARD_LAUNCH_PLAN.md) status to "DEPLOYED"
- [ ] Write a `LAUNCH_LEARNINGS.md` noting what was reused vs niche-specific, for board #3
- [ ] Monitor first 24h: Sentry errors, Vercel function timeouts, Inngest function failures
- [ ] Run a manual relevance audit: pull 100 random jobs from DB, flag false positives, tune `lib/utils/job-filter.ts`

**Delete this file when the post-launch tasks are complete.**
