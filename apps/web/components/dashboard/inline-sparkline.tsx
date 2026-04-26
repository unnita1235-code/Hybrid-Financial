"use client";

import { cn } from "@/lib/utils";

type Point = { t: string; v: number };

type InlineSparklineProps = {
  data: Point[];
  className?: string;
  height?: number;
  /** pixels */
  width?: number;
  strokeClassName?: string;
};

/**
 * Ultra-minimal line chart: no grid, no axes, terminal aesthetic.
 */
export function InlineSparkline({
  data,
  className,
  height = 20,
  width = 120,
  strokeClassName = "stroke-white/50",
}: InlineSparklineProps) {
  if (!data || data.length < 1) {
    return (
      <span
        className={cn("inline-block align-middle", className)}
        style={{ width, height }}
        aria-hidden
      />
    );
  }
  const values = data.map((d) => d.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 1;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1 || 1)) * w;
    const y = pad + h - ((v - min) / span) * h;
    return `${i === 0 ? "M" : "L"}${x},${y}`;
  });
  return (
    <svg
      className={cn("inline-block align-text-bottom", className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Sparkline"
    >
      <path
        d={pts.join(" ")}
        fill="none"
        className={cn(strokeClassName, "vector-effect-non-scaling-stroke")}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="nonScalingStroke"
      />
    </svg>
  );
}
