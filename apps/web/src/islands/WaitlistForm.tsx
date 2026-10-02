import { parseWaitlistStatus } from "@emojisense/platform";
import { type SubmitEvent, useEffect, useId, useRef, useState } from "react";
import type { Messages } from "../i18n/catalogs";
import { rich, useTranslator } from "../i18n/react";
import {
  parsePlan,
  submitWaitlist,
  validateEmail,
  WAITLIST_PLANS,
  type WaitlistPlan,
  type WaitlistResult,
} from "../lib/waitlist";
import "./waitlist-form.css";

export interface WaitlistFormProps {
  endpoint: string;
  /** Name and price per plan, from PLANS. */
  plans: Record<WaitlistPlan, { name: string; price: string }>;
  initialPlan?: WaitlistPlan;
  /** The catalog's `waitlist` part, in the page's language. */
  messages: Messages["waitlist"];
  /** Intl tag of the page. */
  lang: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

type Phase =
  | { name: "editing"; fieldError?: string; formError?: string }
  | { name: "submitting" }
  /** `signup` is unknown after a form post that returned with `?status=ok`. */
  | { name: "joined"; signup?: { email: string; plan: WaitlistPlan }; alreadyJoined: boolean };

/** Both pages are in English only. */
const LINKS = { quickstart: "/docs/", privacy: "/legal/privacy/" };

export function WaitlistForm(props: WaitlistFormProps) {
  const { endpoint, plans, initialPlan = "pro", messages, lang } = props;
  const t = useTranslator(messages, lang);
  const errors = messages.errors;
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<WaitlistPlan>(initialPlan);
  const [phase, setPhase] = useState<Phase>({ name: "editing" });
  const [enhanced, setEnhanced] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  // Links to English-only pages say so on a translated page.
  const linkLang = lang === "en" ? undefined : "en";

  // The page is static, so the URL is read after hydration: ?plan= from the pricing page, and
  // ?status= when the form was posted before the script ran and the dashboard sent it back.
  useEffect(() => {
    setEnhanced(true);
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("plan");
    if (fromUrl) setPlan(parsePlan(fromUrl));
    const status = parseWaitlistStatus(params.get("status"));
    if (status === "ok") setPhase({ name: "joined", alreadyJoined: false });
    if (status === "error") {
      setPhase({
        name: "editing",
        formError: t.t("form.errorJoined", {
          title: t.t("returned.errorTitle"),
          text: t.t("returned.errorText"),
        }),
      });
    }
  }, [t]);

  useEffect(() => {
    if (phase.name === "joined") doneRef.current?.focus();
  }, [phase.name]);

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fieldError = validateEmail(email, errors);
    if (fieldError) {
      setPhase({ name: "editing", fieldError });
      emailRef.current?.focus();
      return;
    }
    setPhase({ name: "submitting" });
    const result: WaitlistResult = await submitWaitlist(
      { email, plan },
      { endpoint, errors, ...(props.fetch ? { fetch: props.fetch } : {}) },
    );
    if (result.ok) {
      setPhase({
        name: "joined",
        signup: { email: email.trim(), plan },
        alreadyJoined: result.alreadyJoined,
      });
    } else if (result.reason === "invalid") {
      setPhase({ name: "editing", fieldError: result.message });
      emailRef.current?.focus();
    } else {
      setPhase({ name: "editing", formError: result.message });
    }
  };

  if (phase.name === "joined") {
    return (
      <div className="wl-done" role="status">
        <span className="wl-done-ticket" aria-hidden="true">
          <span className="emoji">🎟️</span>
        </span>
        <h2 ref={doneRef} tabIndex={-1}>
          {phase.alreadyJoined ? t.t("form.alreadyJoined") : t.t("returned.okTitle")}
        </h2>
        {phase.signup ? (
          <p>
            {rich(
              t.raw("form.willEmail"),
              { strong: (text) => <strong>{text}</strong> },
              { email: phase.signup.email, plan: plans[phase.signup.plan].name },
            )}
          </p>
        ) : (
          <p>{t.t("returned.okText")}</p>
        )}
        <p>
          {rich(t.raw("form.untilThen"), {
            link: (text) => (
              <a href={LINKS.quickstart} hrefLang={linkLang}>
                {text}
              </a>
            ),
          })}
        </p>
      </div>
    );
  }

  const submitting = phase.name === "submitting";
  const fieldError = phase.name === "editing" ? phase.fieldError : undefined;
  const formError = phase.name === "editing" ? phase.formError : undefined;

  return (
    <form
      className="wl-form"
      // Without JavaScript the browser posts the form body (never the URL) to the same endpoint.
      action={endpoint}
      method="post"
      noValidate={enhanced}
      onSubmit={onSubmit}
      aria-busy={submitting}
      data-testid="waitlist-form"
    >
      <div className="wl-field">
        <label htmlFor={`${id}-email`}>{t.t("form.email")}</label>
        <input
          ref={emailRef}
          id={`${id}-email`}
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          inputMode="email"
          placeholder={t.t("form.emailPlaceholder")}
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${id}-email-error` : `${id}-email-hint`}
        />
        {fieldError ? (
          <p className="wl-error" id={`${id}-email-error`}>
            {fieldError}
          </p>
        ) : (
          <p className="wl-hint" id={`${id}-email-hint`}>
            {t.t("form.emailHint")}
          </p>
        )}
      </div>

      <div className="wl-field">
        <label htmlFor={`${id}-plan`}>{t.t("form.plan")}</label>
        <select
          className="wl-select"
          id={`${id}-plan`}
          name="plan"
          value={plan}
          onChange={(event) => setPlan(parsePlan(event.target.value))}
        >
          {WAITLIST_PLANS.map((value) => (
            <option key={value} value={value}>
              {plans[value].name} · {plans[value].price}
            </option>
          ))}
        </select>
      </div>

      {formError && (
        <p className="wl-alert" role="alert">
          <span className="emoji" aria-hidden="true">
            😬
          </span>
          <span>{formError}</span>
        </p>
      )}

      <button className="btn btn-primary btn-lg wl-submit" type="submit" disabled={submitting}>
        {submitting ? t.t("form.submitting") : t.t("form.submit")}
      </button>

      <p className="wl-fine">
        {rich(t.raw("form.fine"), {
          link: (text) => (
            <a href={LINKS.privacy} hrefLang={linkLang}>
              {text}
            </a>
          ),
        })}
      </p>
    </form>
  );
}
