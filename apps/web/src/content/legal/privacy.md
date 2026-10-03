# Privacy Policy

## The short version

- Most searches never leave the device. The engine and its dictionary run inside your app.
- Our code never writes IP addresses, API keys or the ids of your users to logs or analytics,
  and it never stores IP addresses. We store API keys only as a hash and their first 12
  characters.
- We never store the message text that is sent for reaction suggestions, or the images that are
  sent for photo to emoji.
- This website sets no cookies and runs no analytics and no third-party scripts.
- You can delete your dashboard account, and everything in it, at any time.
- We do not sell personal data, and we do not use it for advertising.

## Who is responsible

[Company legal name], [Registered address] ("we") is the controller for the personal data of
website visitors, people on the waitlist and dashboard account holders, including the billing data
of paid plans.

When an app sends data about its own users to our API (searches, message text, images, tenant
data), the company that makes the app is the controller, and we process the data for it.
[Data Processing Addendum: link, when available.]

## What we process, why, and for how long

Some features are not live yet: custom emoji, hosted emoji sets, teams, tenants, webhooks and
analytics. This policy already describes the data that they will process, so that it is clear
before they launch. The [docs](/docs/changelog/) show what is live.

### The website

The website is a set of static pages. It sets no cookies. It loads no analytics and no
third-party scripts, and it serves its fonts itself. We do not keep access logs for the website.
Our host, Cloudflare, processes your IP address and request data to deliver the pages and to
protect them from attacks.

The live demos on the website load the open data packs from our API and send some searches to it,
the same way that any app that uses Emojisense does. The rules below for searches apply.

On the "page not found" page, the emoji search for the address that you typed runs only in your
browser. The address is not sent to us.

### The waitlist

You join the waitlist with the form on this website. Paid plans are on sale now, so the website no
longer asks you to join it; the form stays for older links.

| What | Why | How long |
| --- | --- | --- |
| Your email address, the plan that you chose, the date of your first sign-up | To email you once, when that plan opens | 12 months after your first sign-up at most: a daily job deletes older entries. When you join again, we change the plan but keep the first date. After we send the email, we delete the entry within [Deletion period]. Earlier, when you ask, or when you delete a dashboard account with the same email address. |

The legal basis is your consent. You can withdraw it at any time: write to [Privacy email].

To limit the number of sign-ups, the waitlist uses your IP address as a rate-limit key in memory
only. It never writes the address to logs or storage.

### Dashboard accounts

Clerk, Inc. signs you in to the dashboard (see [Subprocessors](/legal/subprocessors/)). You sign in
with your email address or with a social account that we turn on in Clerk. [Sign-in methods: to
be confirmed.] Clerk keeps your sign-in profile and your sign-in sessions. To protect sign-in
from abuse, Clerk and Cloudflare Turnstile check your browser and your IP address. We never see
your password.

At each request, the dashboard gets a signed token from Clerk that is valid for one minute. It
holds your Clerk user id, your name, your primary email address and whether that address is
verified. We check the token and do not store it.

| What | Why | How long |
| --- | --- | --- |
| Your Clerk user id, your name, your primary email address if Clerk marks it as verified | To identify your account and to contact you about the Service | Until you delete your account |
| Your plan | To apply the right limits | Until you delete your account |
| Apps: names, environments (dev, staging, prod), emoji set choice | To operate your apps | Until you delete your account |
| API keys: the first 12 characters and a SHA-256 hash. The full key is shown to you once and never stored. Allowed origins, and the time of revocation. | To check requests | Until you delete your account. A revoked key stops working within one minute and stays in your list, marked as revoked. |
| Team members and their roles | To give your team access | Until the member is removed or leaves, or until the owner or the member deletes their account |
| Invites: the email address that you enter (optional: only a person who signs in with that verified address can use the invite), a hash of the invite token, the role, the expiry time and the time of acceptance | To give your team access | Until you withdraw an open invite, or until you delete your account. Used and expired invites stay, but they no longer work. |
| Webhooks: the address, the signing secret, the events, and the last 50 deliveries (event, HTTP status, duration, time) | To send events to your systems and show their status | Until you delete the webhook or your account |
| Monthly usage counts per app: AI calls, photo classifications, custom emoji | To apply plan limits and, later, to bill | Until you delete your account |

The dashboard itself sets no cookies. Clerk sets the cookies that keep you signed in, on the
dashboard's domain (for example `__session` and `__client_uat`) and on its own sign-in domain
(`__client`). They are strictly necessary, so they need no consent. [Full list of Clerk's
cookies: to be confirmed in legal review.]

### Deleting your account

You can delete your account at any time. In the dashboard, open Settings, choose "Delete
account" and type your account's email address to confirm. The dashboard API does the same:
`DELETE /api/me` (see the [HTTP API](/docs/api/) reference). You can also write to
[Privacy email].

One request deletes, at once, from the live database: your account, your apps
with their API keys, usage counts, search analytics, tenants, custom emoji (records and images)
and webhooks with their deliveries, your team members and invites, your memberships in other
teams, and the waitlist entry of your email address. Then the dashboard deletes your sign-in
profile at Clerk. For 10 minutes we keep only your Clerk user id, so that a sign-in from before
the deletion cannot create the account again. The API keeps a cache of key lookups for one minute, so a deleted key can work
for up to one more minute. A paid subscription stops renewing: we ask Whop to cancel it at the end
of the period that you paid for. Whop keeps its own payment records (see "Payments" below).

Not deleted, because they are not linked to your account: the search records in Analytics Engine
(they have no app, key or account and expire after three months), and the invites that other
owners sent to your email address (they belong to those owners). Copies of custom emoji images
that Cloudflare's edge cache or a browser already holds stay there until they are evicted or
expire. For backups, see "Deletion and backups" below.

### Custom emoji and tenants

Custom emoji images are kept in object storage on Cloudflare (R2), with their names, search
phrases, file type, size and source (upload, Slack import, Discord import or API). Tenant records
hold the id and the name that you give each of your customers. We keep this data until you delete
it or your account. For this data, our customer is the controller. A Slack or Discord token that
you give us for an import is used once and never stored or logged.

### Searches that reach the API

Most searches are answered on the device or from precomputed files. We do not see those
searches: a request for a precomputed file names only the first letters of the search, and we do
not log it.

When a search reaches the API, we record the search text after normalization (lower case, at most
64 characters), the language, the mode, the outcome, the match scores and the response time. We
record no IP address, key, app or user id with it. These records go to Cloudflare Workers
Analytics Engine, which keeps them for three months. We use a search text to improve search for
everyone only after it has been searched at least 5 times, because rare texts can be personal.

An app can turn on search reports (`stats-url` in the SDK). Then a share of its sessions, by
default 1 in 10, sends one report per page view: how many searches ended on the device, from
precomputed files or from the API, and which search results were chosen, as the normalized search
text (at most 64 characters) and the emoji. We record the app with it, but no IP address, key,
device or user id. Text that looks personal (emails, links, phone numbers, ids) is dropped and only
the emoji is kept. The reports go to Cloudflare Workers Analytics Engine, which keeps them for three
months. For this data, our customer is the controller.

Search results are cached on Cloudflare's network for up to 7 days. The cache key holds only the
normalized search text, the language, the number of results, the mode and the index version.

For searches that use an API key of an app, we also count, per app, UTC day, normalized search
text, language and country, how many searches there were and how many found nothing. Searches without a key, and
searches with development keys, are not counted. The dashboard shows these counts on the Pro and
Scale plans, and it names a search text only when the app saw it at least 5 times. We keep the
counts for the analytics period of the plan of the account that owns the app: 30 days on Pro,
1 year on Scale. On Free and Solo we keep them for 7 days and do not show them, so that an upgrade
shows the last week at once. A daily job deletes older counts. For this data, our customer is the
controller.

The country is the one that Cloudflare's network derives from the IP address of the request, at
the edge: a two-letter code such as BR, or XX when it is unknown. We store only this code, as one
more dimension of the counts above. We never store the IP address, and we never store the country
with a user, a key or a single request. The dashboard shows each customer the counts of its own
apps only. An app can also ask the API to choose regional culture results by this country
(`region=auto`); the country then selects the results of that one answer only.

We also use these counts, in aggregate, to precompute results for frequent searches. Every night
a job selects, for each language, the search texts that apps of at least 3 different accounts
searched at least 10 times in total in that language over the last 6 full days. It leaves out every text that looks like personal data:
an email or web address, a phone, account or postal number, a user id or a long token. For each
selected text it publishes the emoji results in files that anyone can download. These files hold
only the search text and its emoji, with no app, account, date or count. A text is removed with
the first nightly build after it no longer meets these rules; copies cached by browsers or by
Cloudflare's network expire within one day. Searches without a key, and searches with
development keys, are never counted, so they never reach these files.

Every night a job also finds the search texts that become more frequent in a language and a
country, so that we can propose new culture results for that region. It uses a search text only
when apps of at least 3 different accounts searched it at least 10 times in that language and
country over the last 7 full days, and only when it does not look like personal data (the same
rules as above). The list holds the search text, the language, the country and totals, with no
app, account, user or date of a single search. It is not public. We keep it for 90 days.

### Reaction suggestions

The message text (cut to 256 characters) is processed in memory to choose emoji. It is never
logged, cached or stored. We record only the outcome and the response time, without the text.

### Photo to emoji

Your app sends a small, downscaled image. The image is processed in memory and dropped. It is
never stored. When your app also sends a 64-bit perceptual hash of the image, the short
description that the model writes is cached for up to 7 days, keyed by a SHA-256 hash of the
image bytes that our API computes, so that the same image file sent many times is processed once.

### Logs

Cloudflare's automatic request logs (Workers invocation logs) are turned off for our API and our
dashboard, because they would record full request addresses, which can hold search text and keys.
Our code writes its own short log records instead: event names, error types and counts. They
never contain search text, message text, images, API keys, IP addresses or email addresses.
Cloudflare Workers Logs keeps these records for up to 7 days.

### Rate limits and security

To limit the number of requests, the API and the waitlist use the IP address as a key in memory
only. They never write the address to logs or storage. Cloudflare, our infrastructure provider,
processes IP addresses to route traffic and to block attacks.

### Payments

Whop is our payment provider (see [Subprocessors](/legal/subprocessors/)). When you buy a plan,
the dashboard sends you to Whop's checkout. Whop collects your name, email address, payment details
and billing address, takes the payments, sends the receipts and lets you change the payment method
or cancel. We never receive or store your card details. Whop's own privacy policy applies to the
data that it collects. [Whop's legal entity and role (processor or independent controller): to be
confirmed in legal review.]

| What | Why | How long |
| --- | --- | --- |
| When a checkout starts: your account id, the plan and the billing interval, sent to Whop | To match the payment to your account | Whop keeps them with the payment |
| From Whop: the membership id, the plan, the interval, the subscription status, the end of the paid period and the link to manage the subscription | To give your account the plan that you paid for, and to show it in the dashboard | Until you delete your account |
| The id, type and arrival time of each Whop event that we processed (no personal data) | To process each event only once | 30 days |

If a renewal payment fails, your plan stays for 7 days while Whop tries again; then the account
moves to Free.

## Legal bases

- **Contract:** your account, your apps and keys, the hosted features, and the payments for a paid
  plan.
- **Legitimate interests:** security and rate limits, anonymous search statistics to improve
  search, and messages about the Service.
- **Consent:** the waitlist.

## Who receives data

The companies that process data for us are on the [Subprocessors](/legal/subprocessors/) page.
We do not sell personal data. We do not share it for advertising. We disclose data when the law
requires it.

## International transfers

Cloudflare operates the Service on its global network, so data can be processed in any country
where Cloudflare has servers. Clerk is in the United States. Whop: [location and transfer
safeguards to be confirmed in legal review]. [Transfer safeguards, for example
EU Standard Contractual Clauses: to be confirmed in legal review.]

## Deletion and backups

When you delete data or your account, we delete it from the live database at once. Custom emoji
images are deleted from object storage before the records. Copies can stay in database backups
(Cloudflare D1 Time Travel) for up to [Backup retention period], and then they are gone too.

## Security

We store hashes instead of keys and invite tokens. We do not store sign-in tokens. All traffic
uses HTTPS. We collect as little data as the Service needs.

## Your rights

Depending on where you live, you can ask to see, correct, delete or export your personal data,
and you can object to or restrict its use. When we process data based on your consent, you can
withdraw it at any time. You can delete your account yourself (see "Deleting your account"). For
everything else, write to [Privacy email]. We answer within 30 days. You can also complain to your
data protection authority.

If you use an app that is built with Emojisense, ask the company that makes the app. We help it to
answer.

## Children

The Service is not for children under [Minimum age]. We do not knowingly collect their personal
data.

## Changes to this policy

We post changes on this page with a new date. Before a material change takes effect, we tell
account holders by email or in the dashboard.

## Contact

[Company legal name], [Registered address]. Privacy questions: [Privacy email].
[EU or UK representative, if required.]
