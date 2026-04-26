"use client";

import { Line, LineChart, Tooltip, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

const stroke = "rgb(248 250 252)"; /* slate-50 */
const axis = "rgb(148 163 184)";

type Point = { t: string; v: number };

type MonochromeChartProps = {
  data: Point[];
  className?: string;
  valueLabel?: string;
};

function fmtShort(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}

export function MonochromeChart({
  data,
  className,
  valueLabel = "v",
}: MonochromeChartProps) {
  return (
    <div
      className={cn("rounded-md border border-white/10 bg-slate-900/30 p-3", className)}
    >
      <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
        Series
      </p>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="t"
              tick={{ fill: axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={fmtShort}
              tick={{ fill: axis, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Line
              type="monotone"
              dataKey="v"
              name={valueLabel}
              stroke={stroke}
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              contentStyle={{
                background: "rgb(2 6 23)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                fontSize: 11,
              }}
              labelStyle={{ color: axis, marginBottom: 4 }}
              itemStyle={{ color: stroke }}
              cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
