import { useEffect, useMemo, useState } from "@wordpress/element";
import { allowContext, createItemSearch, MAX_OPTIONS, TRIGGER } from "../lib/completer";
import { semanticProvider } from "../lib/engine";

/**
 * Rows for the autocomplete list. `useItems` replaces the default filtering of
 * @wordpress/components, which keeps only options whose keywords contain the typed text: meaning
 * results ("ship it" → 🚀) would never pass it.
 *
 * @param {import("../lib/engine").EngineLoader} loader
 * @param {import("../lib/config").ClientConfig} config
 */
function createUseItems(loader, config) {
  return function useItems(filterValue) {
    const [engine, setEngine] = useState(loader.current);
    const [items, setItems] = useState([]);

    useEffect(() => {
      const unsubscribe = loader.subscribe(setEngine);
      loader.load().then(setEngine, () => {
        // The packs did not load: the completer stays silent, typing is unaffected.
      });
      return unsubscribe;
    }, []);

    const search = useMemo(() => {
      if (!engine) return undefined;
      return createItemSearch({
        engine,
        locale: config.locale,
        semantic: semanticProvider(config, engine.packVersion),
        limit: MAX_OPTIONS,
        onItems: (next) => setItems(next),
      });
    }, [engine]);

    useEffect(() => () => search?.dispose(), [search]);

    useEffect(() => {
      if (search) search.update(filterValue);
      else setItems([]);
    }, [search, filterValue]);

    return [items.map((item) => toKeyedOption(item))];
  };
}

function OptionLabel({ item }) {
  return (
    <span className="emojisense-option">
      <span className="emojisense-option__emoji" aria-hidden="true">
        {item.emoji}
      </span>
      <span className="emojisense-option__label">{item.label || item.emoji}</span>
      {item.context ? <span className="emojisense-option__context">{item.context}</span> : null}
    </span>
  );
}

function toKeyedOption(item) {
  return {
    key: `emojisense-${item.id}-${item.emoji}`,
    value: item,
    label: <OptionLabel item={item} />,
    keywords: [item.label],
    isDisabled: false,
  };
}

/**
 * The `:` completer for every rich text field of the block editor.
 *
 * @param {import("../lib/engine").EngineLoader} loader
 * @param {import("../lib/config").ClientConfig} config
 */
export function createEmojiCompleter(loader, config) {
  return {
    name: "emojisense",
    className: "emojisense-autocomplete",
    triggerPrefix: TRIGGER,
    // Unused: useItems produces the rows. Kept for code that reads `options` directly.
    options: [],
    useItems: createUseItems(loader, config),
    getOptionLabel: (item) => <OptionLabel item={item} />,
    getOptionKeywords: (item) => [item.label],
    getOptionCompletion: (item) => item.emoji,
    allowContext,
    isDebounced: false,
  };
}
