/** A display title over a paragraph, sized to fit a vertical band and centered in it. */
import { type CardContext, type CardLanguage, displayStyle, leading } from "../cards";
import { INK, INK_2 } from "../svg";
import type { TextBlock } from "../text/layout";

export interface HeadingSpec {
  lang: CardLanguage;
  title: string;
  text: string;
  x: number;
  width: number;
  /** Title sizes to try, largest first. */
  titleSizes: readonly number[];
  textSizes: readonly number[];
  maxTitleLines: number;
  /** The band the block must fit: top of the title's capitals to the paragraph's last descender. */
  top: number;
  bottom: number;
  /** Where the block centers when it is shorter than the band. */
  center: number;
}

/** Capitals and descenders, as a share of the font size (enough for every script used). */
const ASCENT = 0.72;
const DESCENT = 0.28;
const TITLE_GAP = 0.8;

export async function renderHeading(context: CardContext, spec: HeadingSpec): Promise<string> {
  const { lang } = spec;
  const box = { x: spec.x, y: 0, width: spec.width, direction: lang.dir, language: lang.tag } as const;
  const textStyles = spec.textSizes.map((size) => ({
    stack: "body" as const,
    size,
    fill: INK_2,
    lineHeight: size * leading(lang, 1.4),
  }));

  let layout: { title: TextBlock; text: TextBlock; height: number; gap: number } | undefined;
  for (const [i, size] of spec.titleSizes.entries()) {
    const last = i === spec.titleSizes.length - 1;
    const title = await context.text.block(
      spec.title,
      displayStyle(lang, size, INK),
      { ...box, maxLines: spec.maxTitleLines, balance: true },
      last,
    );
    if (title.truncated && !last) continue;
    const text = await context.text.fit(spec.text, textStyles, { ...box, maxLines: 3 });
    const gap = TITLE_GAP * title.style.lineHeight;
    const height =
      ASCENT * size +
      (title.lines - 1) * title.style.lineHeight +
      gap +
      (text.lines - 1) * text.style.lineHeight +
      DESCENT * text.style.size;
    layout = { title, text, height, gap };
    if (height <= spec.bottom - spec.top) break;
  }
  if (!layout) throw new Error("renderHeading needs at least one title size");

  const { title, text, height, gap } = layout;
  const ascent = ASCENT * title.style.size;
  const firstBaseline = Math.max(spec.top + ascent, spec.center - height / 2 + ascent);
  const textBaseline = firstBaseline + (title.lines - 1) * title.style.lineHeight + gap;
  const at = (block: TextBlock, y: number) =>
    `<g transform="translate(0 ${Math.round(y * 100) / 100})">${block.svg}</g>`;
  return at(title, firstBaseline) + at(text, textBaseline);
}
