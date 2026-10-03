/** Query card (made by the Worker for a shared playground search): the query and its top emoji. */
import { type CardContext, displayStyle, type QueryCard } from "../cards";
import { BG_SOFT, BG_SUNK, background, INK, INK_3, svgDocument, tile, WIDTH } from "../svg";
import { brand } from "./frame";

const MARGIN = 72;
const TILE = 112;
const TILE_GAP = 20;
const MAX_RESULTS = 5;

export async function renderQuery(context: CardContext, card: QueryCard): Promise<string> {
  const ui = { tag: "en", dir: "ltr" } as const;
  const { queryLang } = card;
  const rtl = queryLang.dir === "rtl";
  const width = WIDTH - MARGIN * 2;

  const eyebrow = await context.text.block(
    "Playground · search",
    { stack: "mono", size: 18, fill: INK_3, lineHeight: 24 },
    { x: WIDTH - MARGIN - 560, y: 96, width: 560, maxLines: 1, direction: "ltr", align: "end" },
  );
  const query = await context.text.fit(
    // Curly quotes read wrong in a right-to-left line; there the query stands alone.
    rtl ? card.query : `“${card.query}”`,
    [96, 84, 72, 60, 52, 44].map((size) => displayStyle(queryLang, size, INK)),
    { x: MARGIN, y: 0, width, maxLines: 2, direction: queryLang.dir, language: queryLang.tag },
  );
  const head = query.style;
  const tilesTop = 392;
  const lastBaseline = tilesTop - 0.42 * head.size - 24;
  const firstBaseline = Math.max(172 + 0.72 * head.size, lastBaseline - (query.lines - 1) * head.lineHeight);

  const results = card.results.slice(0, MAX_RESULTS);
  const hrefs = await Promise.all(results.map((emoji) => context.emoji(emoji, 72)));
  const tiles = hrefs
    .map((href, i) => {
      const offset = i * (TILE + TILE_GAP);
      const x = rtl ? WIDTH - MARGIN - TILE - offset : MARGIN + offset;
      return tile(x, tilesTop, href, { size: TILE, glyphSize: 72, fill: i === 0 ? BG_SUNK : BG_SOFT });
    })
    .join("");

  const footer = { stack: "mono", size: 18, fill: INK_3, lineHeight: 24 } as const;
  const url = await context.text.block(card.url, footer, {
    x: MARGIN,
    y: 566,
    width: 700,
    maxLines: 1,
    direction: "ltr",
  });
  const language = await context.text.block(card.languageName, footer, {
    x: WIDTH - MARGIN - 300,
    y: 566,
    width: 300,
    maxLines: 1,
    direction: queryLang.dir,
    language: queryLang.tag,
    align: rtl ? "start" : "end",
  });

  return svgDocument(
    [
      background(0.5),
      await brand(context, ui),
      eyebrow.svg,
      `<g transform="translate(0 ${firstBaseline})">${query.svg}</g>`,
      tiles,
      url.svg,
      language.svg,
    ].join(""),
  );
}
