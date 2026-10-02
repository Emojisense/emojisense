import { RichTextToolbarButton } from "@wordpress/block-editor";
import { Popover } from "@wordpress/components";
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { insert, useAnchor } from "@wordpress/rich-text";
import { EmojiPicker } from "./picker";

export const FORMAT_NAME = "emojisense/emoji";

/** A calm, single-color smiley in a keycap, like the plugin icon. */
export const emojiIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width="24"
    height="24"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10S2 17.52 2 12Zm6.5-1.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Zm4.5 0a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0ZM8.1 14.2a.75.75 0 0 1 1.04.2 3.4 3.4 0 0 0 5.72 0 .75.75 0 1 1 1.24.84 4.9 4.9 0 0 1-8.2 0 .75.75 0 0 1 .2-1.04Z" />
  </svg>
);

/**
 * The toolbar button of rich text fields ("More" menu) and its picker popover. The format is
 * never applied to text: it only provides the button.
 *
 * @param {import("../lib/config").ClientConfig} config
 */
export function createEmojiFormat(config) {
  function Edit({ value, onChange, contentRef }) {
    const [isOpen, setIsOpen] = useState(false);
    const anchor = useAnchor({ editableContentElement: contentRef.current });
    const close = () => {
      setIsOpen(false);
      contentRef.current?.focus();
    };
    const choose = (emoji) => {
      onChange(insert(value, emoji));
      close();
    };
    return (
      <>
        <RichTextToolbarButton
          icon={emojiIcon}
          title={__("Emoji", "emojisense")}
          onClick={() => setIsOpen((open) => !open)}
          isActive={isOpen}
        />
        {isOpen ? (
          <Popover
            anchor={anchor}
            placement="bottom-start"
            className="emojisense-popover"
            focusOnMount={false}
            onClose={close}
            aria-label={__("Emoji picker", "emojisense")}
          >
            <EmojiPicker
              config={config}
              placeholder={__("Search emoji by meaning…", "emojisense")}
              onSelect={choose}
              onEscape={close}
            />
          </Popover>
        ) : null}
      </>
    );
  }

  return {
    title: __("Emoji", "emojisense"),
    tagName: "span",
    className: "emojisense-emoji-button",
    interactive: false,
    edit: Edit,
  };
}
