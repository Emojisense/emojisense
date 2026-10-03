import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EmojisensePickerElement, preloadEmojisense } from "../src/index.js";
import { PACK_URL, serve } from "./fixture.js";

let fetch: ReturnType<typeof serve>;

beforeEach(() => {
  fetch = serve();
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const coreRequests = () =>
  fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.endsWith("/pack.en.json"));

function picker(): EmojisensePickerElement {
  const element = document.createElement("emojisense-picker");
  element.setAttribute("pack-url", PACK_URL);
  return element;
}

describe("<emojisense-picker> pack loading", () => {
  it("shares one download between pickers, and a picker that opens again is ready at once", async () => {
    const first = picker();
    const second = picker();
    document.body.append(first, second);
    await vi.waitFor(() => expect(first.status).toBe("ready"));
    await vi.waitFor(() => expect(second.status).toBe("ready"));
    first.remove();
    document.body.append(first);
    await Promise.resolve();
    expect(first.status).toBe("ready");
    const third = picker();
    document.body.append(third);
    await Promise.resolve();
    expect(third.status).toBe("ready");
    expect(coreRequests()).toHaveLength(1);
  });

  it("starts the download with preloadEmojisense", async () => {
    preloadEmojisense({ packUrl: PACK_URL });
    await vi.waitFor(() => expect(coreRequests()).toHaveLength(1));
    const element = picker();
    document.body.append(element);
    await vi.waitFor(() => expect(element.status).toBe("ready"));
    expect(coreRequests()).toHaveLength(1);
  });

  it("preloads the packs of the user's languages for a picker with the same locales", async () => {
    const requests = () =>
      fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/pack."));
    preloadEmojisense({ packUrl: PACK_URL, locales: ["tr", "en"] });
    await vi.waitFor(() => expect(requests()).toHaveLength(2));
    const element = picker();
    element.setAttribute("locales", "en tr");
    document.body.append(element);
    await vi.waitFor(() => expect(element.status).toBe("ready"));
    expect(requests().slice(0, 2)).toEqual([`${PACK_URL}/pack.en.json`, `${PACK_URL}/pack.tr.json`]);
    expect(requests().filter((url) => url.endsWith("/pack.tr.json"))).toHaveLength(1);
  });

  it("loads again when it reconnects after a failure", async () => {
    vi.stubGlobal("fetch", serve({ packs: false }));
    const element = picker();
    document.body.append(element);
    await vi.waitFor(() => expect(element.status).toBe("error"));
    element.remove();
    vi.stubGlobal("fetch", serve());
    document.body.append(element);
    await vi.waitFor(() => expect(element.status).toBe("ready"));
  });
});
