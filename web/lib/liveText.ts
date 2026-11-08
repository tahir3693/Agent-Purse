// One clear status chip per live event. The event carries both a state and a
// decision that often say the same thing ("escalated" and "escalate"), so the
// state wins and the decision is used only when the state adds nothing.
import type { LiveEvent } from "./live/connection";

const STATE_LABEL: Record<string, string> = {
  pending: "Pending",
  escalated: "Escalated",
  authorized: "Authorized",
  captured: "Captured",
  denied: "Denied",
  voided: "Voided",
  failed: "Failed",
};

const DECISION_LABEL: Record<string, string> = {
  approve: "Approved",
  escalate: "Escalated",
  deny: "Denied",
};

export interface EventChip {
  /** Key for the status pill tone. */
  status: string;
  label: string;
}

export function eventChip(
  e: Pick<LiveEvent, "state" | "decision">
): EventChip | null {
  const stateLabel = e.state ? STATE_LABEL[e.state] : undefined;
  const decisionLabel = e.decision ? DECISION_LABEL[e.decision] : undefined;
  if (e.state && stateLabel && !(e.state === "pending" && decisionLabel)) {
    return { status: e.state, label: stateLabel };
  }
  if (e.decision && decisionLabel) {
    return { status: e.decision, label: decisionLabel };
  }
  return e.state ? { status: e.state, label: stateLabel ?? e.state } : null;
}
