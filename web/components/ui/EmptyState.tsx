import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={22} aria-hidden="true" />
      </span>
      {title ? <p className="empty-title">{title}</p> : null}
      <p>{children}</p>
      {action}
    </div>
  );
}
