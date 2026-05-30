"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageTemplateProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  maxWidthClassName?: string;
};

export function PageTemplate({
  title,
  subtitle,
  actions,
  children,
  maxWidthClassName = "max-w-6xl",
}: PageTemplateProps) {
  return (
    <section className={cn("mx-auto w-full animate-fade-in-up px-4 py-6", maxWidthClassName)}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
