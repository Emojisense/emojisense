import { createReactionsApi, mountReactionBar } from "../lib/reactions-client.js";
import "./reactions.scss";

declare global {
  interface Window {
    /** Written by Emojisense_Reactions::render() in PHP. */
    emojisenseReactions?: { root: string; strings?: { limited?: string; failed?: string } };
  }
}

const settings = window.emojisenseReactions;
if (settings?.root) {
  const api = createReactionsApi(settings.root);
  for (const bar of document.querySelectorAll<HTMLElement>(".emojisense-reactions[data-emojisense-post]")) {
    mountReactionBar(bar, { api, ...(settings.strings ? { strings: settings.strings } : {}) });
  }
}
