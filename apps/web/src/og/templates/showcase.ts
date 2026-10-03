/** Home and integrations cards: rows of what people type, each with its top emoji results. */
import type { CardContext, ShowcaseCard } from "../cards";
import { BG_SOFT, BG_SUNK, hline, INK, INK_3, tile } from "../svg";
import { labelStyles, PANEL, renderFrame } from "./frame";

const ROW_HEIGHT = 84;
const TILE = 56;
const TILE_STEP = 62;

export function renderShowcase(context: CardContext, card: ShowcaseCard): Promise<string> {
  const { lang } = card;
  return renderFrame(context, card, async (panel) => {
    const rows = card.rows.slice(0, 5);
    const parts = await Promise.all(
      rows.map(async (row, i) => {
        const y = panel.y + PANEL.header + i * ROW_HEIGHT;
        const results = row.results.slice(0, 3);
        const hrefs = await Promise.all(results.map((emoji) => context.emoji(emoji, 32)));
        // The first result sits nearest the text, as on the site.
        const tiles = hrefs
          .map((href, j) => {
            const x = panel.end(32 + (results.length - 1 - j) * TILE_STEP, TILE);
            return tile(x, y + 14, href, { fill: j === 0 ? BG_SUNK : BG_SOFT });
          })
          .join("");
        const textWidth = panel.width - 64 - results.length * TILE_STEP - 8;
        const box = { width: textWidth, maxLines: 1, direction: lang.dir, language: lang.tag } as const;
        const x = panel.start(32, textWidth);
        const title = await context.text.fit(
          row.title,
          [25, 22, 20].map((size) => ({
            stack: row.mono ? ("mono" as const) : ("medium" as const),
            size,
            fill: INK,
            lineHeight: 30,
          })),
          { ...box, x, y: y + 40 },
        );
        const caption = await context.text.fit(row.caption, labelStyles([16, 14], INK_3), {
          ...box,
          x,
          y: y + 66,
        });
        const divider =
          i < rows.length - 1 ? hline(panel.x + 32, panel.x + panel.width - 32, y + ROW_HEIGHT) : "";
        return title.svg + caption.svg + tiles + divider;
      }),
    );
    return parts.join("");
  });
}
