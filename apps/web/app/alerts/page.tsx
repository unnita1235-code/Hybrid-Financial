"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type AlertItem = {
  id: string;
  title: string;
  body: string;
  z_score: number | null;
  created_at: string | null;
  read_at: string | null;
};

type TriageResult = {
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  suggested_action: string;
  key_catalysts?: string[];
};

function timeAgo(iso: string | null): string {
  if (!iso) return "unknown time";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function severityClasses(severity: TriageResult["severity"]) {
  if (severity === "critical") return "bg-red-600/20 text-red-200 border-red-400/40";
  if (severity === "high")
    return "bg-orange-600/20 text-orange-200 border-orange-400/40";
  if (severity === "medium")
    return "bg-amber-600/20 text-amber-200 border-amber-400/40";
  return "bg-emerald-600/20 text-emerald-200 border-emerald-400/40";
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [triageById, setTriageById] = useState<Record<string, TriageResult>>({});
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [busyTriage, setBusyTriage] = useState<Record<string, boolean>>({});
  const [busyRead, setBusyRead] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/alerts?unread_only=true&limit=100", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load alerts (${res.status})`);
      const data = (await res.json()) as AlertItem[];
      setAlerts(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const unread = useMemo(() => alerts.filter((a) => !a.read_at), [alerts]);

  const runTriage = async (id: string) => {
    setBusyTriage((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/alerts/${id}/triage`, { method: "POST" });
      if (!res.ok) throw new Error(`Triage failed (${res.status})`);
      const data = (await res.json()) as TriageResult;
      setTriageById((prev) => ({ ...prev, [id]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Triage failed");
    } finally {
      setBusyTriage((p) => ({ ...p, [id]: false }));
    }
  };

  const markRead = async (id: string) => {
    setBusyRead((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/alerts/${id}/read`, { method: "PATCH" });
      if (!res.ok) throw new Error(`Mark as read failed (${res.status})`);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mark as read failed");
    } finally {
      setBusyRead((p) => ({ ...p, [id]: false }));
    }
  };

  const confidenceFromZ = (z: number | null): number => {
    if (z == null) return 0.35;
    return Math.max(0.1, Math.min(0.99, Math.abs(z) / 5));
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Unread alerts</h1>
        <button
          onClick={() => void loadAlerts()}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:text-slate-100"
        >
          Refresh
        </button>
      </div>

      <p className="mb-4 text-xs text-slate-500">{unread.length} unread items</p>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="glass-terminal rounded-xl p-4 text-sm text-slate-500">
          Loading alerts...
        </div>
      ) : unread.length === 0 ? (
        <div className="glass-terminal rounded-xl p-4 text-sm text-slate-500">
          No unread alerts.
        </div>
      ) : (
        <div className="space-y-3">
          {unread.map((alert) => {
            const triage = triageById[alert.id];
            const bodyExcerpt = (alert.body || "").slice(0, 200);
            return (
              <article key={alert.id} className="glass-terminal rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-slate-100">
                    {alert.title || "Untitled alert"}
                  </h2>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="rounded border border-white/10 bg-zinc-900 px-2 py-0.5 text-slate-300">
                      z-score:{" "}
                      {alert.z_score == null ? "n/a" : Number(alert.z_score).toFixed(2)}
                    </span>
                    <span className="text-slate-500">{timeAgo(alert.created_at)}</span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-300">{bodyExcerpt}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void runTriage(alert.id)}
                    disabled={!!busyTriage[alert.id]}
                    className="rounded-md border border-white/20 bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyTriage[alert.id] ? "Triaging..." : "Triage"}
                  </button>
                  <button
                    onClick={() =>
                      setExpandedById((p) => ({ ...p, [alert.id]: !p[alert.id] }))
                    }
                    className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:text-slate-100"
                  >
                    {expandedById[alert.id] ? "Hide details" : "Why triggered"}
                  </button>
                  <button
                    onClick={() => void markRead(alert.id)}
                    disabled={!!busyRead[alert.id]}
                    className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyRead[alert.id] ? "Marking..." : "Mark as read"}
                  </button>
                </div>

                {triage && (
                  <div className="mt-3 rounded-lg border border-white/10 bg-zinc-900/40 p-3">
                    <span
                      className={cn(
                        "inline-flex rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                        severityClasses(triage.severity),
                      )}
                    >
                      {triage.severity}
                    </span>
                    <p className="mt-2 text-sm text-slate-200">{triage.summary}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Suggested action: {triage.suggested_action}
                    </p>
                    {(triage.key_catalysts?.length ?? 0) > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-slate-500">Key catalysts</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-300">
                          {(triage.key_catalysts ?? []).map((k) => (
                            <li key={k}>{k}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {expandedById[alert.id] && (
                  <div className="mt-3 rounded-lg border border-white/10 bg-zinc-900/30 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Explainability
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      This alert is generated by anomaly monitoring over market and
                      portfolio signals. The z-score indicates deviation magnitude from
                      baseline behavior.
                    </p>
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Confidence</span>
                        <span>
                          {(confidenceFromZ(alert.z_score) * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full border border-white/10 bg-zinc-900">
                        <div
                          className="h-full bg-cyan-400/80"
                          style={{ width: `${confidenceFromZ(alert.z_score) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <button className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/20">
                        Triage now
                      </button>
                      <button className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/20">
                        Create task
                      </button>
                      <button className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/20">
                        Dismiss risk
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
