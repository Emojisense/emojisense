import { chooseFrame, type ProbeResult } from "../shared/frames";
import { TOGGLE_MESSAGE } from "../shared/messages";

/** The chrome.scripting / chrome.tabs calls needed to open the picker (a fake in tests). */
export interface Injector {
  /** Inject content.js; idempotent, the script ignores a second run. */
  injectContent(tabId: number, allFrames: boolean): Promise<void>;
  probeFrames(tabId: number): Promise<ProbeResult[]>;
  toggle(tabId: number, frameId: number): Promise<void>;
}

/**
 * Open (or close) the picker in the frame that holds the caret.
 * Throws when the page cannot be scripted (chrome:// pages, the Chrome Web Store, PDF viewer).
 */
export async function openPicker(tabId: number, injector: Injector): Promise<void> {
  try {
    await injector.injectContent(tabId, true);
  } catch {
    // Some child frame refused the injection; the top frame alone still works for most pages.
    await injector.injectContent(tabId, false);
  }
  const probes = await injector.probeFrames(tabId).catch((): ProbeResult[] => []);
  await injector.toggle(tabId, chooseFrame(probes));
}

/** Runs inside each frame (serialized by chrome.scripting), so it must be self-contained. */
function probeInFrame(): unknown {
  const api = (globalThis as { __emojisense?: { probe(): unknown } }).__emojisense;
  return api ? api.probe() : null;
}

export const chromeInjector: Injector = {
  async injectContent(tabId, allFrames) {
    await chrome.scripting.executeScript({ target: { tabId, allFrames }, files: ["content.js"] });
  },
  async probeFrames(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: probeInFrame,
    });
    return results.map((entry) => ({
      frameId: entry.frameId,
      result: (entry.result ?? null) as ProbeResult["result"],
    }));
  },
  async toggle(tabId, frameId) {
    await chrome.tabs.sendMessage(tabId, { type: TOGGLE_MESSAGE }, { frameId });
  },
};
