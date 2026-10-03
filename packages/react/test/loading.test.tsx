import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createEngine } from "emojisense";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojisensePicker } from "../src/frimousse.js";
import { type Emojisense, preloadEmojisense, useEmojiSearch, useEmojisense } from "../src/hooks.js";
import { en, packFetch, tr } from "./fixture.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function countingFetch() {
  const packs = packFetch();
  const fetch = vi.fn(async (url: string | URL | Request) => packs(url));
  vi.stubGlobal("fetch", fetch);
  return () => fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/pack."));
}

describe("pack loading on one page", () => {
  const options = { packBaseUrl: "https://x.test/v1/pack/test", locale: "tr", extended: false };

  it("shares one download, and a hook that mounts later is ready on its first render", async () => {
    const requests = countingFetch();
    const first = renderHook(() => useEmojisense(options));
    const second = renderHook(() => useEmojisense(options));
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    first.unmount();
    second.unmount();
    const reopened = renderHook(() => useEmojisense(options));
    expect(reopened.result.current.status).toBe("ready");
    expect(reopened.result.current.engine).toBe(second.result.current.engine);
    expect(requests()).toHaveLength(2);
  });

  it("preloads the packs before the picker mounts", async () => {
    const requests = countingFetch();
    preloadEmojisense(options);
    await waitFor(() => expect(requests()).toHaveLength(2));
    const { result } = renderHook(() => useEmojisense(options));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(requests()).toHaveLength(2);
  });

  it("reports a query typed before the packs arrived as loading, then answers it", async () => {
    countingFetch();
    const { result } = renderHook(() => {
      const sense = useEmojisense(options);
      return { sense, search: useEmojiSearch("jurassic park", sense) };
    });
    expect(result.current.search.status).toBe("loading");
    await waitFor(() => expect(result.current.search.results[0]?.emoji).toBe("🦖"));
  });
});

describe("EmojisensePicker while the packs load", () => {
  const loading: Emojisense = {
    engine: undefined,
    semantic: undefined,
    packs: [],
    locale: "en",
    status: "loading",
    extended: false,
  };
  const ready: Emojisense = { ...loading, engine: createEngine([en, tr]), packs: [en, tr], status: "ready" };

  it("keeps the focus and the typed text when the packs arrive", async () => {
    let arrive: () => void = () => {};
    function Host() {
      const [sense, setSense] = useState(loading);
      arrive = () => setSense(ready);
      return <EmojisensePicker emojisense={sense} onEmojiSelect={() => {}} />;
    }
    render(<Host />);
    const before = screen.getByRole("combobox") as HTMLInputElement;
    before.focus();
    fireEvent.change(before, { target: { value: "jurassic" } });
    act(() => arrive());
    const after = screen.getByRole("combobox") as HTMLInputElement;
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("jurassic");
    const options = await screen.findAllByRole("option");
    expect(options[0]?.textContent).toBe("🦖");
  });
});
