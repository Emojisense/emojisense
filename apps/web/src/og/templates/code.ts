/** Docs card: a short code sample and the emoji it returns. */
import type { CardContext, CodeCard, CodeTone } from "../cards";
import { BG_SOFT, BG_SUNK, INK, INK_2, INK_3, tile } from "../svg";
import { renderFrame } from "./frame";

const TONES: Record<CodeTone, string> = { ink: INK, ink2: INK_2, ink3: INK_3 };
const CODE_SIZE = 17.5;
const FIRST_LINE = 120;
const LINE_STEP = 34;

export function renderCode(context: CardContext, card: CodeCard): Promise<string> {
  return renderFrame(context, { ...card, lang: { tag: "en", dir: "ltr" } }, async (panel) => {
    const x = panel.x + 32;
    let svg = "";
    let y = panel.y + FIRST_LINE;
    for (const line of card.code) {
      let cursor = x;
      for (const [token, tone] of line) {
        const style = { stack: "mono", size: CODE_SIZE, fill: TONES[tone], lineHeight: 24 } as const;
        const block = await context.text.block(token, style, {
          x: cursor,
          y,
          width: panel.width,
          maxLines: 1,
          direction: "ltr",
        });
        svg += block.svg;
        // A block drops trailing spaces; the next token starts after them.
        cursor += await context.text.measure(token, style);
      }
      y += line.length === 0 ? LINE_STEP * 0.75 : LINE_STEP;
    }
    const tilesY = y + 6;
    const hrefs = await Promise.all(card.results.slice(0, 3).map((emoji) => context.emoji(emoji, 46)));
    svg += hrefs
      .map((href, j) =>
        tile(x + j * 92, tilesY, href, { size: 80, glyphSize: 46, fill: j === 0 ? BG_SUNK : BG_SOFT }),
      )
      .join("");
    const note = await context.text.block(
      card.note,
      { stack: "mono", size: 17, fill: INK_3, lineHeight: 22 },
      { x, y: tilesY + 128, width: panel.width - 64, maxLines: 1, direction: "ltr" },
    );
    return svg + note.svg;
  });
}
