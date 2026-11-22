# Supabase auth email templates for NP Hiring

These are paste ready bodies for the emails Supabase sends itself
(Authentication > Emails in NP Hiring's Supabase project). The app's own
mail is rendered by lib/email-templates-v2.ts. These exist so that mail
leaving Supabase looks like the same product, and so that the button is
actually visible in Outlook.

They were rendered on 2026-11-23 from the shared auth email templates of the
job board base (scripts/new-board/templates/auth-email there), with NP
Hiring's name, domain, support address and email tagline, and NP's link
colour (#BE185D, the pink of the app's own mail) as the accent. This
repository has no generator of its own: a change is made in these files by
hand, and tests/regressions/supabase-auth-email-templates.test.ts must still
pass.

## File to dashboard field mapping

Pick the template in the left hand list, paste the file into the **Message
body** field, and set the **Subject heading** to the value below.

| File | Dashboard template | Subject heading |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | Confirm your NP Hiring account |
| `invite-user.html` | Invite user | You have been invited to NP Hiring |
| `magic-link.html` | Magic Link | Your NP Hiring sign in link |
| `change-email-address.html` | Change Email Address | Confirm your new NP Hiring email address |
| `reset-password.html` | Reset Password | Reset your NP Hiring password |
| `reauthentication.html` | Reauthentication | Your NP Hiring confirmation code |

Paste the whole file, HTML comment header included. The comment does not
render in any client and it is the only thing that tells the next person why
the markup looks like this.

## Supabase must send through Resend

Without a custom SMTP server, Supabase delivers auth mail only to members of
the project's own team, two messages an hour, and refuses everyone else
("Email address not authorized"). Sign up confirmations then never reach a
real person. So the project's SMTP settings (Authentication > Emails > SMTP
Settings) must name smtp.resend.com, port 465, user `resend`, a Resend API
key with sending access to nphiring.com as the password, and the sender
NP Hiring <noreply@nphiring.com>, and the email rate limit (Authentication >
Rate Limits) must be raised from the built in two an hour at the same time.

## Why the markup looks like this

Outlook on Windows renders mail through Word, and Word ignores CSS
backgrounds on `<a>` elements. A link styled as a button keeps its padding
and its white text but loses its fill, so the recipient sees a blank gap.
Every link template defends three times: `bgcolor` on the `<td>` around the
link, a VML `<v:roundrect>` inside an `<!--[if mso]>` conditional, and the
raw URL printed as visible, copyable text under the button.

## The two rules that must never be broken

1. In every template except `reauthentication.html`, the placeholder
   `{{ .ConfirmationURL }}` appears in all three places: the VML button, the
   ordinary button and the visible fallback line, where it is both the link
   and its text. That is four literal occurrences per file.
2. The visible URL fallback is never removed. It is the only part of the
   email that survives a client nobody has tested.

## Reauthentication is deliberately different

Supabase's Reauthentication email carries a short code in `{{ .Token }}`, not
a URL. It has no button and no link, so the invisible button bug cannot
happen there. Do not paste `{{ .ConfirmationURL }}` into it: it renders an
empty string. Keep `bgcolor` on the code panel if you restyle it.

## Which flows send them

Confirm signup is sent by the sign up form (supabase.auth.signUp). Reset
Password is sent by the password buttons on the settings pages
(resetPasswordForEmail); the forgot password page and the resend
confirmation button send their own mail through Resend instead. Change Email
Address, Magic Link, Invite user and Reauthentication are only sent if
something triggers them (a dashboard action or a flow added later); no
screen of the app does today. Before turning one of those on, check that the
app has the screen its link or code lands on.

## Do not invent expiry times

None of these templates states how long a link lasts. Link lifetime is a
project setting (Authentication > Sign In / Providers > Email > Email OTP
Expiration), not a fixed constant, and it can change without anyone touching
these files. If you add a duration, read the current value first and update
the copy whenever the setting changes.

## Verifying a change

tests/regressions/supabase-auth-email-templates.test.ts reads these files and
checks every defence above, the brand they print and this mapping. It cannot
tell you whether the email looks right: before shipping a visual change, send
yourself a real one and check it in Outlook on Windows (the desktop app),
Gmail on the web, and a phone mail app.
