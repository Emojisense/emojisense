import { join } from "node:path";
import {
  Action,
  ActionPanel,
  environment,
  getPreferenceValues,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useMemo } from "react";
import { type EmojiItem, toEmojiItem } from "./lib/format";
import { getEngine } from "./lib/packs";
import { createApiProvider } from "./lib/semantic";
import { useEmojiSearch } from "./lib/use-emoji-search";

/** Mirrors the `preferences` in package.json. */
interface SearchPreferences {
  locale?: "en" | "tr";
  primaryAction?: "paste" | "copy";
  apiUrl?: string;
  apiKey?: string;
}

const loadEngine = () => getEngine(join(environment.assetsPath, "packs"));

export default function SearchEmoji() {
  const { locale = "en", primaryAction = "paste", apiUrl, apiKey } = getPreferenceValues<SearchPreferences>();
  const api = useMemo(() => createApiProvider({ apiUrl, apiKey }), [apiUrl, apiKey]);
  const { engine, state, error, isLoading, search } = useEmojiSearch({
    loadEngine,
    semantic: api.provider,
    locale,
  });

  useEffect(() => {
    if (api.warning) {
      void showToast({ style: Toast.Style.Failure, title: "Emojisense API not used", message: api.warning });
    }
  }, [api.warning]);

  // An API result for an id these packs do not know has nothing to show; drop it.
  const items =
    engine && state
      ? state.results.map((result) => toEmojiItem(engine, result, locale)).filter((item) => item.emoji)
      : [];

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      onSearchTextChange={search}
      searchBarPlaceholder="Search by meaning: ship it, lgtm, greatest of all time…"
    >
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Could not load the emoji data"
          description={error instanceof Error ? error.message : String(error)}
        />
      ) : (
        <List.EmptyView
          icon="🔎"
          title={state?.query.trim() ? "No emoji found" : "Type what you mean"}
          description="Words, slang or intent work: “jurassic park”, “lgtm”, “kolay gelsin”."
        />
      )}
      {items.map((item) => (
        <List.Item
          key={item.key}
          icon={item.emoji}
          title={item.title}
          subtitle={item.subtitle}
          accessories={[{ tag: item.kind }]}
          actions={<EmojiActions item={item} primaryAction={primaryAction} />}
        />
      ))}
    </List>
  );
}

function EmojiActions({ item, primaryAction }: { item: EmojiItem; primaryAction: "paste" | "copy" }) {
  const paste = <Action.Paste key="paste" title="Paste Emoji" content={item.emoji} />;
  const copy = <Action.CopyToClipboard key="copy" title="Copy Emoji" content={item.emoji} />;
  return (
    <ActionPanel title={`${item.emoji} ${item.title}`}>
      {primaryAction === "copy" ? [copy, paste] : [paste, copy]}
      <Action.CopyToClipboard
        title="Copy Hexcode"
        content={item.hexcode}
        shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
      />
    </ActionPanel>
  );
}
