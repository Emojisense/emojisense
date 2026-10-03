import { schedule } from "@ember/runloop";
import { apiInitializer } from "discourse/lib/api";
import PreloadStore from "discourse/lib/preload-store";
import { emojiUrlFor } from "discourse/lib/text";
import I18n, { i18n } from "discourse-i18n";
import { isSkinTonableEmoji } from "pretty-text/emoji";
import { replacements, translations } from "pretty-text/emoji/data";
import { createEmojisense, findEmojiQuery, mergeCodes, packLocale } from "../lib/emojisense";

const AUTOCOMPLETE_LIMIT = 5;
const PICKER_LIMIT = 48;
/** The autocomplete ignores this answer (d-autocomplete's SKIP): a newer query is on its way. */
const SKIP = "skip";
const DATA_FILE = /^(pack|culture)_([a-z]{2})(_ext)?$/;

/** The data files of this component (about.json assets) by name: "pack.en.json" → URL. */
function dataFiles() {
  const local = settings.theme_uploads_local || {};
  const remote = settings.theme_uploads || {};
  const files = {};
  for (const name of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const match = DATA_FILE.exec(name);
    if (match) {
      // Same-origin URLs first: the packs are fetched, and a CDN may not send CORS headers.
      files[`${match[1]}.${match[2]}${match[3] ? ".ext" : ""}.json`] = local[name] || remote[name];
    }
  }
  return files;
}

/** The API connection, only with a publishable key: theme settings are public. */
function apiOptions() {
  if (!settings.api_enabled) {
    return {};
  }
  const key = (settings.publishable_key || "").trim();
  if (key.startsWith("sk_")) {
    // eslint-disable-next-line no-console
    console.warn(
      "[emojisense] The theme settings hold a secret key. Theme settings are public: revoke the key and use a publishable key (pk_…).",
    );
    return {};
  }
  return {
    endpoint: settings.api_url,
    ...(key.startsWith("pk_") ? { publishableKey: key } : {}),
  };
}

export default apiInitializer((api) => {
  const siteSettings = api.container.lookup("service:site-settings");
  if (!siteSettings.enable_emoji) {
    return;
  }
  const site = api.container.lookup("service:site");
  const emojiStore = api.container.lookup("service:emoji-store");

  const sense = createEmojisense({
    files: dataFiles(),
    locale: settings.search_locale === "auto" ? packLocale(I18n.currentLocale()) : settings.search_locale,
    culture: settings.culture,
    customEmoji: PreloadStore.get("customEmoji") || [],
    data: { replacements, isSkinTonable: isSkinTonableEmoji },
    ...apiOptions(),
  });

  /** Discourse keeps favorites, skin tones (":wave:t3") and text smileys (":)"). */
  const isDiscourseTerm = (term) => {
    const smileys = { ...translations, ...(site.custom_emoji_translation || {}) };
    return Array.from(term.trim()).length < 2 || /:t\d?:?$/.test(term) || smileys[`:${term}`] !== undefined;
  };

  /** The `:` autocomplete options with Emojisense ranking; other autocompletes stay as they are. */
  const withEmojisense = (options) => {
    if (options?.key !== ":") {
      return options;
    }
    const { onKeyUp, dataSource } = options;
    let latest;
    return {
      ...options,
      onKeyUp: (text, caret) => {
        sense.load();
        return onKeyUp?.(text, caret) ?? findEmojiQuery(text, caret);
      },
      dataSource: (term) => {
        latest = term;
        if (!sense.isReady() || isDiscourseTerm(term)) {
          return dataSource(term);
        }
        return Promise.all([
          sense.search(term, {
            diversity: emojiStore.diversity,
            denied: site.denied_emojis || [],
            limit: AUTOCOMPLETE_LIMIT,
            use: "autocomplete",
          }),
          Promise.resolve(dataSource(term)).catch(() => []),
        ]).then(([ours, theirs]) => {
          if (term !== latest) {
            return SKIP;
          }
          const items = Array.isArray(theirs) ? theirs : [];
          const codes = mergeCodes(
            ours || [],
            items.filter((item) => item.code).map((item) => item.code),
            AUTOCOMPLETE_LIMIT,
          );
          if (codes.length === 0) {
            return items;
          }
          const more = items.find((item) => !item.code) || {
            label: i18n("composer.more_emoji"),
            term,
          };
          return [...codes.map((code) => ({ code, src: emojiUrlFor(code) })), more];
        });
      },
    };
  };

  // The composer, in both the Markdown and the rich text editor.
  api.modifyClass(
    "component:d-editor",
    (Superclass) =>
      class extends Superclass {
        _applyEmojiAutocomplete() {
          // The composer is open: load the packs now, so the first ":" answers at once.
          sense.load();
          const textManipulation = this.textManipulation;
          if (!textManipulation?.autocomplete) {
            return super._applyEmojiAutocomplete();
          }
          const own = Object.hasOwn(textManipulation, "autocomplete");
          const original = textManipulation.autocomplete;
          textManipulation.autocomplete = (options) =>
            original.call(textManipulation, withEmojisense(options));
          try {
            return super._applyEmojiAutocomplete();
          } finally {
            if (own) {
              textManipulation.autocomplete = original;
            } else {
              delete textManipulation.autocomplete;
            }
          }
        }
      },
  );

  // Chat (when the chat plugin is on; otherwise this waits and never applies).
  api.modifyClass(
    "component:chat-composer",
    (Superclass) =>
      class extends Superclass {
        applyAutocomplete(textarea, options) {
          // Chat inputs are on every chat page: load the packs when someone starts writing.
          textarea?.addEventListener?.("focus", () => sense.load(), { once: true });
          return super.applyAutocomplete(textarea, withEmojisense(options));
        }
      },
  );

  // The search box of the emoji picker.
  api.modifyClass(
    "component:emoji-picker/content",
    (Superclass) =>
      class extends Superclass {
        debouncedDidInputFilter(filter = "") {
          sense.load();
          if (!sense.isReady() || isDiscourseTerm(filter)) {
            return super.debouncedDidInputFilter(filter);
          }
          const current = this.term;
          sense
            .search(filter, {
              denied: this.site.denied_emojis || [],
              limit: PICKER_LIMIT,
              use: "picker",
            })
            .then((codes) => {
              if (this.isDestroying || this.isDestroyed || this.term !== current) {
                return;
              }
              if (!codes?.length) {
                return super.debouncedDidInputFilter(filter);
              }
              this.filteredEmojis = codes.map((name) => ({
                name,
                tonable: isSkinTonableEmoji(name),
              }));
              this.isFiltering = false;
              schedule("afterRender", () => {
                if (this.scrollableNode) {
                  this.scrollableNode.scrollTop = 0;
                }
              });
            });
        }
      },
  );
});
