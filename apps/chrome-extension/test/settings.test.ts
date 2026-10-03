import { describe, expect, it } from "vitest";
import {
  checkEndpoint,
  checkKey,
  DEFAULT_SETTINGS,
  parseSettings,
  resolveLocale,
  searchLanguages,
  semanticConfig,
} from "../src/shared/settings";
import { pasteShortcut } from "../src/shared/strings";

describe("settings", () => {
  it("defaults to offline search: semantic off, Docs experiment off", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.semantic.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.docsDirectInsert).toBe(false);
    expect(semanticConfig(DEFAULT_SETTINGS)).toBeUndefined();
  });

  it("replaces fields of the wrong type with defaults", () => {
    const parsed = parseSettings({
      locale: "de",
      skinTone: "blue",
      semantic: { enabled: "yes", endpoint: 5, key: "pk_live_12345678" },
      docsDirectInsert: true,
    });
    expect(parsed).toEqual({
      ...DEFAULT_SETTINGS,
      semantic: { enabled: false, endpoint: "", key: "pk_live_12345678" },
      docsDirectInsert: true,
    });
  });

  it("resolves the UI language", () => {
    expect(resolveLocale("auto", "tr-TR")).toBe("tr");
    expect(resolveLocale("auto", "en-GB")).toBe("en");
    expect(resolveLocale("auto", "de")).toBe("en");
    expect(resolveLocale("tr", "en-US")).toBe("tr");
  });

  it("searches the browser languages that have a pack, and English", () => {
    expect(searchLanguages("auto", ["en-US"])).toEqual({ locale: "en", locales: ["en"] });
    expect(searchLanguages("auto", ["es-ES", "de-DE", "en-US"])).toEqual({
      locale: "es",
      locales: ["es", "en"],
    });
    expect(searchLanguages("auto", ["pt-BR", "tr-TR"])).toEqual({
      locale: "pt",
      locales: ["pt", "tr", "en"],
    });
    expect(searchLanguages("auto", ["de-DE"])).toEqual({ locale: "en", locales: ["en"] });
  });

  it("prefers the chosen picker language and searches it too", () => {
    expect(searchLanguages("tr", ["en-GB"])).toEqual({ locale: "tr", locales: ["tr", "en"] });
    expect(searchLanguages("en", ["es-ES"])).toEqual({ locale: "en", locales: ["en", "es"] });
  });

  it("accepts HTTPS endpoints and normalizes them", () => {
    expect(checkEndpoint(" https://api.example.com/ ")).toEqual({
      ok: true,
      value: "https://api.example.com",
    });
    expect(checkEndpoint("https://example.com/emoji/")).toEqual({
      ok: true,
      value: "https://example.com/emoji",
    });
    expect(checkEndpoint("http://localhost:8788")).toEqual({ ok: true, value: "http://localhost:8788" });
    expect(checkEndpoint("http://127.0.0.1:8788")).toMatchObject({ ok: true });
  });

  it("refuses endpoints that would leak queries or are not addresses", () => {
    expect(checkEndpoint("")).toMatchObject({ ok: false });
    expect(checkEndpoint("api.example.com")).toMatchObject({ ok: false });
    expect(checkEndpoint("http://api.example.com")).toMatchObject({ ok: false });
    expect(checkEndpoint("ftp://api.example.com")).toMatchObject({ ok: false });
    expect(checkEndpoint("https://user:pw@api.example.com")).toMatchObject({ ok: false });
    expect(checkEndpoint("https://api.example.com/?key=1")).toMatchObject({ ok: false });
  });

  it("accepts publishable keys only, and says why a secret key is refused", () => {
    expect(checkKey("")).toEqual({ ok: true, value: "" });
    expect(checkKey(" pk_live_AbC123xyz ")).toEqual({ ok: true, value: "pk_live_AbC123xyz" });
    const secret = checkKey("sk_live_AbC123xyz");
    expect(secret).toMatchObject({ ok: false });
    expect(secret.ok ? "" : secret.error).toContain("secret key");
    expect(checkKey("pk_live_<script>")).toMatchObject({ ok: false });
  });

  it("uses the semantic API only when it is on and complete", () => {
    const on = (endpoint: string, key = "") => ({
      ...DEFAULT_SETTINGS,
      semantic: { enabled: true, endpoint, key },
    });
    expect(semanticConfig(on("https://api.example.com/", "pk_live_12345678"))).toEqual({
      endpoint: "https://api.example.com",
      key: "pk_live_12345678",
    });
    expect(semanticConfig(on("http://localhost:8788"))).toEqual({
      endpoint: "http://localhost:8788",
      key: "",
    });
    expect(semanticConfig(on(""))).toBeUndefined();
    expect(semanticConfig(on("https://api.example.com", "sk_live_12345678"))).toBeUndefined();
  });

  it("names the paste shortcut for the platform", () => {
    expect(pasteShortcut("MacIntel")).toBe("⌘V");
    expect(pasteShortcut("macOS")).toBe("⌘V");
    expect(pasteShortcut("Win32")).toBe("Ctrl+V");
    expect(pasteShortcut("Linux x86_64")).toBe("Ctrl+V");
  });
});
