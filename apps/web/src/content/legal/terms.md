# Terms of Service

These terms are an agreement between you and [Company legal name] ("Emojisense", "we", "us"),
[Registered address]. They cover the Emojisense website, the hosted search API, the dashboard and
the hosted features (together, the "Service"). When you use the Service, you accept these terms.
When you use it for an organization, you accept them for that organization, and you confirm that
you may do so.

## The Service

Emojisense is an emoji platform for apps: emoji search, reaction suggestions, photo to emoji,
custom emoji, hosted emoji sets, analytics, teams and tenants. Part of it runs on the devices of
your users. Part of it runs on our API, on Cloudflare's network. Some features are not available
yet. The [docs](/docs/changelog/) show which ones are live.

## Open-source software

The engine, the data packs, the SDKs, the API server and the dashboard are published under the
[MIT License](https://opensource.org/license/mit). When you use, copy, change or self-host that
software, the MIT License applies, not these terms. These terms apply only to the Service that we
operate for you.

The emoji data includes material from Emojibase (MIT) and Unicode CLDR (Unicode License v3).
Their licenses continue to apply to that material.

## Accounts

- You sign in through Clerk, our sign-in provider. Keep your sign-in secure. Give us accurate
  information.
- You must be at least [Minimum age] years old and able to make a binding contract.
- You are responsible for all activity in your account and your apps. This includes the actions
  of the team members that you invite.

## API keys

- **Publishable keys** (`pk_live_…`) are for browsers and apps. Limit each production key to your
  own origins in the dashboard. A key without allowed origins is for development only.
- **Secret keys** (`sk_live_…`) are for servers only. Never put a secret key in a web page, an app
  bundle or a public repository. The API refuses secret keys that come from a browser.
- You are responsible for the use of your keys. If a key leaks, revoke it in the dashboard. We
  can revoke a key that we think is compromised or misused. When we can, we tell you first.

## Plans, limits and fair use

- The Free plan costs nothing. The paid plans (Solo, Pro and Scale) are not on sale yet, and we
  have no payment provider. Asking for a paid plan in the dashboard only puts you on the waitlist.
  Before we charge you anything, we will publish the prices and the payment terms, and you must
  agree to them.
- Each plan has monthly limits, counted per calendar month in UTC. The
  [pricing page](/pricing/) shows them. Searches that are answered on the device or from static
  files are not counted.
- The Service does not stop at a limit. Over a limit, the API answers with `overLimit: true`, and
  search continues on the device and from cached results. New AI calls and photo
  classifications stop until the next month.
- Custom emoji limits are subject to fair use.
- Per-second rate limits apply to every key. They protect the Service for everyone.

## Your content

"Your content" is the custom emoji that you upload or import (images, names and search phrases),
the names and ids of your tenants, your webhook addresses, and the text and images that your apps
send to the API.

- You keep all rights to your content.
- You give us a worldwide, non-exclusive, royalty-free license to host, store, copy, process,
  convert, describe and deliver your content. We use this license only to operate the Service for
  you and your users. It ends when you delete the content or your account. Backup copies are
  deleted on the schedule in the [Privacy Policy](/legal/privacy/).
- To make custom emoji searchable, we can write descriptions and search phrases for them
  automatically.
- You confirm that you have the rights that your content needs, and that it obeys the
  [Acceptable Use Policy](/legal/acceptable-use/).
- Message text that you send for reaction suggestions and images that you send for photo to emoji
  are processed in memory and not stored. The [Privacy Policy](/legal/privacy/) gives the details.

## Hosted emoji sets

We host emoji sets that other people made (Twemoji, Noto Emoji and Fluent Emoji), under their own
licenses (CC BY 4.0, Apache 2.0 and SIL OFL 1.1, and MIT). We charge for hosting and delivery,
not for the artwork. These terms do not limit the rights that those licenses give you.

## Search statistics

We use the normalized text of searches that reach our API to make search better for everyone,
for example with new search phrases and precomputed results. We use a search text only after it
has been searched at least 5 times. The records that we use for this have no IP address, key, app
or person in them. The per-app search counts that your dashboard shows are kept apart and are not
used for this. The [Privacy Policy](/legal/privacy/) gives the details.

## Acceptable use

You must obey the [Acceptable Use Policy](/legal/acceptable-use/). It is part of these terms.

## Availability and changes

- We work to keep the Service available and fast. We do not promise that it is always available
  or free of errors. The Free plan has no service level agreement. [Service level terms for paid
  plans, if any.]
- We can change, add or remove features. Before we remove a feature that you use, or reduce a
  paid plan, we tell you at least [Notice period] in advance.
- The API is versioned (`/v1`). We announce breaking changes to a version in advance in the
  [changelog](/changelog/).

## Suspension and termination

- You can stop using the Service at any time. To close your account, delete it in the dashboard
  (Settings, "Delete account", or `DELETE /api/me` in the [HTTP API](/docs/api/)), or write to
  [Contact email]. Deletion is permanent and removes your apps, keys and custom emoji too.
- We can suspend or end your access when you break these terms, when your use puts the Service or
  other people at risk, or when the law requires it. When we can, we tell you first and give you
  time to correct the problem.
- When your account ends, we delete your data as the [Privacy Policy](/legal/privacy/) describes.

## Disclaimers

To the extent that the law allows, the Service is provided "as is" and "as available", without
warranties of any kind, express or implied, including warranties of merchantability, fitness for
a particular purpose and non-infringement. Emoji results are suggestions made by software. They
can be wrong, surprising or unsuitable in some contexts. You decide what your users see.

## Limitation of liability

To the extent that the law allows, neither party is liable for indirect, incidental, special,
consequential or punitive damages, or for lost profits, revenue or data. Our total liability for
all claims about the Service is limited to the greater of the amounts that you paid us for the
Service in the 12 months before the claim, and [Liability floor]. Nothing in these terms limits
liability that the law does not allow to be limited.

## Indemnity

You will defend us against claims from third parties that come from your content, or from your
breach of these terms or the Acceptable Use Policy, and you will pay the costs and damages that a
court or a settlement you agree to awards. [Scope to be confirmed in legal review.]

## Changes to these terms

We can update these terms. We post the new version on this page with a new date. Before a
material change takes effect, we tell account holders by email or in the dashboard, at least
[Notice period] in advance.

## Governing law

These terms are governed by the laws of [Governing law]. The courts of [Venue] have exclusive
jurisdiction, except where consumer protection law gives you the right to go to court elsewhere.

## Contact

[Company legal name], [Registered address]. Email: [Contact email].
