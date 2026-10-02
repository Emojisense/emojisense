import { describe, expect, it, vi } from "vitest";
import { type Injector, openPicker } from "../src/background/inject";
import {
  DEFAULT_RECENTS,
  MAX_RECENTS,
  parseRecents,
  pushRecent,
  recentsToShow,
  SHOWN_RECENTS,
} from "../src/background/recents";
import { createManifest, PERMISSIONS } from "../src/manifest";
import { chooseFrame, type FrameProbe } from "../src/shared/frames";
import { isClientMessage, isServerMessage } from "../src/shared/messages";

const probe = (overrides: Partial<FrameProbe>): FrameProbe => ({
  top: false,
  focused: false,
  activeIsFrame: false,
  editable: false,
  docs: false,
  docsEventFrame: false,
  ...overrides,
});

describe("chooseFrame", () => {
  it("picks the focused leaf frame, not its parent", () => {
    expect(
      chooseFrame([
        { frameId: 0, result: probe({ top: true, focused: true, activeIsFrame: true }) },
        { frameId: 7, result: probe({ focused: true, editable: true }) },
        { frameId: 9, result: probe({}) },
      ]),
    ).toBe(7);
  });

  it("opens in the top frame on Google Docs, never in the hidden keystroke frame", () => {
    expect(
      chooseFrame([
        {
          frameId: 0,
          result: probe({ top: true, focused: true, activeIsFrame: true, docs: true, editable: true }),
        },
        { frameId: 3, result: probe({ focused: true, editable: true, docsEventFrame: true }) },
      ]),
    ).toBe(0);
  });

  it("falls back to the top frame without a usable answer", () => {
    expect(chooseFrame([])).toBe(0);
    expect(chooseFrame([{ frameId: 4, result: null }])).toBe(0);
    expect(
      chooseFrame([{ frameId: 0, result: probe({ top: true, focused: true, activeIsFrame: true }) }]),
    ).toBe(0);
  });
});

describe("openPicker", () => {
  function injector(overrides: Partial<Injector> = {}): Injector {
    return {
      injectContent: vi.fn(async () => undefined),
      probeFrames: vi.fn(async () => [
        { frameId: 0, result: probe({ top: true, focused: true, activeIsFrame: true }) },
        { frameId: 5, result: probe({ focused: true, editable: true }) },
      ]),
      toggle: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it("injects into all frames and toggles the frame with the caret", async () => {
    const api = injector();
    await openPicker(12, api);
    expect(api.injectContent).toHaveBeenCalledWith(12, true);
    expect(api.toggle).toHaveBeenCalledWith(12, 5);
  });

  it("retries with the top frame only when a child frame refuses the script", async () => {
    const injectContent = vi.fn(async (_tab: number, allFrames: boolean) => {
      if (allFrames) throw new Error("Cannot access a chrome-extension:// URL of different extension");
    });
    const api = injector({ injectContent, probeFrames: vi.fn(async () => Promise.reject(new Error("x"))) });
    await openPicker(1, api);
    expect(injectContent).toHaveBeenLastCalledWith(1, false);
    expect(api.toggle).toHaveBeenCalledWith(1, 0);
  });

  it("fails on pages that cannot be scripted, so the caller can say so", async () => {
    const api = injector({ injectContent: vi.fn(async () => Promise.reject(new Error("chrome:// URL"))) });
    await expect(openPicker(1, api)).rejects.toThrow("chrome://");
    expect(api.toggle).not.toHaveBeenCalled();
  });
});

describe("recent emoji", () => {
  it("moves a pick to the front without duplicates and caps the list", () => {
    expect(pushRecent(["1F680", "1F996"], "1F996")).toEqual(["1F996", "1F680"]);
    const full = Array.from({ length: MAX_RECENTS }, (_, i) => (0x1f600 + i).toString(16).toUpperCase());
    expect(pushRecent(full, "1F680")).toHaveLength(MAX_RECENTS);
  });

  it("reads only well-formed ids from storage", () => {
    expect(parseRecents(["1F680", 5, "<b>", "1F468-200D-1F4BB"])).toEqual(["1F680", "1F468-200D-1F4BB"]);
    expect(parseRecents("1F680")).toEqual([]);
  });

  it("tops up the user's picks with defaults", () => {
    const shown = recentsToShow(["1F996"]);
    expect(shown[0]).toBe("1F996");
    expect(shown).toHaveLength(SHOWN_RECENTS);
    expect(recentsToShow([])).toEqual(DEFAULT_RECENTS.slice(0, SHOWN_RECENTS));
  });
});

describe("message contracts", () => {
  it("accepts only well-formed client messages", () => {
    expect(isClientMessage({ type: "query", query: "rocket" })).toBe(true);
    expect(isClientMessage({ type: "picked", id: "1F680" })).toBe(true);
    expect(isClientMessage({ type: "query", query: "x".repeat(1000) })).toBe(false);
    expect(isClientMessage({ type: "picked", id: "javascript:alert(1)" })).toBe(false);
    expect(isClientMessage({ type: "eval", code: "1" })).toBe(false);
  });

  it("accepts only well-formed server messages", () => {
    expect(isServerMessage({ type: "results", query: "", status: "recent", items: [] })).toBe(true);
    expect(isServerMessage({ type: "results", query: "", status: "weird", items: [] })).toBe(false);
    expect(isServerMessage({ type: "unavailable", reason: "x" })).toBe(true);
  });
});

describe("manifest", () => {
  const manifest = createManifest("0.1.0");

  it("asks for the minimum: no host permissions, no content script on every page", () => {
    expect(manifest.permissions).toEqual([...PERMISSIONS]);
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage", "clipboardWrite"]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest).not.toHaveProperty("web_accessible_resources");
    expect(manifest).not.toHaveProperty("externally_connectable");
  });

  it("allows no remote code and no eval", () => {
    const csp = manifest.content_security_policy?.extension_pages ?? "";
    expect(csp).toBe("script-src 'self'; object-src 'self'");
    expect(csp).not.toMatch(/unsafe|http/);
  });

  it("suggests a rebindable shortcut for macOS and other systems", () => {
    expect(manifest.commands?.["open-picker"]?.suggested_key).toEqual({
      default: "Ctrl+Shift+Space",
      mac: "Command+Shift+Space",
    });
  });
});
