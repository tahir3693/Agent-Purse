import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cx } from "./cx";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

/** Class names for a button look; shared by Button and ButtonLink. */
export function buttonClass({
  variant = "primary",
  size = "md",
  block,
}: StyleProps = {}): string {
  return cx(
    "btn",
    `btn-${variant}`,
    size !== "md" && `btn-${size}`,
    block && "btn-block"
  );
}

export function Button({
  variant,
  size,
  block,
  className,
  type = "button",
  ...rest
}: StyleProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(buttonClass({ variant, size, block }), className)}
      {...rest}
    />
  );
}

export function ButtonLink({
  variant,
  size,
  block,
  className,
  ...rest
}: StyleProps & ComponentProps<typeof Link>) {
  return (
    <Link
      className={cx(buttonClass({ variant, size, block }), className)}
      {...rest}
    />
  );
}
