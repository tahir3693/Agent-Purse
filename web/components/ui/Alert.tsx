import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

type AlertTone = "info" | "warning" | "danger";

/** Inline notice. Danger and warning use role="alert"; info is static. */
export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  const Icon =
    tone === "info" ? Info : tone === "warning" ? TriangleAlert : CircleAlert;
  return (
    <div
      className={cx("alert", `tone-${tone}`, className)}
      role={tone === "info" ? undefined : "alert"}
    >
      <Icon size={18} aria-hidden="true" />
      <div className="alert-body">{children}</div>
    </div>
  );
}
