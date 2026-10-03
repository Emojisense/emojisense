/** Pricing card: one row per listed plan with its emoji, monthly AI calls and price. */
import { type CardContext, displayStyle, type PricingCard } from "../cards";
import { hline, INK, INK_2, INK_3, tile } from "../svg";
import { PANEL, renderFrame } from "./frame";

/** Each row's content is this tall and sits in the middle of its share of the panel. */
const ROW_CONTENT = 107;
const PER_WIDTH = 160;

export function renderPricing(context: CardContext, card: PricingCard): Promise<string> {
  const { lang } = card;
  return renderFrame(context, card, async (panel) => {
    const rowHeight = (panel.height - PANEL.header) / Math.max(card.plans.length, 1);
    const box = { maxLines: 1, direction: lang.dir, language: lang.tag } as const;
    const parts = await Promise.all(
      card.plans.map(async (plan, i) => {
        const top = panel.y + PANEL.header + i * rowHeight;
        const y = top + (rowHeight - ROW_CONTENT) / 2;
        const priceStyle = { ...displayStyle(lang, 42, INK), tracking: -1.6 };
        const priceWidth = Math.ceil(await context.text.measure(plan.price, priceStyle, lang.tag));
        // The price at the row's end edge with its unit under it; name and detail take the rest.
        const textWidth = panel.width - 112 - 32 - priceWidth - 20;
        const textX = panel.start(112, textWidth);
        const name = await context.text.block(
          plan.name,
          { ...displayStyle(lang, 28, INK), tracking: -0.6 },
          { ...box, x: textX, y: y + 52, width: textWidth },
        );
        const detail = await context.text.fit(
          plan.detail,
          [18, 16, 15, 14, 13].map((size) => ({
            stack: "body" as const,
            size,
            fill: INK_2,
            lineHeight: size * 1.3,
          })),
          { ...box, x: textX, y: y + 80, width: textWidth },
        );
        const price = await context.text.block(plan.price, priceStyle, {
          ...box,
          x: panel.end(32, priceWidth),
          y: y + 62,
          width: priceWidth,
        });
        const per = await context.text.block(
          plan.per,
          { stack: "body", size: 16, fill: INK_3, lineHeight: 20 },
          { ...box, x: panel.end(32, PER_WIDTH), y: y + 86, width: PER_WIDTH, align: "end" },
        );
        const divider =
          i < card.plans.length - 1 ? hline(panel.x + 32, panel.x + panel.width - 32, top + rowHeight) : "";
        const icon = tile(panel.start(32, 60), y + 24, await context.emoji(plan.emoji, 34), {
          size: 60,
          glyphSize: 34,
        });
        return icon + name.svg + detail.svg + price.svg + per.svg + divider;
      }),
    );
    return parts.join("");
  });
}
