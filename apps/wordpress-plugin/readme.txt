=== Emojisense ===
Contributors: emojisense
Tags: emoji, reactions, bbpress, buddypress, comments
Requires at least: 6.6
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Find emoji by what they mean. Type :pizza or :ship it in the editor, add emoji reactions to posts and an emoji picker to comments.

== Description ==

Emojisense finds emoji by meaning, slang and intent, not only by their official names. Type `:ship it` and get 🚀, `:mind blown` and get 🤯, or, on a Turkish site, `:kolay gelsin` and get 💪.

**Block editor.** Type a colon and a word in any text block. A list of emoji ranked by meaning appears; press Enter to insert one. The toolbar of every text block also has an Emoji button (in the "More" menu) that opens a full picker.

**Classic editor.** An emoji button in the TinyMCE toolbar opens the same picker.

**Reactions (optional).** Visitors react to posts with emoji, without an account. Authors choose the reactions of each post in the editor sidebar, or let Emojisense suggest them from the post text. Only the counts are stored.

**Comments (optional).** An Emoji button under the comment field opens a picker, and typing a colon and a word in the comment field suggests emoji, so visitors can search emoji by meaning too.

**bbPress and BuddyPress (optional).** The same Emoji button and colon search in forum topics and replies, and in BuddyPress activity updates, activity comments and messages. Reactions under forum topics and replies (public forums), and under activity updates (public activity).

**Private by default.** Search runs in the browser with data files that come with the plugin. Out of the box, the plugin sends nothing to anyone. You can connect the Emojisense API for more:

* Search by meaning: when the built-in dictionary is unsure, the API adds emoji with a similar meaning.
* Reaction suggestions from the post text.
* Hosted emoji sets (Twemoji, Noto, Fluent) so every visitor sees the same emoji. Hosted sets need a publishable key on the Solo plan or higher.

**11 languages.** English, Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Russian, Indonesian and Turkish. The plugin uses your site language, and always understands English too.

**Culture layer.** Cultural and seasonal emoji join the results after the best match, for example ⚽ after 🐐 for "goat", or 🎃 for "halloween" in late October. You can turn it off.

== External services ==

This plugin can connect to the Emojisense API, a service run by Emojisense. **The connection is off by default.** Nothing is sent until an administrator turns on "Connect to the Emojisense API" in Settings → Emojisense. With the connection on:

* **Search by meaning** (can be turned off separately): when the built-in dictionary is unsure about a search in the editor or the comment picker, the visitor's browser sends the search text, the language and the site's publishable key to `https://api.emojisense.com/v1/search`.
* **Reaction suggestions** (can be turned off separately): when a post is published, your server sends the post title and the first 256 characters of its text, the language and the publishable key to `https://api.emojisense.com/v1/suggest-reactions`. Authors can also ask for suggestions from the editor sidebar.
* **Hosted emoji set** (when you choose Twemoji, Noto or Fluent): visitors' browsers load emoji images from `https://api.emojisense.com/v1/sets/`. Each image request carries the site's publishable key and the origin of the page (the API checks the key against it).
* **Culture layer**: the browser loads the current culture file from `https://api.emojisense.com/v1/culture/` instead of the copy in the plugin.

As with any web request, the API receives the IP address of the browser or server; Emojisense uses it only for rate limiting and does not store it. Post text is never stored or logged. Search text is kept only as anonymous search statistics, without an IP address or a user.

* Terms of service: https://emojisense.com/legal/terms/
* Privacy policy: https://emojisense.com/legal/privacy/

== Installation ==

1. Install the plugin from Plugins → Add New, or upload the zip file.
2. Activate it. The colon autocomplete and the emoji buttons work at once.
3. Optional: in Settings → Emojisense, turn on reactions for posts or pages, and the emoji picker in comments. With bbPress or BuddyPress active, the section "Forums and communities" turns on emoji in their forms and reactions under topics, replies and activity updates.
4. Optional: to connect the Emojisense API, create a publishable key (`pk_live_…`) at https://app.emojisense.com, add your site address (for example `https://example.com`) to the key's allowed origins, paste the key in Settings → Emojisense and turn on the connection. "Test the saved settings" checks the key and the origin.

== Frequently Asked Questions ==

= Does it work without an account or an API key? =

Yes. Search, the editor buttons, reactions and the comment picker all work without the API. The API only adds meaning search, reaction suggestions and hosted emoji images.

= The connection test says the key does not allow this site. =

Publishable keys work only on the origins you allow. Open your app at https://app.emojisense.com and add the origin shown in Settings → Emojisense, for example `https://example.com`. If your admin area is on another address, add that one too.

= Can I use my secret key? =

No. Secret keys (`sk_live_…`) must never be put on a website. The settings page refuses them. Use a publishable key.

= How do reactions stay anonymous? =

The plugin stores only a number per emoji in the post's data. It does not store IP addresses, names or cookies. To limit abuse, it keeps a keyed hash of the visitor's IP address in a temporary value that expires after a minute. The visitor's browser remembers their own reactions in local storage, so they can take a reaction back.

= Do reactions work with page caching? =

Yes. The counts in the page are refreshed when the reactions scroll into view, and each reaction request gets a fresh security token.

= Which emoji show on a post? =

The ones the author chose in the editor sidebar. Without a choice, the suggestion from the API (when it is on). Otherwise the default reactions from Settings → Emojisense.

= Where are the reactions? Can I move them? =

They appear after the content of single posts of the post types you selected, after each bbPress topic and reply, and in the meta row of each BuddyPress activity update. Use the `emojisense_show_reactions` filter to hide them on some posts, and `emojisense_show_activity_reactions` for activity items.

= Which forum and activity items show reactions? =

Only public ones, because visitors react without an account: topics and replies of public forums, and activity updates that everyone can see (not those of private or hidden groups). Forum replies never get reaction suggestions from the API; new topics can. The `emojisense_activity_reaction_types` filter adds other activity types.

= Does it slow down my site? =

The editor scripts load only in the editor. On the front end, the reactions script is about 4 KB. The comment and forum fields load their search data only when a visitor clicks into a field or opens the picker.

= What happens to my data when I delete the plugin? =

Deleting the plugin removes its settings, the reaction counts and the chosen and suggested reactions of every post.

== Screenshots ==

1. Type a colon in the block editor: emoji ranked by meaning.
2. The emoji picker from the block toolbar.
3. Reactions in the editor sidebar.
4. Reactions under a post.
5. The emoji picker in the comment form.
6. Settings → Emojisense.
7. bbPress: reactions under a topic and a reply, and colon search in the reply form.
8. BuddyPress: reactions under an activity update.

== Changelog ==

= 0.1.0 =
* First release: colon autocomplete and an emoji picker in the block editor, a TinyMCE button, reactions under posts, an emoji button and colon search in the comment form, bbPress and BuddyPress support (forms, and reactions under topics, replies and activity updates), the optional Emojisense API connection and 11 languages.

== Upgrade Notice ==

= 0.1.0 =
First release.
