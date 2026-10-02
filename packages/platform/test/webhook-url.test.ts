import { describe, expect, it } from "vitest";
import { checkWebhookUrl } from "../src/webhook-url.js";

const production = { allowLoopback: false };
const development = { allowLoopback: true };

describe("webhook URL rules (SSRF guard)", () => {
  it("accepts public https URLs and drops the fragment", () => {
    expect(checkWebhookUrl("https://hooks.example.com/emojisense?x=1#top", production)).toEqual({
      ok: true,
      url: "https://hooks.example.com/emojisense?x=1",
    });
    expect(checkWebhookUrl("https://93.184.216.34:8443/hook", production).ok).toBe(true);
    expect(checkWebhookUrl("https://[2606:4700::1111]/hook", production).ok).toBe(true);
  });

  it("requires https in production", () => {
    const result = checkWebhookUrl("http://hooks.example.com/", production);
    expect(result).toEqual({ ok: false, message: "url must use https." });
    expect(checkWebhookUrl("ftp://hooks.example.com/", production).ok).toBe(false);
  });

  it.each([
    "https://localhost/hook",
    "https://localhost./hook",
    "https://api.localhost/hook",
    "https://127.0.0.1/hook",
    "https://127.9.9.9/hook",
    "https://2130706433/hook", // 127.0.0.1 as one number
    "https://0x7f.1/hook",
    "https://0/hook",
    "https://10.1.2.3/hook",
    "https://172.16.0.1/hook",
    "https://172.31.255.255/hook",
    "https://192.168.1.10/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/hook",
    "https://198.18.0.1/hook",
    "https://224.0.0.1/hook",
    "https://255.255.255.255/hook",
    "https://[::1]/hook",
    "https://[::]/hook",
    "https://[::ffff:127.0.0.1]/hook",
    "https://[::ffff:10.0.0.1]/hook",
    "https://[64:ff9b::a00:1]/hook",
    "https://[2002:c0a8:101::1]/hook", // 6to4 of 192.168.1.1
    "https://[fd00::1]/hook",
    "https://[fe80::1]/hook",
    "https://[ff02::1]/hook",
    "https://[2001:db8::1]/hook",
    "https://intranet/hook",
    "https://printer.local/hook",
    "https://metadata.google.internal/computeMetadata/v1",
    "https://router.home.arpa/hook",
  ])("refuses the private or internal target %s in production", (url) => {
    const result = checkWebhookUrl(url, production);
    expect(result.ok).toBe(false);
  });

  it("allows http to loopback in development only", () => {
    expect(checkWebhookUrl("http://localhost:3000/hook", development)).toEqual({
      ok: true,
      url: "http://localhost:3000/hook",
    });
    expect(checkWebhookUrl("http://127.0.0.1:3000/hook", development).ok).toBe(true);
    expect(checkWebhookUrl("http://[::1]:3000/hook", development).ok).toBe(true);
    expect(checkWebhookUrl("http://localhost:3000/hook", production).ok).toBe(false);
  });

  it("keeps the other rules in development", () => {
    expect(checkWebhookUrl("http://hooks.example.com/", development)).toEqual({
      ok: false,
      message: "url must use https (http is allowed for localhost only).",
    });
    expect(checkWebhookUrl("https://192.168.1.10/hook", development).ok).toBe(false);
    expect(checkWebhookUrl("http://10.0.0.1/hook", development).ok).toBe(false);
  });

  it("refuses credentials, non-URLs and very long URLs", () => {
    expect(checkWebhookUrl("https://user:pw@hooks.example.com/", production).ok).toBe(false);
    expect(checkWebhookUrl("not a url", production).ok).toBe(false);
    expect(checkWebhookUrl("", production).ok).toBe(false);
    expect(checkWebhookUrl(42, production).ok).toBe(false);
    expect(checkWebhookUrl(`https://hooks.example.com/${"a".repeat(2048)}`, production).ok).toBe(false);
  });
});
