import { OPEN_PICKER_COMMAND } from "../manifest";
import { parseSettings, SETTINGS_KEY } from "../shared/settings";
import { initOptions } from "./page";

void initOptions(document, {
  loadSettings: async () => parseSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]),
  saveSettings: (settings) => chrome.storage.local.set({ [SETTINGS_KEY]: settings }),
  shortcut: async () =>
    (await chrome.commands.getAll()).find((command) => command.name === OPEN_PICKER_COMMAND)?.shortcut ?? "",
  openShortcutSettings: () => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
  origin: location.origin,
  platform:
    (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ??
    navigator.platform,
  fetch: globalThis.fetch.bind(globalThis),
});
