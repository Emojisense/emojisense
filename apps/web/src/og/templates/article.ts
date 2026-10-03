/**
 * Card for a page of text (docs, legal, about, changelog …): eyebrow, title, description and
 * chips on the reading side; the page's emoji or integration logo in a large tile on the other.
 */
import type { ArticleArt, ArticleCard, CardContext } from "../cards";
import { BG_SOFT, background, emojiImage, INK, INK_2, INK_3, LINE, rect, svgDocument, WIDTH } from "../svg";
import { brand } from "./frame";
import { renderHeading } from "./heading";

const MARGIN = 72;
const COLUMN_WIDTH = 744;
const ART = { size: 248, y: 172, radius: 64 } as const;
const TEXT_CENTER = 330;
const CHIP = { height: 36, padding: 16, gap: 10, y: 536 } as const;

export async function renderArticle(context: CardContext, card: ArticleCard): Promise<string> {
  const { lang } = card;
  const rtl = lang.dir === "rtl";
  const columnX = rtl ? WIDTH - MARGIN - COLUMN_WIDTH : MARGIN;
  const artX = rtl ? MARGIN : WIDTH - MARGIN - ART.size;
  const box = { x: columnX, y: 0, width: COLUMN_WIDTH, direction: lang.dir, language: lang.tag } as const;

  const eyebrow = await context.text.block(
    card.eyebrow,
    { stack: "mono", size: 18, fill: INK_3, lineHeight: 24 },
    { ...box, x: rtl ? MARGIN : WIDTH - MARGIN - 560, y: 96, width: 560, maxLines: 1, align: "end" },
  );
  const heading = await renderHeading(context, {
    lang,
    title: card.title,
    text: card.description,
    x: columnX,
    width: COLUMN_WIDTH,
    titleSizes: [76, 68, 60, 52, 44],
    textSizes: [28, 25, 23],
    maxTitleLines: 3,
    top: 150,
    bottom: 512,
    center: TEXT_CENTER,
  });

  const url = await context.text.block(
    card.url,
    { stack: "mono", size: 18, fill: INK_3, lineHeight: 24 },
    {
      ...box,
      x: rtl ? MARGIN : WIDTH - MARGIN - 520,
      y: 566,
      width: 520,
      maxLines: 1,
      direction: "ltr",
      align: rtl ? "start" : "end",
    },
  );

  return svgDocument(
    [
      background(rtl ? 0.22 : 0.78),
      await brand(context, lang),
      eyebrow.svg,
      heading,
      await chips(context, card),
      url.svg,
      rect(artX, ART.y, ART.size, ART.size, { radius: ART.radius, fill: BG_SOFT, stroke: LINE }),
      await art(context, card.art, artX + ART.size / 2, ART.y + ART.size / 2),
    ].join(""),
  );
}

async function chips(context: CardContext, card: ArticleCard): Promise<string> {
  const rtl = card.lang.dir === "rtl";
  const style = { stack: "mono", size: 16, fill: INK_2, lineHeight: 20 } as const;
  let offset = MARGIN;
  let svg = "";
  for (const label of card.chips) {
    const textWidth = await context.text.measure(label, style, card.lang.tag);
    const width = Math.ceil(textWidth + CHIP.padding * 2);
    const x = rtl ? WIDTH - offset - width : offset;
    const text = await context.text.block(label, style, {
      x: x + CHIP.padding,
      y: CHIP.y + 24,
      width: textWidth + 1,
      maxLines: 1,
      direction: card.lang.dir,
      language: card.lang.tag,
    });
    svg +=
      rect(x, CHIP.y, width, CHIP.height, { radius: CHIP.height / 2, fill: BG_SOFT, stroke: LINE }) +
      text.svg;
    offset += width + CHIP.gap;
  }
  return svg;
}

async function art(context: CardContext, value: ArticleArt, cx: number, cy: number): Promise<string> {
  if ("emoji" in value) return emojiImage(await context.emoji(value.emoji, 150), cx, cy, 150);
  if ("logo" in value) {
    const [minX = 0, minY = 0, width = 24, height = 24] = value.logo.viewBox.split(/[\s,]+/).map(Number);
    const k = 128 / Math.max(width, height);
    const x = cx - (width * k) / 2 - minX * k;
    const y = cy - (height * k) / 2 - minY * k;
    return `<path transform="translate(${x} ${y}) scale(${k})" fill="${INK}" d="${value.logo.path}"/>`;
  }
  const word = await context.text.fit(
    value.wordmark,
    [44, 38, 32, 28].map((size) => ({
      stack: "display" as const,
      size,
      fill: INK,
      lineHeight: size,
      tracking: -0.03 * size,
    })),
    { x: cx - ART.size / 2 + 20, y: 0, width: ART.size - 40, maxLines: 1, direction: "ltr", align: "center" },
  );
  return `<g transform="translate(0 ${cy + word.style.size * 0.35})">${word.svg}</g>`;
}
