/**
 * The frame of the landing cards: brand, a headline with a sub line and a footnote on one side,
 * a white preview panel on the other. Right-to-left languages mirror it.
 */
import type { CardContext, CardLanguage, PanelHeader } from "../cards";
import { background, hline, INK, INK_3, LINE, mark, rect, svgDocument, WIDTH } from "../svg";
import { renderHeading } from "./heading";

export const PANEL = { y: 64, width: 504, height: 502, header: 72 } as const;
const COLUMN_WIDTH = 528;
const MARGIN = 72;
/** The text block centers on this line, where the original English cards had it. */
const TEXT_CENTER = 358;

export interface Panel {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Left x of a box `width` wide, `inset` px from the panel's start edge (left in LTR, right in RTL). */
  start(inset: number, width?: number): number;
  /** Left x of a box `width` wide, `inset` px from the panel's end edge. */
  end(inset: number, width?: number): number;
  rtl: boolean;
}

export function panelFor(lang: CardLanguage): Panel {
  const rtl = lang.dir === "rtl";
  const x = rtl ? 64 : WIDTH - 64 - PANEL.width;
  const fromLeft = (inset: number) => x + inset;
  const fromRight = (inset: number, width = 0) => x + PANEL.width - inset - width;
  return {
    x,
    y: PANEL.y,
    width: PANEL.width,
    height: PANEL.height,
    rtl,
    start: rtl ? fromRight : fromLeft,
    end: rtl ? fromLeft : fromRight,
  };
}

/** The brand at the top of the reading side: the mark and the wordmark. */
export async function brand(context: CardContext, lang: CardLanguage): Promise<string> {
  const rtl = lang.dir === "rtl";
  const markX = rtl ? WIDTH - MARGIN - 44 : MARGIN;
  const word = await context.text.block(
    "emojisense",
    { stack: "display", size: 31, fill: INK, lineHeight: 31, tracking: -1.1 },
    rtl
      ? { x: markX - 12 - 400, y: 98, width: 400, maxLines: 1, direction: "ltr", align: "end" }
      : { x: markX + 56, y: 98, width: 400, maxLines: 1, direction: "ltr" },
  );
  return mark(markX, 64, 44) + word.svg;
}

export async function renderFrame(
  context: CardContext,
  card: { lang: CardLanguage; headline: string; sub: string; footnote: string; panel: PanelHeader },
  body: (panel: Panel) => Promise<string>,
): Promise<string> {
  const { lang } = card;
  const rtl = lang.dir === "rtl";
  const columnX = rtl ? WIDTH - MARGIN - COLUMN_WIDTH : MARGIN;
  const box = { x: columnX, y: 0, width: COLUMN_WIDTH, direction: lang.dir, language: lang.tag } as const;

  const heading = await renderHeading(context, {
    lang,
    title: card.headline,
    text: card.sub,
    x: columnX,
    width: COLUMN_WIDTH,
    titleSizes: [80, 72, 64, 56, 48],
    textSizes: [27, 24, 22],
    maxTitleLines: 3,
    top: 150,
    bottom: 528,
    center: TEXT_CENTER,
  });
  const footnote = await context.text.fit(card.footnote, labelStyles([18, 16, 14], INK_3), {
    ...box,
    y: 566,
    maxLines: 1,
  });

  const panel = panelFor(lang);
  const header = await panelHeader(context, lang, panel, card.panel);
  return svgDocument(
    [
      background(rtl ? 0.22 : 0.78),
      await brand(context, lang),
      heading,
      footnote.svg,
      rect(panel.x, panel.y, panel.width, panel.height, {
        radius: 28,
        fill: "#fff",
        stroke: LINE,
        filter: "shadow",
      }),
      header,
      await body(panel),
    ].join(""),
  );
}

/** Mono labels that step down in size rather than end in "…". */
export function labelStyles(sizes: readonly number[], fill: string) {
  return sizes.map((size) => ({ stack: "mono" as const, size, fill, lineHeight: size * 1.3 }));
}

async function panelHeader(
  context: CardContext,
  lang: CardLanguage,
  panel: Panel,
  header: PanelHeader,
): Promise<string> {
  const y = panel.y + 44;
  const styles = labelStyles([17, 15, 13], INK_3);
  const inner = panel.width - 64;
  // The end label keeps its natural width (up to half); the start label takes the rest.
  const endWidth = header.end
    ? Math.min(
        inner / 2,
        Math.ceil(await context.text.measure(header.end, styles[0] as (typeof styles)[0], lang.tag)),
      )
    : 0;
  const startWidth = inner - endWidth - (header.end ? 16 : 0);
  const line = { y, maxLines: 1, direction: lang.dir, language: lang.tag } as const;
  const start = await context.text.fit(header.start, styles, {
    ...line,
    x: panel.start(32, startWidth),
    width: startWidth,
  });
  const end = header.end
    ? await context.text.fit(header.end, styles, {
        ...line,
        x: panel.end(32, endWidth),
        width: endWidth,
        align: "end",
      })
    : undefined;
  return start.svg + (end?.svg ?? "") + hline(panel.x, panel.x + panel.width, panel.y + PANEL.header);
}
