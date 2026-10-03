import type { PlanId } from "@emojisense/platform";
import type { ReactNode } from "react";
import type { Feature } from "../lib/plans";
import { PlanGate } from "./PlanGate";

interface LockedPreviewProps {
  feature: Feature;
  /** The plan named by the API's 402 answer; defaults to the lowest plan with the feature. */
  plan?: PlanId;
  /** The real page parts, filled with sample data. */
  children: ReactNode;
}

/**
 * A locked feature shows itself: the page with sample data, faded and out of reach, under a card
 * that names the plan. The sample is inert, so it takes no focus, clicks or screen reader time.
 */
export function LockedPreview({ feature, plan, children }: LockedPreviewProps) {
  return (
    <div className="locked">
      <div className="locked-sample" inert aria-hidden="true">
        <p className="locked-tag">Sample data</p>
        {children}
      </div>
      <div className="locked-card">
        <PlanGate feature={feature} plan={plan} overlay />
      </div>
    </div>
  );
}
