import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "li" | "article";
  raised?: boolean;
  interactive?: boolean;
}

export function Card({
  as: Tag = "div",
  raised,
  interactive,
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx(
        "card",
        raised && "card-raised",
        interactive && "card-interactive",
        className
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  titleId,
  actions,
}: {
  title: ReactNode;
  titleId?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="card-head">
      <h2 id={titleId} className="card-title">
        {title}
      </h2>
      {actions}
    </div>
  );
}
