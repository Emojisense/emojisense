import { type SubmitEvent, useEffect, useId, useRef, useState } from "react";
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
  /** Injected in tests. */
  fetch?: typeof fetch;
}

type Phase =
  | { name: "editing"; fieldError?: string; formError?: string }
  | { name: "submitting" }
  | { name: "joined"; email: string; plan: WaitlistPlan; alreadyJoined: boolean };

export function WaitlistForm(props: WaitlistFormProps) {
  const { endpoint, plans, initialPlan = "pro" } = props;
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<WaitlistPlan>(initialPlan);
  const [phase, setPhase] = useState<Phase>({ name: "editing" });
  const [enhanced, setEnhanced] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const id = useId();

  // The page is static, so the ?plan= link from the pricing page is read after hydration.
  useEffect(() => {
    setEnhanced(true);
    const fromUrl = new URLSearchParams(window.location.search).get("plan");
    if (fromUrl) setPlan(parsePlan(fromUrl));
  }, []);

  useEffect(() => {
    if (phase.name === "joined") doneRef.current?.focus();
  }, [phase.name]);

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fieldError = validateEmail(email);
    if (fieldError) {
      setPhase({ name: "editing", fieldError });
      emailRef.current?.focus();
      return;
    }
    setPhase({ name: "submitting" });
    const result: WaitlistResult = await submitWaitlist(
      { email, plan },
      { endpoint, ...(props.fetch ? { fetch: props.fetch } : {}) },
    );
    if (result.ok) {
      setPhase({ name: "joined", email: email.trim(), plan, alreadyJoined: result.alreadyJoined });
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
          {phase.alreadyJoined ? "You are already on the list" : "You are on the list"}
        </h2>
        <p>
          We will email <strong>{phase.email}</strong> once, when {plans[phase.plan].name} opens.
        </p>
        <p>
          Until then, the free plan has everything you need to start. <a href="/docs/">Read the quickstart</a>
          .
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
        <label htmlFor={`${id}-email`}>Email</label>
        <input
          ref={emailRef}
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
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
            We use it only to tell you when the plan opens.
          </p>
        )}
      </div>

      <div className="wl-field">
        <label htmlFor={`${id}-plan`}>Plan</label>
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
        {submitting ? "Joining…" : "Join the waitlist"}
      </button>

      <p className="wl-fine">
        One email when your plan opens. No newsletter. <a href="/legal/privacy/">Privacy policy</a>
      </p>
    </form>
  );
}
