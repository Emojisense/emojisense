# Privacy Policy

## The short version

- Most searches never leave the device. The engine and its dictionary run inside your app.
- Our API code never writes IP addresses, keys or user ids to logs, analytics or storage.
- We never store the message text that is sent for reaction suggestions, or the images that are
  sent for photo to emoji.
- This website sets no cookies and runs no analytics and no third-party scripts.
- We do not sell personal data, and we do not use it for advertising.

## Who is responsible

[Company legal name], [Registered address] ("we") is the controller for the personal data of
website visitors, people on the waitlist and dashboard account holders.

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

| What | Why | How long |
| --- | --- | --- |
| Your email address, the plan that you chose, the date | To email you once, when that plan opens | Until we send that email, then deleted within [Deletion period]. Earlier, when you ask. |

The legal basis is your consent. You can withdraw it at any time: write to [Privacy email].

### Dashboard accounts

You sign in with GitHub. We ask GitHub for the scopes `read:user` and `user:email`. We use the
GitHub access token once, to read your profile, and we never store it.

| What | Why | How long |
| --- | --- | --- |
| GitHub user id, your name (or your GitHub username), your primary email address if GitHub marks it as verified | To identify your account and to contact you about the Service | While your account exists. Deleted within [Deletion period] after you close it. |
| Your plan | To apply the right limits | While your account exists |
| Sessions: a SHA-256 hash of the session token and its expiry time | To keep you signed in | 30 days at most |
| Apps: names, environments (dev, staging, prod), emoji set choice | To operate your apps | While your account exists |
| API keys: the first 12 characters and a SHA-256 hash. The full key is shown to you once and never stored. Allowed origins. | To check requests | Until you revoke the key or close your account |
| Team members and their roles. Invites: the email address that you enter (optional), a hash of the invite token, the expiry time | To give your team access | Until removed, or until the invite expires or is accepted |
| Webhooks: the address, the signing secret, and the last 50 deliveries (event, HTTP status, duration, time) | To send events to your systems and show their status | Until you delete the webhook |
| Monthly usage counts per app: AI calls, photo classifications, custom emoji | To apply plan limits and, later, to bill | [Usage retention period] |

The dashboard sets two cookies. Both are strictly necessary, so they need no consent:

- `es_session`: keeps you signed in for up to 30 days. HttpOnly, Secure, SameSite=Lax.
- `es_oauth_state`: protects the GitHub sign-in from forged requests. It lasts 10 minutes.

### Custom emoji and tenants

Custom emoji images are kept in object storage on Cloudflare (R2), with their names, search
phrases, file type, size and source (upload, Slack import, Discord import or API). Tenant records
hold the id and the name that you give each of your customers. We keep this data until you delete
it or close your account. For this data, our customer is the controller.

### Searches that reach the API

Most searches are answered on the device or from static files. We do not see those searches.

When a search reaches the API, we record the search text after normalization (lower case, at most
64 characters), the language, the mode, the outcome and the response time. We record no IP
address, key, app or user id with it. These records go to Cloudflare Workers Analytics Engine,
which keeps them for three months. We use a search text to improve search for everyone only after
it has been searched at least 5 times, because rare texts can be personal.

Search results are cached on Cloudflare's network for up to 7 days. The cache key holds only the
normalized search text, the language, the number of results, the mode and the index version.

On the Pro and Scale plans, your dashboard shows search analytics for your apps: daily counts of
searches and of searches without a result, per normalized search text. We keep them for the
analytics period of your plan: 30 days on Pro, 1 year on Scale.

### Reaction suggestions

The message text (cut to 256 characters) is processed in memory to choose emoji. It is never
logged, cached or stored. We record only the outcome and the response time, without the text.

### Photo to emoji

Your app sends a small, downscaled image. The image is processed in memory and dropped. It is
never stored. The short description that the model writes is cached for up to 7 days, keyed by a
64-bit perceptual hash of the image, so that the same image shared many times is processed once.

### Rate limits and security

To limit the number of requests, the API uses the IP address as a key in memory only. It never
writes the address to logs or storage. Cloudflare, our infrastructure provider, processes IP
addresses to route traffic and to block attacks.

## Legal bases

- **Contract:** your account, your apps and keys, and the hosted features.
- **Legitimate interests:** security and rate limits, anonymous search statistics to improve
  search, and messages about the Service.
- **Consent:** the waitlist.

## Who receives data

The companies that process data for us are on the [Subprocessors](/legal/subprocessors/) page.
We do not sell personal data. We do not share it for advertising. We disclose data when the law
requires it.

## International transfers

Cloudflare operates the Service on its global network, so data can be processed in any country
where Cloudflare has servers. GitHub is in the United States. [Transfer safeguards, for example
EU Standard Contractual Clauses: to be confirmed in legal review.]

## Deletion and backups

When you delete data or close your account, we delete it from the live systems. Copies can stay in
database backups for up to [Backup retention period], and then they are gone too.

## Security

We store hashes instead of keys, session tokens and invite tokens. All traffic uses HTTPS.
Dashboard cookies are HttpOnly and Secure. We collect as little data as the Service needs.

## Your rights

Depending on where you live, you can ask to see, correct, delete or export your personal data,
and you can object to or restrict its use. When we process data based on your consent, you can
withdraw it at any time. Write to [Privacy email]. We answer within 30 days. You can also complain
to your data protection authority.

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
