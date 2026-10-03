/**
 * The integrations list feeds the landing page's hub and /integrations/. These checks keep it
 * honest: every card has its words and a real docs page, nothing claims an install it cannot show,
 * and every hub brand leads to a card.
 */
import { describe, expect, it } from "vitest";
import { SKINS } from "../src/demos/stage/skins";
import en from "../src/i18n/en.json";
import { DOCS_PAGES } from "../src/lib/docs-nav";
import { cardPath, GROUPS, HUB, INTEGRATIONS, integrationOf } from "../src/lib/integrations";
import { LOGOS } from "../src/lib/logos";

describe("integrations", () => {
  it("has unique keys and card anchors", () => {
    expect(new Set(INTEGRATIONS.map((item) => item.key)).size).toBe(INTEGRATIONS.length);
    expect(new Set(INTEGRATIONS.map((item) => item.slug)).size).toBe(INTEGRATIONS.length);
    for (const item of INTEGRATIONS) expect(item.slug, item.key).toMatch(/^[a-z0-9-]+$/);
  });

  it("gives every integration a name, a blurb and a group", () => {
    for (const item of INTEGRATIONS) {
      expect(en.integrations.items[item.key].name, item.key).not.toBe("");
      expect(en.integrations.items[item.key].blurb, item.key).not.toBe("");
      expect(GROUPS).toContain(item.group);
    }
  });

  it("links every card to a docs page that exists", () => {
    const docs = new Set(DOCS_PAGES.map((page) => page.href));
    for (const item of INTEGRATIONS) expect(docs.has(item.docs), `${item.key}: ${item.docs}`).toBe(true);
  });

  it("shows an install command only when it can be installed, and says where the rest will ship", () => {
    for (const item of INTEGRATIONS) {
      if (item.status === "available") expect(item.command, item.key).toBeTruthy();
      else expect(item.channel, item.key).toBeDefined();
    }
  });

  it("puts every integration on the hub, under its own group, with a mark or a known logo", () => {
    const onHub = new Set<string>();
    for (const group of GROUPS) {
      for (const brand of HUB[group]) {
        expect(integrationOf(brand.key).group, brand.key).toBe(group);
        expect(brand.logo !== undefined || brand.mark !== undefined, brand.key).toBe(true);
        if (brand.logo) expect(LOGOS[brand.logo], brand.logo).toBeDefined();
        onHub.add(brand.key);
      }
    }
    expect([...onHub].sort()).toEqual(INTEGRATIONS.map((item) => item.key).sort());
    expect(cardPath(integrationOf("tiptap"))).toBe("/integrations/#tiptap");
  });

  it("plays every stage tool against an integration that has its words", () => {
    expect(new Set(SKINS.map((skin) => skin.id)).size).toBe(SKINS.length);
    for (const skin of SKINS) {
      expect(integrationOf(skin.key).key).toBe(skin.key);
      expect(en.integrations.stage.skins[skin.id].pitch, skin.id).not.toBe("");
    }
  });
});
