import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs tabular-nums",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-muted-foreground",
        live: "border-success/40 bg-success/10 text-success",
        verified: "border-secondary/40 bg-secondary/10 text-secondary",
        throttled: "border-warning/40 bg-warning/10 text-warning",
        failed: "border-destructive/40 bg-destructive/10 text-destructive",
        primary: "border-primary/40 bg-primary/10 text-primary",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
