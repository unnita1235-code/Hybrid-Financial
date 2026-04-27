"use client";

import { useCallback, useRef, useState } from "react";
import { type AgentWsServerMessage } from "@/lib/agent-ws";
import { getBackendWsUrl } from "@/lib/aequitas-api";

type RunTemporalInput = {
  threadId: string;
  query: string;
};

export function useTemporalWs() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const run = useCallback(
    async (
      input: RunTemporalInput,
      onMessage: (message: AgentWsServerMessage) => void,
    ) => {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${getBackendWsUrl()}/v1/temporal/ws`);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          ws.send(
            JSON.stringify({
              type: "run",
              thread_id: input.threadId,
              user_query: input.query,
            }),
          );
        };
        ws.onmessage = (event) => {
          try {
            onMessage(JSON.parse(String(event.data)) as AgentWsServerMessage);
          } catch {
            // Ignore malformed frame.
          }
        };
        ws.onerror = () => reject(new Error("Temporal websocket failed"));
        ws.onclose = () => {
          setConnected(false);
          resolve();
        };
      });
    },
    [],
  );

  const close = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  return { connected, run, close };
}
