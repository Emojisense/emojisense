import apiFetch from "@wordpress/api-fetch";
import { Button, Dropdown, Notice, Spinner } from "@wordpress/components";
import { useEntityProp } from "@wordpress/core-data";
import { useSelect } from "@wordpress/data";
import { store as editorStore, PluginDocumentSettingPanel } from "@wordpress/editor";
import { useState } from "@wordpress/element";
import { __, sprintf } from "@wordpress/i18n";
import { effectiveReactions, withoutReaction, withReaction } from "../lib/reactions";
import { EmojiPicker } from "./picker";

const SUGGESTED_META = "_emojisense_suggested";

/**
 * Document sidebar panel: the reactions this post offers. Authors can remove, add, ask the API
 * for suggestions (when the admin turned them on) or go back to the site defaults.
 *
 * @param {import("../lib/config").EditorConfig} config
 */
export function createReactionsPanel(config) {
  return function ReactionsPanel() {
    const { postType, postId, title, content } = useSelect((select) => {
      const editor = select(editorStore);
      return {
        postType: editor.getCurrentPostType(),
        postId: editor.getCurrentPostId(),
        title: editor.getEditedPostAttribute("title"),
        content: editor.getEditedPostAttribute("content"),
      };
    }, []);
    const [meta, setMeta] = useEntityProp("postType", postType, "meta");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    if (!postType || !config.reactionPostTypes.includes(postType)) return null;

    const chosen = meta?.[config.reactionSetMetaKey] ?? [];
    const suggested = meta?.[SUGGESTED_META] ?? [];
    const { list, source } = effectiveReactions(chosen, suggested, config.defaultReactions);
    const choose = (next) => setMeta({ ...meta, [config.reactionSetMetaKey]: next });

    const suggest = async () => {
      setBusy(true);
      setError("");
      try {
        const text = `${title ?? ""}\n${typeof content === "string" ? content : ""}`;
        const response = await apiFetch({
          path: "/emojisense/v1/suggest",
          method: "POST",
          data: { post_id: postId, text: text.slice(0, 20000) },
        });
        if (Array.isArray(response?.emoji) && response.emoji.length > 0) {
          choose(response.emoji.slice(0, config.maxReactions));
        } else {
          setError(__("The text gave no clear reactions. Keep the current ones or add some.", "emojisense"));
        }
      } catch (failure) {
        setError(failure?.message ?? __("Suggestions are not available right now.", "emojisense"));
      } finally {
        setBusy(false);
      }
    };

    const sourceText = {
      chosen: __("Chosen for this post.", "emojisense"),
      suggested: __("Suggested from the post text.", "emojisense"),
      defaults: __("The site’s default reactions.", "emojisense"),
    }[source];

    return (
      <PluginDocumentSettingPanel
        name="emojisense-reactions"
        title={__("Reactions", "emojisense")}
        className="emojisense-reactions-panel"
      >
        <p className="emojisense-reactions-panel__source">{sourceText}</p>
        <ul className="emojisense-reactions-panel__list">
          {list.map((emoji) => (
            <li key={emoji}>
              <Button
                className="emojisense-reactions-panel__chip"
                onClick={() => choose(withoutReaction(list, emoji))}
                label={sprintf(
                  /* translators: %s: an emoji. */
                  __("Remove %s", "emojisense"),
                  emoji,
                )}
                showTooltip
              >
                <span aria-hidden="true">{emoji}</span>
              </Button>
            </li>
          ))}
        </ul>
        <div className="emojisense-reactions-panel__actions">
          <Dropdown
            popoverProps={{ placement: "left-start", className: "emojisense-popover" }}
            renderToggle={({ isOpen, onToggle }) => (
              <Button
                variant="secondary"
                onClick={onToggle}
                aria-expanded={isOpen}
                disabled={list.length >= config.maxReactions}
              >
                {__("Add", "emojisense")}
              </Button>
            )}
            renderContent={({ onClose }) => (
              <EmojiPicker
                config={config}
                placeholder={__("Search emoji…", "emojisense")}
                onSelect={(emoji) => {
                  choose(withReaction(list, emoji, config.maxReactions));
                  onClose();
                }}
                onEscape={onClose}
              />
            )}
          />
          {config.suggestions ? (
            <Button variant="secondary" onClick={suggest} disabled={busy} aria-busy={busy}>
              {busy ? <Spinner /> : null}
              {__("Suggest from text", "emojisense")}
            </Button>
          ) : null}
          {source === "chosen" ? (
            <Button variant="tertiary" onClick={() => choose([])}>
              {__("Reset", "emojisense")}
            </Button>
          ) : null}
        </div>
        {error ? (
          <Notice status="warning" isDismissible onRemove={() => setError("")}>
            {error}
          </Notice>
        ) : null}
        {!config.suggestions && config.settingsUrl ? (
          <p className="emojisense-reactions-panel__hint">
            <a href={config.settingsUrl}>{__("Turn on reaction suggestions", "emojisense")}</a>
          </p>
        ) : null}
      </PluginDocumentSettingPanel>
    );
  };
}
