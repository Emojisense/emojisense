import { useId } from "react";
import { CULTURE_KINDS, type CultureKind, type EntryForm, formLocales, glyphOf } from "../../lib/cultureForm";
import { Icon } from "../../ui/Icon";

const LOCALE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

const KIND_HINT: Record<CultureKind, string> = {
  lasting: "Always on: slang and lasting meanings.",
  seasonal: "Every year in a window (MM-DD), e.g. Halloween.",
  event: "Dated days (YYYY-MM-DD), at most 60: a final, a festival this year.",
  regional: "A word whose main sense differs by region. May lead in its regions.",
};

interface EntryEditorProps {
  form: EntryForm;
  readOnly: boolean;
  onChange: (form: EntryForm) => void;
}

/** The fields of a culture entry. Every change updates the live preview. */
export function EntryEditor({ form, readOnly, onChange }: EntryEditorProps) {
  const id = useId();
  const set = <K extends keyof EntryForm>(key: K, value: EntryForm[K]) => onChange({ ...form, [key]: value });
  const locales = formLocales(form);
  const contextLocales = ["en", ...locales.filter((l) => l !== "en")];
  const always = form.kind === "lasting" || form.kind === "regional";

  return (
    <fieldset className="form culture-form" disabled={readOnly}>
      <legend className="visually-hidden">Entry</legend>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor={`${id}-id`}>
            Id
          </label>
          <input
            id={`${id}-id`}
            className="input input-mono"
            value={form.id}
            spellCheck={false}
            onChange={(event) => set("id", event.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${id}-kind`}>
            Kind
          </label>
          <select
            id={`${id}-kind`}
            className="input"
            value={form.kind}
            aria-describedby={`${id}-kind-hint`}
            onChange={(event) => set("kind", event.target.value as CultureKind)}
          >
            {CULTURE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <p id={`${id}-kind-hint`} className="hint">
            {KIND_HINT[form.kind]}
          </p>
        </div>
      </div>

      {!always && (
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor={`${id}-from`}>
              From
            </label>
            <input
              id={`${id}-from`}
              className="input input-mono"
              value={form.from}
              placeholder={form.yearly ? "MM-DD" : "YYYY-MM-DD"}
              onChange={(event) => set("from", event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-to`}>
              To
            </label>
            <input
              id={`${id}-to`}
              className="input input-mono"
              value={form.to}
              placeholder={form.yearly ? "MM-DD" : "YYYY-MM-DD"}
              onChange={(event) => set("to", event.target.value)}
            />
          </div>
          <label className="check culture-check">
            <input
              type="checkbox"
              checked={form.yearly}
              onChange={(event) => set("yearly", event.target.checked)}
            />
            <span className="check-text">Every year</span>
          </label>
          <label className="check culture-check">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(event) => set("featured", event.target.checked)}
            />
            <span className="check-text">On the “relevant now” shelf</span>
          </label>
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor={`${id}-regions`}>
            Regions
          </label>
          <input
            id={`${id}-regions`}
            className="input input-mono"
            value={form.regions}
            placeholder="* or US, GB"
            aria-describedby={`${id}-regions-hint`}
            onChange={(event) => set("regions", event.target.value)}
          />
          <p id={`${id}-regions-hint`} className="hint">
            ISO codes, comma-separated, or * for everywhere.
          </p>
        </div>
        <div className="field">
          <label className="label" htmlFor={`${id}-except`}>
            Except regions <span className="label-optional">with *</span>
          </label>
          <input
            id={`${id}-except`}
            className="input input-mono"
            value={form.exceptRegions}
            onChange={(event) => set("exceptRegions", event.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${id}-locales`}>
            Languages
          </label>
          <input
            id={`${id}-locales`}
            className="input input-mono"
            value={form.locales}
            placeholder="en, es or *"
            onChange={(event) => set("locales", event.target.value)}
          />
        </div>
      </div>

      {form.kind === "regional" && (
        <div className="field">
          <label className="label" htmlFor={`${id}-outranks`}>
            May move down
          </label>
          <input
            id={`${id}-outranks`}
            className="input input-mono"
            value={form.outranks}
            placeholder="1F3C8"
            onChange={(event) => set("outranks", event.target.value)}
          />
          <p className="hint">Hexcodes of the canonical answers this regional sense may put second.</p>
        </div>
      )}

      <div className="field">
        <span className="label" id={`${id}-emoji`}>
          Emoji <span className="label-optional">strongest first, weight 0–1</span>
        </span>
        <ul className="culture-emoji" aria-labelledby={`${id}-emoji`}>
          {form.emoji.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional while editing
            <li key={index} className="culture-emoji-row">
              <span className="culture-emoji-glyph emoji" aria-hidden="true">
                {glyphOf(item.hexcode) || "?"}
              </span>
              <input
                className="input input-mono"
                aria-label={`Hexcode ${index + 1}`}
                value={item.hexcode}
                spellCheck={false}
                onChange={(event) =>
                  set(
                    "emoji",
                    form.emoji.map((e, i) => (i === index ? { ...e, hexcode: event.target.value } : e)),
                  )
                }
              />
              <input
                className="input input-mono culture-weight"
                aria-label={`Weight ${index + 1}`}
                type="number"
                min="0.05"
                max="1"
                step="0.05"
                value={item.weight}
                onChange={(event) =>
                  set(
                    "emoji",
                    form.emoji.map((e, i) => (i === index ? { ...e, weight: event.target.value } : e)),
                  )
                }
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label={`Remove emoji ${index + 1}`}
                onClick={() =>
                  set(
                    "emoji",
                    form.emoji.filter((_, i) => i !== index),
                  )
                }
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
        {form.emoji.length < 6 && (
          <button
            type="button"
            className="btn btn-sm culture-add"
            onClick={() => set("emoji", [...form.emoji, { hexcode: "", weight: "0.5" }])}
          >
            <Icon name="plus" />
            Add emoji
          </button>
        )}
      </div>

      <div className="culture-locales">
        {contextLocales.map((locale) => {
          const name = LOCALE_NAMES.of(locale) ?? locale;
          const targeted = locales.includes(locale);
          return (
            <div key={locale} className="culture-locale">
              <p className="section-label">
                {name} <span className="mono">{locale}</span>
              </p>
              <div className="field">
                <label className="label" htmlFor={`${id}-context-${locale}`}>
                  Context
                </label>
                <input
                  id={`${id}-context-${locale}`}
                  className="input"
                  value={form.context[locale] ?? ""}
                  maxLength={90}
                  onChange={(event) => set("context", { ...form.context, [locale]: event.target.value })}
                />
              </div>
              {targeted && (
                <div className="field">
                  <label className="label" htmlFor={`${id}-triggers-${locale}`}>
                    Triggers <span className="label-optional">one per line</span>
                  </label>
                  <textarea
                    id={`${id}-triggers-${locale}`}
                    className="input input-mono"
                    rows={3}
                    value={form.triggers[locale] ?? ""}
                    spellCheck={false}
                    onChange={(event) => set("triggers", { ...form.triggers, [locale]: event.target.value })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
