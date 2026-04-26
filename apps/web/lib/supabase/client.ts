import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClientKey, getSupabaseUrl, isSupabaseConfigured } from "./env";

/**
 * Supabase for **Client Components** — single browser singleton via
 * `createBrowserClient` (session cookies stay in sync with server via middleware).
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() must run in the browser");
  }
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  return createBrowserClient(getSupabaseUrl(), getSupabaseClientKey(), {
    isSingleton: true,
  });
}
