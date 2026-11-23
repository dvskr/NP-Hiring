# The NP Hiring app for Claude and ChatGPT (MCP)

NP Hiring can be used from Claude, ChatGPT and other MCP clients. One
connector, for job seekers, is served at `https://nphiring.com/mcp` for every
host, with its own OAuth 2.1 server under `/oauth`. It is built on the design
PMHNP Hiring runs, and replaced the first version (two endpoints, `/mcp` and
`/mcp/chatgpt`, a signing secret, sign-in that never went live) on 2026-11-23.
The employer connector is defined in the OAuth config and not served yet.

## Running it

Nothing to switch on: the connector is served on every deploy. It needs no
secret of its own (its tokens are random values stored as hashes).

- `NEXT_PUBLIC_BASE_URL`: the issuer and every address the connector gives.
- `MCP_TEST_ACCOUNTS` (optional): account emails or ids, separated by commas
  or spaces, whose applications from an assistant are checked and never
  stored or sent, for directory review.
- `OPENAI_APPS_CHALLENGE_TOKEN` (only for the ChatGPT directory): served at
  `/.well-known/openai-apps-challenge`.
- The Upstash Redis variables the rate limits already use.
- Assistants call `/mcp`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`
  and `/.well-known/oauth-*` server to server: the middleware passes them
  through (`AI_APP_MACHINE_PATHS`), and a firewall rule must not challenge
  them. `/oauth/authorize`, the consent page `/oauth/consent` and
  `/api/oauth/decision` are opened by the person's browser and keep the
  session and the site CSP.
- The daily `oauth-cleanup` runs in the morning cron batch
  (`config/cron-schedule.ts`): the retention it applies is what the privacy
  policy publishes in sections 11 and 17.

## What it offers

22 tools: search_jobs, get_job, get_pay_insights, prepare_application,
submit_application, list_my_applications, withdraw_application, save_job,
unsave_job, list_saved_jobs, compare_jobs, get_my_profile, create_job_alert,
list_my_job_alerts, delete_job_alert, search_articles, get_article,
get_practice_authority, analyze_offer, convert_pay, compare_w2_and_1099 and
find_guides (not offered to ChatGPT, whose directory allows no digital goods).

What the tools say follows the site's own rules:

- A job is shown only when it is live by `activeIndexableJobWhere()`
  (published, not expired, not a repeated dead link, not excluded). Search
  adds the /jobs filters, the specialty and APRN role filter included, and
  folds an employer's repeat postings of one role into one result.
- Pay on a card is the job page's pay line: an estimated or conflicting
  figure is never quoted. Pay figures are the salary guide's gated ones
  (`lib/salary-analytics.ts`, counted per posting, 5 postings from 3
  employers, no employer above 40%), and the site-wide figure is the "Median
  across all NP Hiring postings", never a national one.
- Practice authority is the AANP category with the state's own details from
  `lib/state-practice-authority.ts`, never a rule read off the category.
- "Featured" is said only as what the site's label means: the employer
  posted the job on NP Hiring itself.
- Applying uses the website's own service
  (`lib/applications/submit-direct-application.ts`) and asks it to require a
  resume (`requireResume`); the website's Easy Apply form still accepts none.
  A job whose screening questions ask for sensitive personal information is
  finished on the website. Withdrawing uses `lib/applications/withdraw.ts`,
  the same scrub as My Applications.
- A job alert is created through `lib/job-alerts/create-alert.ts` as the
  signed-in owner of the address; the website's form uses the same creator
  and, for an address the caller has not shown it owns, changes no existing
  alert and lifts no unsubscribe.

## Where things live

| Path | What |
|---|---|
| `app/mcp/route.ts` | the endpoint |
| `lib/mcp/endpoints/candidate.ts` | the tool list and the instructions |
| `lib/mcp/tools/` | the tools; `np-pay.ts` the pay figures, `practice-authority.ts` the AANP answers, `board-words.ts` the site's words |
| `lib/mcp/server/` | the MCP server, HTTP handling, rate limits, pending reviews, test accounts |
| `lib/mcp/oauth/`, `app/oauth/`, `app/api/oauth/`, `app/.well-known/` | the OAuth server, consent and metadata |
| `lib/mcp/widgets/` | the cards: `src/` is browser code, `generated/bundle.ts` its build, `resources.ts` the documents |
| `components/settings/ConnectedAppsSection.tsx` | where an account disconnects an assistant |
| `app/ai-apps/page.tsx` | the public how-to page the directories ask for |
| `docs/ai-apps/` | the directory submission notes and the ChatGPT package |

## The cards

One bundle, written once and shared with the other boards' engine.
`resources.ts` writes the site's name, role, hosts and support address onto
each document's root, and the cards read them (`lib/mcp/widgets/src/board.ts`);
`src/styles.ts` carries NP Hiring's berry and clay colors. After changing
anything under `lib/mcp/widgets/src`, rebuild the bundle:

```
node scripts/mcp/build-widgets.mjs
```

and commit `lib/mcp/widgets/generated/bundle.ts`. The widget tests fail when
the committed bundle is stale.

## Tests

`tests/lib/mcp/` holds the connector's tests, `tests/lib/applications/` the
apply, withdraw and status rules, and `tests/regressions/oauth-migration.test.ts`
the migration. Every test mocks the database: the checkout's `.env` is
production.
