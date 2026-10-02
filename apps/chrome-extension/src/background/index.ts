/**
 * Service worker. Listeners are registered synchronously at the top level, so Chrome can wake the
 * worker for them. Nothing here is state: the search index is a cache that is rebuilt on demand,
 * and settings and recent emoji live in chrome.storage.local.
 */
import { loadPacks } from "emojisense";
import { ACTION_TITLE, OPEN_PICKER_COMMAND } from "../manifest";
import { SEARCH_PORT } from "../shared/messages";
import { parseSettings, SETTINGS_KEY } from "../shared/settings";
import { chromeInjector, openPicker } from "./inject";
import { parseRecents, pushRecent, RECENTS_KEY } from "./recents";
import { createSearchService } from "./search";

/** Packs ship inside the extension (copied at build time), so every site uses one download. */
async function loadBundledPacks() {
  const baseUrl = chrome.runtime.getURL("packs");
  const locales = ["en", "tr"];
  // Index order matters (PACK_FORMAT.md): core parts first, English first, then the ext parts.
  const [core, ext] = await Promise.all([
    loadPacks({ baseUrl, locales }),
    loadPacks({ baseUrl, locales, part: "ext" }),
  ]);
  return [...core, ...ext];
}

async function readRecents(): Promise<string[]> {
  return parseRecents((await chrome.storage.local.get(RECENTS_KEY))[RECENTS_KEY]);
}

const search = createSearchService({
  loadPacks: loadBundledPacks,
  readSettings: async () => parseSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]),
  readRecents,
  recordPick: async (id) => {
    await chrome.storage.local.set({ [RECENTS_KEY]: pushRecent(await readRecents(), id) });
  },
  uiLanguage: () => chrome.i18n.getUILanguage(),
});

const UNAVAILABLE_TITLE =
  "Emojisense cannot open on this page. Browser settings pages and the extension store do not allow extensions.";

/** Tab-specific badge and title; they survive navigation, so success clears them again. */
async function markTab(tabId: number, available: boolean): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#FF5B3A" });
  await chrome.action.setBadgeText({ tabId, text: available ? "" : "!" });
  await chrome.action.setTitle({ tabId, title: available ? ACTION_TITLE : UNAVAILABLE_TITLE });
}

async function open(tabId: number): Promise<void> {
  // Build the index while the content script loads; the first keystroke rarely waits for it.
  search.warm().catch(() => undefined);
  let available = true;
  try {
    await openPicker(tabId, chromeInjector);
  } catch (error) {
    // Protected pages refuse scripts; without a signal the shortcut would look broken.
    available = false;
    console.debug("emojisense: cannot open the picker in this tab", error);
  }
  // The tab may have closed meanwhile; the badge is cosmetic.
  await markTab(tabId, available).catch(() => undefined);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === OPEN_PICKER_COMMAND && tab?.id !== undefined) void open(tab.id);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void open(tab.id);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === SEARCH_PORT && port.sender?.id === chrome.runtime.id) search.attach(port);
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // The picker has no visible surface until the shortcut is known; show it once.
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.runtime.openOptionsPage();
});
