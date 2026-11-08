"use client";
// Column chart of captured spend per day. Plain SVG so it can be themed with the
// app's CSS variables, sized to its container, and keyboard focusable. Amounts
// are integer cents until they are formatted for display.

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../../lib/money";
import type { DaySpend } from "../../lib/studio/aggregate";

const MARGIN = { top: 12, right: 12, bottom: 28, left: 56 };
const MIN_W = 160;
const MIN_H = 120;

/** Round tick values (integer cents) from 0 up to at least `max`. */
export function niceTicks(maxCents: number, target = 4): number[] {
  const max = Math.max(1, Math.ceil(maxCents));
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step =
    Math.max(
      1,
      Math.round(
        [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
      )
    ) || 1;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) {
    ticks.push(v);
    if (v >= max) break;
  }
  return ticks;
}

function dayLabel(day: string, long = false): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(long ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(d);
}

function axisMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return formatMoney({ amountCents: cents, currency });
  }
}

export function SpendChart({
  days,
  currency,
}: {
  days: DaySpend[];
  currency: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (r) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = Math.max(MIN_W, size.w);
  const h = Math.max(MIN_H, size.h);
  const innerW = w - MARGIN.left - MARGIN.right;
  const innerH = h - MARGIN.top - MARGIN.bottom;
  const max = Math.max(1, ...days.map((d) => d.amountCents));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] ?? max;
  const slot = innerW / Math.max(1, days.length);
  const barW = Math.max(6, Math.min(48, slot * 0.6));
  // Show every Nth date label so labels never overlap.
  const every = Math.max(1, Math.ceil(64 / Math.max(1, slot)));
  const y = (cents: number) => MARGIN.top + innerH - (cents / top) * innerH;
  const hovered = active !== null ? days[active] : undefined;

  return (
    <div className="ap-chart" ref={wrap}>
      {size.w > 0 ? (
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="group"
          aria-label="Captured spend per day, column chart"
        >
          <defs>
            <linearGradient id="ap-bar-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="ap-bar-stop-a" />
              <stop offset="100%" className="ap-bar-stop-b" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line
                className="ap-grid-line"
                x1={MARGIN.left}
                x2={w - MARGIN.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text
                className="ap-axis-text num"
                x={MARGIN.left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {axisMoney(t, currency)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = MARGIN.left + slot * i + slot / 2;
            const bh = Math.max(2, innerH - (y(d.amountCents) - MARGIN.top));
            const label = `${dayLabel(d.day, true)}: ${formatMoney(d)}`;
            return (
              <g
                key={d.day}
                tabIndex={0}
                role="img"
                aria-label={label}
                className="ap-bar-group"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <rect
                  className="ap-bar-hit"
                  x={cx - slot / 2}
                  y={MARGIN.top}
                  width={slot}
                  height={innerH}
                />
                <rect
                  className="ap-chart-bar"
                  data-active={active === i}
                  x={cx - barW / 2}
                  y={MARGIN.top + innerH - bh}
                  width={barW}
                  height={bh}
                  rx={4}
                />
                {i % every === 0 ? (
                  <text
                    className="ap-axis-text num"
                    x={cx}
                    y={h - 8}
                    textAnchor="middle"
                  >
                    {dayLabel(d.day)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
      {hovered && active !== null ? (
        <div
          className="ap-tooltip num"
          role="status"
          style={{
            left: Math.min(
              Math.max(8, MARGIN.left + slot * active + slot / 2),
              Math.max(8, w - 8)
            ),
            top: Math.max(0, y(hovered.amountCents) - 8 - 0),
          }}
        >
          <strong>{formatMoney(hovered)}</strong>
          <span>{dayLabel(hovered.day, true)}</span>
        </div>
      ) : null}
    </div>
  );
}
