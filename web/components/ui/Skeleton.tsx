import { cx } from "./cx";

/** Decorative loading block. Pair with a visible or sr-only loading label. */
export function Skeleton({
  width = "100%",
  height = "1rem",
  className,
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  return (
    <span
      className={cx("skeleton", className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** Stack of skeleton cards used while a list loads. */
export function SkeletonList({
  count = 2,
  label = "Loading",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="card" key={i} aria-hidden="true">
          <div className="stack">
            <Skeleton width="40%" height="1.25rem" />
            <Skeleton width="90%" />
            <Skeleton width="70%" />
          </div>
        </div>
      ))}
    </div>
  );
}
