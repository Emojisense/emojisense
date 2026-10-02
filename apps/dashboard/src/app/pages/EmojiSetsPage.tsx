import { PLANS } from "@emojisense/platform";
import { useState } from "react";
import { api, EMOJI_SETS, type EmojiSet, errorMessage, isPlanRequired, type PlanId } from "../api";
import { API_URL } from "../lib/config";
import { PREVIEW_EMOJI, SET_INFO, setImageUrl } from "../lib/emojiSets";
import { FEATURE_PLAN, planIncludes } from "../lib/plans";
import { useAppDetail } from "../shell/context";
import { CodeBlock } from "../ui/CodeBlock";
import { PageHeader } from "../ui/PageHeader";
import { PlanGate } from "../ui/PlanGate";
import { useToast } from "../ui/Toast";

export function EmojiSetsPage() {
  const { app, setApp, readOnly } = useAppDetail();
  const toast = useToast();
  const current = app.emojiSet;
  const [selected, setSelected] = useState<EmojiSet>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiredPlan, setRequiredPlan] = useState<PlanId | null>(
    planIncludes(app.plan, "hosted_sets") ? null : FEATURE_PLAN.hosted_sets,
  );
  const changed = selected !== current;
  const example = selected === "native" ? "twemoji" : selected;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setApp(await api.updateApp(app.id, { emojiSet: selected }));
      toast(`${app.name} now shows ${SET_INFO[selected].name} emoji`);
    } catch (caught) {
      if (isPlanRequired(caught)) setRequiredPlan(caught.plan);
      else setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Emoji sets"
        documentTitle={`Emoji sets · ${app.name}`}
        lede="Choose the artwork your pickers show. A hosted set looks the same on every device."
      />
      <div className="stack-lg">
        {requiredPlan && <PlanGate feature="hosted_sets" plan={requiredPlan} compact />}

        <fieldset className="set-grid" disabled={readOnly}>
          <legend className="visually-hidden">Emoji set for {app.name}</legend>
          {EMOJI_SETS.map((set) => {
            const locked = set !== "native" && requiredPlan !== null;
            return (
              <label key={set} className="set-card" data-locked={locked || undefined}>
                <input
                  type="radio"
                  name="emoji-set"
                  value={set}
                  checked={selected === set}
                  disabled={locked}
                  onChange={() => setSelected(set)}
                />
                <span className="set-head">
                  <span className="set-name">{SET_INFO[set].name}</span>
                  {set === current && <span className="badge badge-solid">Current</span>}
                  {locked && requiredPlan && <span className="nav-lock">{PLANS[requiredPlan].name}</span>}
                </span>
                <span className="set-text">{SET_INFO[set].text}</span>
                <span className="set-preview" aria-hidden="true">
                  {PREVIEW_EMOJI.map((emoji) => (
                    <SetGlyph key={emoji} set={set} emoji={emoji} />
                  ))}
                </span>
                {SET_INFO[set].note && <span className="set-note">{SET_INFO[set].note}</span>}
                <span className="set-credit">{SET_INFO[set].credit}</span>
              </label>
            );
          })}
        </fieldset>

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}

        {changed && !readOnly && (
          <section className="save-bar" aria-label="Unsaved change">
            <p>
              Switch <strong>{app.name}</strong> from {SET_INFO[current].name} to {SET_INFO[selected].name}?
              Pickers pick it up on their next load.
            </p>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => setSelected(current)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? "Saving…" : `Use ${SET_INFO[selected].name}`}
              </button>
            </div>
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">How pickers load a hosted set</h2>
              <p className="card-sub">One immutable SVG per emoji, served from the edge cache.</p>
            </div>
          </div>
          <div className="card-body">
            <CodeBlock
              label="Hosted set URL"
              code={`import { emojiImageUrl } from "emojisense";

// Pickers take the same option: emojiSet: "${example}".
emojiImageUrl("🎉", { endpoint: "${API_URL}", emojiSet: "${example}" });
// → "${setImageUrl(example, "🎉")}"`}
            />
          </div>
        </section>
      </div>
    </>
  );
}

/** A hosted glyph, or the native one when the set has no image for it (a 404). */
function SetGlyph({ set, emoji }: { set: EmojiSet; emoji: string }) {
  const [failed, setFailed] = useState(false);
  const src = setImageUrl(set, emoji);
  if (!src || failed) return <span className="set-glyph emoji">{emoji}</span>;
  return (
    <img
      className="set-glyph"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
