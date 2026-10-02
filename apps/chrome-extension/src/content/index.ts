/**
 * Content script, injected on demand (keyboard command or toolbar click) through activeTab.
 * It runs in the extension's isolated world: page scripts cannot see these globals.
 */
import type { FrameProbe } from "../shared/frames";
import { isServerMessage, isToggleMessage, SEARCH_PORT, type ServerMessage } from "../shared/messages";
import { parseSettings, SETTINGS_KEY } from "../shared/settings";
import { createController, type SearchChannel } from "./controller";
import { probeFrame } from "./probe";

interface ContentApi {
  probe(): FrameProbe;
  /** False after the extension was reloaded: this copy's chrome.runtime is gone. */
  alive(): boolean;
  dispose(): void;
}

declare global {
  var __emojisense: ContentApi | undefined;
}

function runtimeAlive(): boolean {
  try {
    return typeof chrome.runtime?.id === "string";
  } catch {
    return false;
  }
}

function openChannel(onMessage: (message: ServerMessage) => void, onDisconnect: () => void): SearchChannel {
  const port = chrome.runtime.connect({ name: SEARCH_PORT });
  let open = true;
  port.onMessage.addListener((message: unknown) => {
    if (isServerMessage(message)) onMessage(message);
  });
  port.onDisconnect.addListener(() => {
    open = false;
    onDisconnect();
  });
  return {
    send(message) {
      if (!open) throw new Error("emojisense: search port is closed");
      port.postMessage(message);
    },
    close() {
      if (!open) return;
      open = false;
      port.disconnect();
    },
  };
}

function boot(): void {
  const existing = globalThis.__emojisense;
  if (existing?.alive()) return;
  // A copy left from before an extension reload: remove its listeners and overlay first.
  existing?.dispose();

  const controller = createController({
    window,
    openChannel,
    loadSettings: async () => parseSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]),
    uiLanguage: chrome.i18n.getUILanguage(),
    platform:
      (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ??
      navigator.platform,
  });

  const onMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: { ok: boolean }) => void,
  ) => {
    if (sender.id !== chrome.runtime.id || !isToggleMessage(message)) return;
    void controller.toggle();
    sendResponse({ ok: true });
  };
  chrome.runtime.onMessage.addListener(onMessage);

  globalThis.__emojisense = {
    probe: () => probeFrame(window, document),
    alive: runtimeAlive,
    dispose: () => {
      controller.dispose();
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // The old runtime is already gone.
      }
    },
  };
}

boot();
