"use client";

import { Line, LineChart as RechartsLineChart, ResponsiveContainer } from "recharts";

export type LineChartDatum = {
  x: string;
  y: number;
};

type LineChartProps = {
  data: LineChartDatum[];
  className?: string;
};

export function LineChart({ data, className }: LineChartProps) {
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={120}>
        <RechartsLineChart data={data}>
          <Line
            type="monotone"
            dataKey="y"
            stroke="currentColor"
            strokeWidth={2}
            dot={false}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
