import { observeMatches } from "../lib/observe.js";
import { createReactionsApi, mountReactionBar } from "../lib/reactions-client.js";
import "./reactions.scss";

declare global {
  interface Window {
    /** Written by Emojisense_Reactions::enqueue_script() in PHP. */
    emojisenseReactions?: { root: string; strings?: { limited?: string; failed?: string } };
  }
}

const settings = window.emojisenseReactions;
if (settings?.root) {
  const api = createReactionsApi(settings.root);
  // BuddyPress adds activity items (and their bars) after the page loads.
  observeMatches(document, ".emojisense-reactions[data-emojisense-id]", (bar) => {
    mountReactionBar(bar, { api, ...(settings.strings ? { strings: settings.strings } : {}) });
  });
}
