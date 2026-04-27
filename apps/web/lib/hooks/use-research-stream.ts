"use client";

import { useCallback, useRef, useState } from "react";
import type { ResearchStreamEvent } from "@/lib/research-stream";
import { readResearchSse } from "@/lib/research-stream";

export function useResearchStream() {
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (
      url: string,
      payload: unknown,
      onEvent: (ev: ResearchStreamEvent) => void,
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`Research stream failed (${res.status})`);
        await readResearchSse(res.body, onEvent);
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { running, run, cancel };
}
