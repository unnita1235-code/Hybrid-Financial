"use client";

import { SupabaseListener } from "@/components/supabase-listener";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={180} skipDelayDuration={0}>
        <SupabaseListener />
        {children}
      </TooltipProvider>
    </ThemeProvider>
  );
}
