import { join } from "node:path";
import {
  Action,
  ActionPanel,
  environment,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import type { PackLocale } from "emojisense";
import { useCallback, useEffect, useMemo } from "react";
import { type EmojiItem, toEmojiItem } from "./lib/format";
import { chooseLanguages, SYSTEM_LANGUAGE, systemLanguages } from "./lib/languages";
import { bundledLocales, getEngine } from "./lib/packs";
import { createApiProvider } from "./lib/semantic";
import { type LoadedEngine, useEmojiSearch } from "./lib/use-emoji-search";

/** Mirrors the `preferences` in package.json. */
interface SearchPreferences {
  locale?: typeof SYSTEM_LANGUAGE | PackLocale;
  primaryAction?: "paste" | "copy";
  apiUrl?: string;
  apiKey?: string;
}

/** The engine with the packs of the user's languages only, and the language to prefer. */
function loadEngine(preference: string): LoadedEngine {
  const dir = join(environment.assetsPath, "packs");
  const { locale, locales } = chooseLanguages(preference, systemLanguages(), bundledLocales(dir));
  return { engine: getEngine(dir, locales), locale };
}

export default function SearchEmoji() {
  const {
    locale: preference = SYSTEM_LANGUAGE,
    primaryAction = "paste",
    apiUrl,
    apiKey,
  } = getPreferenceValues<SearchPreferences>();
  const api = useMemo(() => createApiProvider({ apiUrl, apiKey }), [apiUrl, apiKey]);
  const load = useCallback(() => loadEngine(preference), [preference]);
  const { loaded, state, error, isLoading, search } = useEmojiSearch({
    loadEngine: load,
    semantic: api.provider,
  });

  useEffect(() => {
    if (api.warning) {
      void showToast({ style: Toast.Style.Failure, title: "Emojisense API not used", message: api.warning });
    }
  }, [api.warning]);

  // An API result for an id these packs do not know has nothing to show; drop it.
  const items =
    loaded && state
      ? state.results
          .map((result) => toEmojiItem(loaded.engine, result, loaded.locale))
          .filter((item) => item.emoji)
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
          description="Words, slang or intent work: “jurassic park”, “lgtm”, “to the moon”."
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
        shortcut={Keyboard.Shortcut.Common.Copy}
      />
    </ActionPanel>
  );
}
