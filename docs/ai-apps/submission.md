# Submitting NP Hiring to Claude and ChatGPT

Everything to list the NP Hiring app in Claude's connectors directory and ChatGPT's plugin directory. Requirements
were checked on 2026-10-25 (see the research notes at the end); both directories change often, so trust their
dashboards over this file where they differ.

**Who does what:** **OWNER** only you can do it (accounts, identity, money, legal). **CLAUDE** engineering.

---

## 1. Before either submission (do these once)

### 1.1 Vercel environment (OWNER, 5 minutes)

| Variable | Value | Why |
|---|---|---|
| `MCP_OAUTH_SIGNING_SECRET` | 48+ random characters (Claude can generate one for you) | Signs the sign-in tokens. Without it, sign-in answers "not available" and only job search works. |
| `MCP_REVIEWER_USER_IDS` | The reviewer account's Supabase user id (1.3) | Lets that account see the review sandbox jobs. |
| `OPENAI_APPS_CHALLENGE_TOKEN` | The token OpenAI's dashboard shows (3.2) | Proves you own nphiring.com. |

Redeploy after setting them.

### 1.2 Review sandbox jobs (OWNER approves, CLAUDE runs)

Three test Easy Apply jobs that never appear on the website and reach no employer:

```
node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register --project scripts/tsconfig.json scripts/mcp-review-sandbox.ts --env=prod
node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register --project scripts/tsconfig.json scripts/mcp-review-sandbox.ts --env=prod --apply
```

The first command only prints what it would write. The second writes to production, so it needs your explicit OK.

### 1.3 Reviewer test account (OWNER)

Both directories reject an account that needs a magic link, an emailed or texted code, or MFA.

1. On nphiring.com, sign up as a job seeker with an email you control (for example `reviewers@nphiring.com`) and a
   password. Confirm the email once.
2. In Settings, fill the profile (name, headline, specialties, years of experience, license states) and upload a
   sample resume PDF (made-up details only).
3. Send Claude the account's email; Claude looks up its user id read-only for `MCP_REVIEWER_USER_IDS`.
4. Before submitting, apply once to a review sandbox job and save one job, so the tracker and saved jobs are not
   empty.

### 1.4 Try it yourself (OWNER, 10 minutes)

- **Claude:** add a custom connector with `https://nphiring.com/mcp`, ask the example prompts in section 4, and sign
  in when asked.
- **ChatGPT:** add a custom MCP server with `https://nphiring.com/mcp/chatgpt` (plans that allow it), same prompts.
- Check: the job cards render, the apply review opens, Settings, Account, Connected apps lists both, and Remove
  access works.

---

## 2. Claude connectors directory (OWNER)

Where: **claude.ai/directory/manage**, then **Submit new**, then **MCP connector**. Needs a Pro, Max, Team or
Enterprise account in the organization that should own the listing. Every submission is listed as Community;
Anthropic may later review it for Verified.

| Step | Enter |
|---|---|
| Connection | `https://nphiring.com/mcp` |
| Tools | Synced automatically; each tool already has a title and annotations. |
| Name | `NP Hiring` |
| One-liner | `Search nurse practitioner jobs across the US, apply with Easy Apply and track your applications.` |
| Description | Section 5.1 below |
| Categories | The closest of: Career, Productivity, Search (pick what the form offers) |
| Documentation URL | `https://nphiring.com/ai-apps` |
| Privacy policy URL | `https://nphiring.com/privacy#ai-apps` |
| Support contact | `support@nphiring.com` |
| Icon | `docs/ai-apps/assets/icon-512.png` |
| Use cases | Find NP jobs; read a job in full; apply to Easy Apply jobs after review; track and withdraw applications; save jobs; check state practice authority |
| Before connecting | Searching needs nothing. Applying needs an NP Hiring job seeker account (free). |
| Reads or writes | Both |
| Company | Akari Labs LLC, `https://nphiring.com`, your name and email |
| Authentication | OAuth with Client ID Metadata Documents (CIMD). Our server also accepts dynamic registration. |
| Data handling | Our own API. No personal health data. No sponsored content (ranking ignores paid or employer posts). |
| Reviewer instructions | Section 6 |
| Credentials | The reviewer account from 1.3 |
| Allowed link URIs | `https://nphiring.com` |
| Screenshots | 3 to 5 PNGs, at least 1000px wide, each cropped to the app's card, with the prompt that produced it (CLAUDE prepares them from the live app) |
| Compliance | Confirm the seven acknowledgments after reading the Software Directory Policy |

---

## 3. ChatGPT plugin directory (OWNER)

### 3.1 Identity

At **platform.openai.com**: an organization with global data residency (not EU), you as Owner, and **business
verification** for Akari Labs LLC (the listing shows the verified name). An unverified publisher is rejected.

### 3.2 Domain

**platform.openai.com/plugins**, **Upload new or existing plugin**, choose the verified identity, **With MCP**. The
dashboard shows a challenge token: put it in `OPENAI_APPS_CHALLENGE_TOKEN` (1.1), redeploy, and check that
`https://nphiring.com/.well-known/openai-apps-challenge` shows exactly the token.

### 3.3 Package

CLAUDE builds `np-hiring-plugin.zip` from `docs/ai-apps/openai-plugin/` (manifest, `mcp.json`, assets). Upload it;
the dashboard validates every field and names any error, and CLAUDE fixes them.

### 3.4 Review details

- **Test cases:** exactly the 5 positive and 3 negative cases in section 7.
- **Demo video:** a 1 to 2 minute screen recording in ChatGPT: search, open a job, apply to a sandbox job, see the
  tracker. Upload it unlisted (YouTube or Loom) and paste the link.
- **Credentials:** the reviewer account from 1.3.
- **Release notes:** `First release: job search, job details, Easy Apply with review, application tracker, saved jobs.`
- **Countries:** recommended `US` (every listing is a US job). Your call.
- After approval, press **Publish**. Contact press@openai.com before announcing it.

---

## 4. Example prompts (use everywhere)

1. Find remote NP jobs in Texas that pay over $150k.
2. Show me Easy Apply family practice jobs in Florida and help me apply to one.
3. Which of my NP Hiring applications are still active?
4. Does Arizona give NPs full practice authority?

ChatGPT starter prompts (up to 3, 128 characters each): prompts 1, 2 and 3.

---

## 5. Listing copy

### 5.1 Description (Claude, up to 2,000 characters; ChatGPT long description)

NP Hiring is a job board for nurse practitioners and APRNs across the United States. With the NP Hiring app you can
search every NP job on the board by specialty, state or city, work mode, schedule, pay and posting date, and read
any job in full without leaving the conversation.

Applying is built in. For Easy Apply jobs, the app opens a review card with the resume on your NP Hiring profile, a
cover letter you can edit, the employer's screening questions and the consent line. Nothing is sent until you submit
it. Jobs that take applications on the employer's site come with the employer's link, and the app can add them to
your application tracker.

Signed in, you can see every application and where it stands, withdraw one, and keep a list of saved jobs. You can
also check what a state's practice authority allows.

Searching needs no account. Applying needs a free NP Hiring job seeker account; you sign in on an NP Hiring page and
choose what the app may do, and you can remove its access at any time in Settings. The app never asks for NPI, DEA
or Social Security numbers, license numbers or EEO details, and it does not receive your conversation.

### 5.2 ChatGPT short fields

| Field | Value |
|---|---|
| displayName (30) | `NP Hiring` |
| shortDescription (30) | `Nurse practitioner jobs` |
| developerName | your verified business name |
| category | closest offered (Productivity if nothing fits better) |
| brandColor | `#BE185D` (6.0:1 on white, 2.7:1 on #212121; both pass the 2:1 rule) |
| websiteURL | `https://nphiring.com` |
| privacyPolicyURL | `https://nphiring.com/privacy` |
| termsOfServiceURL | `https://nphiring.com/terms` |
| support | `https://nphiring.com/contact` |

Capabilities (up to 20, 120 characters each):
- Search nurse practitioner and APRN jobs by specialty, location, work mode, schedule, pay and date
- Read a job in full, including pay, setting, experience, benefits and how to apply
- Apply to Easy Apply jobs after reviewing the resume, cover letter and screening answers
- Track applications and their status, and withdraw an application
- Save jobs and list saved jobs
- Check a state's NP practice authority

---

## 6. Reviewer instructions (paste into both dashboards)

1. Connect the app, then ask: "Find Easy Apply NP jobs in Texas." Searching works without signing in.
2. When the app asks to sign in, use the credentials provided. On the NP Hiring page, press Allow.
3. Ask: "Help me apply to the Family Nurse Practitioner (Review Sandbox) job with a short cover letter." Review the
   card, answer the two questions, tick the consent box and press Submit application. Sandbox jobs are test listings
   visible only to this reviewer account; an application to them reaches no employer.
4. Ask: "Show my applications." The new application appears; you can withdraw it from the card or by asking.
5. Ask: "Does Arizona give NPs full practice authority?"

---

## 7. ChatGPT test cases

| # | Prompt | Tools | Expected |
|---|---|---|---|
| P1 | Find remote NP jobs in Texas that pay at least $150k a year. | search_jobs | A card list of remote Texas NP jobs with pay at or above $150k, each with pay, location and posting date. |
| P2 | Show me the full details of the first job. | get_job | One job card with pay, schedule, setting, experience, the description and an apply button. |
| P3 | Help me apply to the Family Nurse Practitioner (Review Sandbox) job with a short cover letter. | start_application, then submit_application after the reviewer submits | The apply review with the resume, an editable cover letter, two screening questions and the consent box; after submitting, an "Application sent" card. |
| P4 | Which of my applications are still active? | list_my_applications | The tracker with each application's status and date. |
| P5 | Does Arizona give nurse practitioners full practice authority? | get_state_practice_authority | Arizona's tier (full practice) with what the state requires and the AANP source. |
| N1 | Add my NPI number 1234567890 to my NP Hiring profile. | none | Declines: the app does not take NPI numbers; the profile is edited on nphiring.com. |
| N2 | Apply to every NP job in Florida for me right now. | none, or search_jobs only | Does not submit anything in bulk; offers to search and review jobs one at a time. |
| N3 | What is the weather in Austin today? | none | The app is not used. |

---

## 8. After launch

- Put the listing links in `config/ai-apps.ts` (CLAUDE ships it), so /ai-apps points to them.
- Health: Claude's dashboard shows request errors (Healthy at 2% or less over 30 days).
- A change to tools or the widget is re-checked automatically (OpenAI daily); tell Anthropic about material
  changes.

## Research notes (2026-10-25)

Claude: claude.com/docs/connectors/building/submission, /review-criteria, /authentication, /mcp-apps/*; Anthropic
Software Directory Policy (support.claude.com/en/articles/13145358). ChatGPT: developers.openai.com/plugins/
plugin-guidelines, /deploy/submission, /deploy/app-review, /build/auth, /build/plugins, /reference.
