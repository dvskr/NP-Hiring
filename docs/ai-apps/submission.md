# Submitting NP Hiring to Claude and ChatGPT

Everything to list the NP Hiring app in Claude's connectors directory and ChatGPT's plugin directory. The connector
is the 2026-11-23 rebuild on PMHNP Hiring's design (one endpoint, `https://nphiring.com/mcp`, for every host; see
[../mcp/README.md](../mcp/README.md)). Both directories change often, so trust their dashboards over this file where
they differ; PMHNP Hiring's own submission (its `docs/mcp/SUBMISSION.md`) is the most recent walk through both.

**Who does what:** **OWNER** only you can do it (accounts, identity, money, legal). **CLAUDE** engineering.

---

## 1. Before either submission (do these once)

### 1.1 Vercel environment (OWNER, 5 minutes)

| Variable | Value | Why |
|---|---|---|
| `MCP_TEST_ACCOUNTS` | The reviewer account's email or user id (1.2) | That account's applications from an assistant are checked and never stored or sent, and the review card says so. |
| `OPENAI_APPS_CHALLENGE_TOKEN` | The token OpenAI's dashboard shows (3.2) | Proves you own nphiring.com. |

Sign-in needs no secret: it works as soon as the connector is deployed. Redeploy after setting either variable.

### 1.2 Reviewer test account (OWNER)

Both directories reject an account that needs a magic link, an emailed or texted code, or MFA.

1. On nphiring.com, sign up as a job seeker with an email you control and a password. Confirm the email once.
2. In Settings, fill the profile (name, headline, years of experience, license states, certifications) and upload a
   sample resume PDF with made-up details only. An application from an assistant always includes the resume.
3. Put the account's email in `MCP_TEST_ACCOUNTS` (1.1).
4. Apply once to a job on the website and save one job, so the tracker and saved jobs are not empty.

### 1.3 Try it yourself (OWNER, 10 minutes)

- **Claude:** add a custom connector with `https://nphiring.com/mcp`, ask the example prompts in section 4, and sign
  in when asked.
- **ChatGPT:** add a custom MCP server with the same URL (plans that allow it), same prompts.
- Check: the job cards render, the apply review opens and, for the test account, shows that nothing will be sent;
  Settings, Account, Connected apps lists the connection, and Remove access works.

---

## 2. Claude connectors directory (OWNER)

Where: **claude.ai/directory/manage**, then **Submit new**, then **MCP connector**. Needs a Pro, Max, Team or
Enterprise account in the organization that should own the listing. Every submission is listed as Community;
Anthropic may later review it for Verified.

| Step | Enter |
|---|---|
| Connection | `https://nphiring.com/mcp` |
| Tools | Synced automatically; each tool has a title and annotations, and no description tells the model how to act (`tests/lib/mcp/tool-descriptions-describe.test.ts`). |
| Name | `NP Hiring` |
| One-liner | `Search nurse practitioner and APRN jobs, check pay and practice authority, and apply with your NP Hiring profile.` |
| Description | Section 5.1 below |
| Categories | A jobs or careers category, plus Productivity (no health category) |
| Documentation URL | `https://nphiring.com/ai-apps` |
| Privacy policy URL | `https://nphiring.com/privacy#ai-apps` |
| Support contact | `support@nphiring.com` |
| Icon | `docs/ai-apps/assets/icon-512.png` |
| Use cases | Search jobs; check pay against an offer; apply after review |
| Before connecting | Searching needs nothing. Applying needs an NP Hiring job seeker account (free). |
| Reads or writes | Read and write |
| Company | Akari Labs LLC, `https://nphiring.com` |
| Authentication | Required when the server asks, with Dynamic Client Registration; no custom headers |
| Data handling | Our own API. No personal health data. No sponsored content: nothing moves a listing up, and "Featured" is the site's label on any job an employer posted on NP Hiring itself. |
| Reviewer instructions | Section 6 |
| Credentials | The reviewer account from 1.2, on request |
| Allowed link URIs | `https://nphiring.com` |
| Screenshots | 3 to 5 PNGs, at least 1000px wide, each cropped to the app's card, with the prompt that produced it (CLAUDE prepares them with sample listings) |
| Compliance | Confirm the acknowledgments after reading the Software Directory Policy |

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

CLAUDE builds the zip from `docs/ai-apps/openai-plugin/` (manifest, `mcp.json`, assets) with forward slashes in every
path (never Compress-Archive). Upload it; the dashboard validates every field and names any error, and CLAUDE fixes
them. `find_guides` is not offered to ChatGPT (no digital goods).

### 3.4 Review details

- **Test cases:** exactly the 5 positive and 3 negative cases in section 7.
- **Demo video:** a 1 to 2 minute screen recording in ChatGPT: search, open a job, the apply review with its test
  account note, the tracker. Upload it unlisted and paste the link in Review details.
- **Credentials:** the reviewer account from 1.2.
- **Release notes:** `First release: job search, job details, pay insights, Easy Apply with review, application tracker, saved jobs, job alerts.`
- **Countries:** recommended `US` (every listing is a US job). Your call.
- After approval, press **Publish**.

---

## 4. Example prompts (use everywhere)

1. Find remote NP jobs in Texas that pay over $150k.
2. Show me Easy Apply family practice jobs in Florida and help me apply to one.
3. Which of my NP Hiring applications are still active?
4. Does Arizona give NPs full practice authority?
5. Compare a $140k W-2 offer with a $95 an hour 1099 contract.

ChatGPT starter prompts (up to 3, 128 characters each): prompts 1, 2 and 3.

---

## 5. Listing copy

### 5.1 Description (Claude, up to 2,000 characters; ChatGPT long description)

NP Hiring is a job board for nurse practitioners and APRNs across the United States, every NP specialty plus nurse
anesthetists, nurse midwives and clinical nurse specialists. With the NP Hiring app you can search every job on the
board by specialty or APRN role, state or city, work mode, schedule, pay and posting date, read any job in full, and
compare two or three side by side without leaving the conversation.

Applying is built in. For Easy Apply jobs, the app opens a review card with the resume on your NP Hiring profile, a
cover letter you can edit, the employer's screening questions and the consent line. Nothing is sent until you
confirm. Jobs that take applications on the employer's site link to the job page.

Signed in, you can see every application and where it stands, withdraw one, keep a list of saved jobs and set up job
alerts. Without an account you can check advertised pay by state, a state's NP practice authority, NP Hiring's
articles, and the pay calculators, including W-2 against 1099.

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
- Read a job in full, or compare two or three side by side
- Apply to Easy Apply jobs after reviewing the resume, cover letter and screening answers
- Track applications and their status, and withdraw an application
- Save jobs, list saved jobs and set up job alerts
- Check advertised pay by state and a state's NP practice authority
- Compare a W-2 offer with a 1099 rate, and convert pay between periods

---

## 6. Reviewer instructions (paste into both dashboards)

1. Connect the app, then ask: "Find Easy Apply NP jobs in Texas." Searching works without signing in.
2. When the app asks to sign in, use the credentials provided. On the NP Hiring page, press Allow.
3. Ask: "Help me apply to the first of those jobs with a short cover letter." The review card says this is a test
   account: an application from it is checked exactly as any other, and then nothing is stored and the employer
   receives nothing. Answer the screening questions, tick the consent box and press Submit.
4. Ask: "Show my applications." The tracker lists the account's applications.
5. Ask: "Does Arizona give NPs full practice authority?"

---

## 7. ChatGPT test cases

| # | Prompt | Tools | Expected |
|---|---|---|---|
| P1 | Find remote NP jobs in Texas that pay at least $150k a year. | search_jobs | A card list of remote Texas jobs with pay at or above $150k, each with pay, location and posting date. |
| P2 | Show me the full details of the first job. | get_job | One job card with pay, schedule, setting, experience, the description and an apply button. |
| P3 | Help me apply to an Easy Apply family practice job in Florida with a short cover letter. | search_jobs, prepare_application, then submit_application after the reviewer confirms | The apply review with the resume, an editable cover letter, the screening questions, the consent box and the test account note; after submitting, a card that says nothing was sent. |
| P4 | Which of my applications are still active? | list_my_applications | The tracker with each application's status and date. |
| P5 | Does Arizona give nurse practitioners full practice authority? | get_practice_authority | Arizona's AANP category with what the state requires, the state board of nursing and the AANP source. |
| N1 | Add my NPI number 1234567890 to my NP Hiring profile. | none | Declines: the app does not take NPI numbers; the profile is edited on nphiring.com. |
| N2 | Apply to every NP job in Florida for me right now. | none, or search_jobs only | Does not submit anything in bulk; offers to search and review jobs one at a time. |
| N3 | What is the weather in Austin today? | none | The app is not used. |

---

## 8. After launch

- Put the listing links in `config/ai-apps.ts` (CLAUDE ships it), so /ai-apps points to them.
- Health: Claude's dashboard shows request errors (Healthy at 2% or less over 30 days).
- A change to tools or the widget is re-checked automatically (OpenAI daily); tell Anthropic about material
  changes.
