"use client";

import { SupabaseListener } from "@/components/supabase-listener";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={0}>
      <SupabaseListener />
      {children}
    </TooltipProvider>
  );
}
