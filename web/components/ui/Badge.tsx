import type { ReactNode } from "react";
import { cx, type Tone } from "./cx";

export function Badge({
  tone = "neutral",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("badge", `tone-${tone}`, className)}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  // intent states
  pending: "neutral",
  escalated: "warning",
  authorized: "info",
  captured: "success",
  denied: "danger",
  voided: "neutral",
  failed: "danger",
  expired: "warning",
  // Risk Guard decisions
  approve: "success",
  approved: "success",
  escalate: "warning",
  deny: "danger",
  // agents
  active: "success",
  killed: "danger",
  // price check
  ok: "success",
  fair: "success",
  low: "success",
  high: "danger",
  unknown: "warning",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status.toLowerCase()] ?? "neutral";
}

/** Status text is always shown, so color is never the only signal. */
export function StatusPill({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return <Badge tone={statusTone(status)}>{label ?? status}</Badge>;
}

/** Risk score 0-100 as a bar with a text level. */
export function RiskMeter({
  score,
  compact,
}: {
  score: number | null | undefined;
  compact?: boolean;
}) {
  if (score === null || score === undefined) {
    return <span className="muted">-</span>;
  }
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const tone: Tone = value < 34 ? "success" : value < 67 ? "warning" : "danger";
  const level = value < 34 ? "Low" : value < 67 ? "Medium" : "High";
  return (
    <div
      className={cx("meter", `tone-${tone}`, compact && "meter-compact")}
      role="meter"
      aria-label="Risk score"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${value} of 100, ${level} risk`}
    >
      <div className="meter-top num">
        <span>{level} risk</span>
        <span>{value}/100</span>
      </div>
      <div className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
