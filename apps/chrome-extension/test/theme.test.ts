import { afterEach, describe, expect, it } from "vitest";
import { isDark, pageTheme, parseRgb } from "../src/content/theme";

afterEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  for (const meta of document.head.querySelectorAll("meta")) meta.remove();
});

function nest(...backgrounds: string[]): HTMLElement {
  let parent: HTMLElement = document.body;
  for (const background of backgrounds) {
    const child = document.createElement("div");
    if (background) child.style.backgroundColor = background;
    parent.append(child);
    parent = child;
  }
  return parent;
}

describe("parseRgb", () => {
  it("reads the forms browsers use for computed colours", () => {
    expect(parseRgb("rgb(22, 22, 26)")).toEqual([22, 22, 26, 1]);
    expect(parseRgb("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
    expect(parseRgb("rgb(255 255 255 / 50%)")).toEqual([255, 255, 255, 0.5]);
    expect(parseRgb("oklch(0.2 0.01 270)")).toBeUndefined();
  });
});

describe("isDark", () => {
  it("splits backgrounds where white and black text have equal contrast", () => {
    expect(isDark([22, 22, 26, 1])).toBe(true);
    expect(isDark([255, 255, 255, 1])).toBe(false);
    expect(isDark([110, 110, 110, 1])).toBe(true);
    expect(isDark([130, 130, 130, 1])).toBe(false);
  });
});

describe("pageTheme", () => {
  it("follows the first opaque background above the field", () => {
    const field = nest("rgb(22, 22, 26)", "", "rgba(255, 255, 255, 0.1)");
    expect(pageTheme(field, window)).toBe("dark");
    const light = nest("rgb(20, 20, 20)", "rgb(250, 250, 250)", "");
    expect(pageTheme(light, window)).toBe("light");
  });

  it("follows the host of an open shadow root", () => {
    const host = nest("rgb(16, 16, 20)");
    const shadow = host.attachShadow({ mode: "open" });
    const field = document.createElement("textarea");
    shadow.append(field);
    expect(pageTheme(field, window)).toBe("dark");
  });

  it("uses the canvas without any background: white unless the page opted into dark", () => {
    const field = nest("");
    expect(pageTheme(field, window)).toBe("light");
    document.documentElement.style.setProperty("color-scheme", "dark");
    expect(pageTheme(field, window)).toBe("dark");
  });

  it("leaves the choice to the system when the page supports both schemes", () => {
    const meta = document.createElement("meta");
    meta.name = "color-scheme";
    meta.content = "light dark";
    document.head.append(meta);
    expect(pageTheme(nest(""), window)).toBeUndefined();
  });

  it("starts at the body when there is no field", () => {
    document.body.style.backgroundColor = "rgb(12, 12, 14)";
    expect(pageTheme(null, window)).toBe("dark");
  });
});
