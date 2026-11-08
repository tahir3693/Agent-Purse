import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx, type Tone } from "./cx";

export function StatTile({
  label,
  value,
  delta,
  tone,
  icon: Icon,
  brand,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  /** Gradient accent for the key number. */
  brand?: boolean;
}) {
  return (
    <div className={cx("stat", tone && `tone-${tone}`, brand && "stat-brand")}>
      <div className="stat-label">
        {Icon ? (
          <Icon size={16} aria-hidden="true" className="stat-icon" />
        ) : null}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {delta ? <div className="stat-delta">{delta}</div> : null}
    </div>
  );
}
