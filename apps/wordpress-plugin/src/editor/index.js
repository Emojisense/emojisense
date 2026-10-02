import { addFilter } from "@wordpress/hooks";
import { registerPlugin } from "@wordpress/plugins";
import { registerFormatType } from "@wordpress/rich-text";
import { readConfig } from "../lib/config";
import { createEngineLoader } from "../lib/engine";
import { createEmojiCompleter } from "./completer";
import { createEmojiFormat, emojiIcon, FORMAT_NAME } from "./format";
import { createReactionsPanel } from "./reactions-panel";
import "./editor.scss";

const config = readConfig();
const loader = createEngineLoader({ config });

if (config.autocomplete !== false) {
  const completer = createEmojiCompleter(loader, config);
  addFilter("editor.Autocomplete.completers", "emojisense/completer", (completers) =>
    completers.some((item) => item.name === completer.name) ? completers : [...completers, completer],
  );
  // Load the packs while the author reads, so the first ":" answers at once.
  const idle = window.requestIdleCallback ?? ((task) => setTimeout(task, 2000));
  idle(() => loader.load().catch(() => {}), { timeout: 5000 });
}

registerFormatType(FORMAT_NAME, createEmojiFormat(config));

if (Array.isArray(config.reactionPostTypes) && config.reactionPostTypes.length > 0) {
  registerPlugin("emojisense-reactions", { render: createReactionsPanel(config), icon: emojiIcon });
}
