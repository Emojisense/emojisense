import { type EmojiSet, emojiImageUrl } from "emojisense";
import { type ComponentProps, useState } from "react";

export interface EmojiGlyphProps extends Omit<ComponentProps<"img">, "src" | "alt" | "children"> {
  /** The emoji to draw, skin tone included; `:shortcode:` for a custom emoji. */
  emoji: string;
  /** A custom emoji's image (`SearchResult.imageUrl`). It wins over the emoji set. */
  imageUrl?: string | undefined;
  /** Default "native": the emoji as text. */
  emojiSet?: EmojiSet | undefined;
  /** API base URL that hosts the sets. Without it the emoji is drawn as text. */
  endpoint?: string | undefined;
}

/**
 * An emoji as text, or as an image: a custom emoji's `imageUrl`
 * (`<img src="{imageUrl}" alt=":shortcode:">`), or a hosted set
 * (`<img src="{endpoint}/v1/sets/{set}/{hexcode}.svg" alt="{emoji}">`). The image is 1em square,
 * so it follows the font size. When it fails to load (a set may not draw every emoji, e.g.
 * Fluent has no country flags), the text takes its place.
 */
export function EmojiGlyph({
  emoji,
  imageUrl,
  emojiSet,
  endpoint,
  style,
  onError,
  ...rest
}: EmojiGlyphProps) {
  const src = imageUrl ?? emojiImageUrl(emoji, { emojiSet, endpoint });
  const [failedSrc, setFailedSrc] = useState<string>();
  if (!src || src === failedSrc) return <>{emoji}</>;
  return (
    <img
      {...rest}
      src={src}
      alt={emoji}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-emojisense-image=""
      {...(imageUrl ? { "data-emojisense-custom": "" } : {})}
      style={{
        inlineSize: "1em",
        blockSize: "1em",
        objectFit: "contain",
        verticalAlign: "-0.125em",
        ...style,
      }}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
