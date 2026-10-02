import { createEngine, type Pack, type PackRow } from "emojisense";
import { describe, expect, it } from "vitest";
import { compileCulture } from "../src/culture/compile.ts";
import {
  answerSchema,
  candidateEmoji,
  fillPrompt,
  parseModelAnswer,
  splitPrompt,
  toDraftRecord,
} from "../src/culture/draft.ts";
import { mergeLiveEntries, TriggerIndex, withoutTakenTriggers } from "../src/culture/live.ts";
import { datedCandidates } from "../src/culture/occurrences.ts";
import { parseExclusions } from "../src/culture/policy.ts";
import { previewRecord } from "../src/culture/preview.ts";
import type { CultureRecord } from "../src/culture/types.ts";

const row = (emoji: string, hexcode: string, label: string, alias = ""): PackRow => [
  emoji,
  hexcode,
  0,
  1,
  0,
  label,
  "",
  "",
  alias,
  "",
  "",
];
const pack: Pack = {
  format: "emojisense-pack",
  formatVersion: 1,
  packVersion: "test",
  locale: "en",
  emojiVersion: "17.0",
  groups: ["g"],
  emoji: [
    row("🐐", "1F410", "goat", "greatest of all time"),
    row("⚽", "26BD", "soccer ball", "football"),
    row("🎃", "1F383", "jack-o-lantern", "halloween"),
    row("👻", "1F47B", "ghost", "spooky"),
  ],
};
const engine = createEngine(pack);
const catalog = new Map(pack.emoji.map((r) => [r[1], r[0]]));
const exclusions = parseExclusions("[political]\nelection\n");

const record = (overrides: Partial<CultureRecord> = {}): CultureRecord => ({
  id: "goat-football",
  status: "approved",
  kind: "lasting",
  context: { en: "Football's greatest-of-all-time debate" },
  when: null,
  regions: ["*"],
  locales: ["en"],
  triggers: { en: ["goat"] },
  emoji: [{ hexcode: "26BD", weight: 0.6 }],
  source: "editorial",
  createdBy: "test",
  reviewedBy: "editor",
  createdAt: "2026-10-01",
  ...overrides,
});

const spooky = record({
  id: "spooky-season",
  kind: "event",
  when: { from: "2026-10-15", to: "2026-11-03" },
  context: { en: "The weeks before Halloween" },
  triggers: { en: ["spooky"] },
  emoji: [{ hexcode: "1F383", weight: 0.7 }],
});

describe("live entries", () => {
  const deployed = compileCulture([record()], "en", { packVersion: "test", from: "2026-10-14", catalog });

  it("merge into a deployed file over the same days and in the file order", () => {
    const merged = mergeLiveEntries(deployed, [spooky], catalog);
    expect(merged.added).toEqual(["spooky-season"]);
    expect(merged.culture.entries.map((e) => e.id)).toEqual(["spooky-season", "goat-football"]);
    expect([merged.culture.from, merged.culture.until]).toEqual([deployed.from, deployed.until]);
  });

  it("leave the deployed entry when git already has the id, and skip windows outside the file", () => {
    const shadow = mergeLiveEntries(deployed, [record({ triggers: { en: ["greatest"] } })], catalog);
    expect(shadow).toMatchObject({ added: [], shadowed: ["goat-football"] });
    expect(shadow.culture.entries[0]?.triggers).toEqual(["goat"]);
    const past = record({ id: "old", kind: "event", when: { from: "2026-01-01", to: "2026-01-05" } });
    expect(mergeLiveEntries(deployed, [past], catalog).added).toEqual([]);
  });

  it("index triggers by locale and drop the ones another entry owns", () => {
    const taken = new TriggerIndex().addCulture(deployed).addRecord(spooky);
    expect(taken.owner("en", "goat")).toBe("goat-football");
    expect(taken.owner("es", "goat")).toBeUndefined();
    const draft = record({ id: "new", triggers: { en: ["goat", "spooky", "fresh"] } });
    const { record: kept, dropped } = withoutTakenTriggers(draft, taken);
    expect(kept.triggers).toEqual({ en: ["fresh"] });
    expect(dropped.map((d) => d.owner)).toEqual(["goat-football", "spooky-season"]);
  });
});

describe("drafts", () => {
  it("fill and split prompts", () => {
    const { system, user } = splitPrompt("# t\n## SYSTEM\nbe neutral\n## USER\nToday {{TODAY}} {{X}}");
    expect(system).toBe("be neutral");
    expect(fillPrompt(user, { TODAY: "2026-10-15" })).toBe("Today 2026-10-15 {{X}}");
    expect(() => splitPrompt("no parts")).toThrow(/SYSTEM/);
  });

  it("read chat-completions, `response` and fenced answers", () => {
    const answer = { skip: false, triggers: { en: ["x"] } };
    expect(parseModelAnswer({ choices: [{ message: { content: JSON.stringify(answer) } }] })).toEqual(answer);
    expect(parseModelAnswer({ response: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` })).toEqual(answer);
    expect(parseModelAnswer({ response: answer })).toEqual(answer);
    expect(parseModelAnswer({})).toMatchObject({ skip: true });
    expect(() => parseModelAnswer({ response: "no json" })).toThrow();
  });

  it("list every locale key in the strict answer schema", () => {
    const schema = answerSchema(["es"]) as {
      properties: Record<string, { required?: string[] }>;
      required: string[];
    };
    expect(schema.properties.context?.required).toEqual(["en", "es"]);
    expect(schema.properties.triggers?.required).toEqual(["es"]);
    expect(schema.required).toContain("emoji");
  });

  it("offer only catalog emoji, hints first", () => {
    const options = candidateEmoji(engine, catalog, ["1F47B", "FFFF"], ["football"], "en");
    expect(options.map((o) => o.emoji)).toEqual(["👻", "⚽"]);
    expect(options[1]?.label).toBe("soccer ball");
  });

  it("normalize triggers, keep allowed emoji only and clamp weights", () => {
    const draft = toDraftRecord(
      {
        id: "x",
        kind: "event",
        when: { from: "2026-10-15", to: "2026-10-20" },
        regions: ["*"],
        locales: ["en"],
        featured: true,
        source: "ai-proposed",
      },
      {
        context: { en: "  A moment  ", fr: "ignored" },
        triggers: { en: ["Spooky Season!", "spooky season", 7 as unknown as string], fr: ["x"] },
        emoji: [
          { hexcode: "1F47B", weight: 3 },
          { hexcode: "1F9FF", weight: 0.5 },
          { hexcode: "1F47B", weight: 0.2 },
        ],
      },
      new Set(["1F47B"]),
      { createdBy: "test", createdAt: "2026-10-15" },
    );
    expect(draft).toMatchObject({
      status: "draft",
      context: { en: "A moment" },
      triggers: { en: ["spooky season"] },
      emoji: [{ hexcode: "1F47B", weight: 1 }],
      featured: true,
    });
  });

  it("give calendar moments the same ids as culture:propose", () => {
    const source = {
      id: "cup-final",
      title: { en: "Cup final" },
      category: "sport" as const,
      regions: ["*"],
      locales: ["en"],
      dates: [{ from: "2026-10-25", to: "2026-10-25" }],
      basis: "listed",
      hint: "final",
    };
    const [candidate] = datedCandidates(source, "2026-10-15", 45, 7);
    expect(candidate).toMatchObject({
      id: "cup-final-2026",
      kind: "event",
      when: { from: "2026-10-18", to: "2026-10-25" },
      sourceId: "cup-final",
      basis: "listed",
    });
  });
});

describe("previews", () => {
  it("show the canonical answer and the answer with the entry, and validation issues", () => {
    const preview = previewRecord(spooky, {
      catalog,
      exclusions,
      packVersion: "test",
      engineFor: () => engine,
    });
    expect(preview.issues).toEqual([]);
    const row = preview.locales[0]?.triggers[0];
    expect(row?.canonical.map((r) => r.emoji)).toEqual(["👻"]);
    expect(row?.boosted.map((r) => [r.emoji, r.culture])).toEqual([
      ["👻", false],
      ["🎃", true],
    ]);
    const bad = previewRecord(record({ triggers: { en: ["election goat"] } }), {
      catalog,
      exclusions,
      packVersion: "test",
      engineFor: () => engine,
    });
    expect(bad.issues.map((i) => i.message).join()).toMatch(/excluded phrase/);
  });
});
