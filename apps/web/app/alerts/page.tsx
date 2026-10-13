"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, Info, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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

function triageBadgeVariant(severity: TriageResult["severity"]) {
  if (severity === "critical") return "failed" as const;
  if (severity === "high") return "throttled" as const;
  if (severity === "medium") return "primary" as const;
  return "default" as const;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [triageById, setTriageById] = useState<Record<string, TriageResult>>({});
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [busyTriage, setBusyTriage] = useState<Record<string, boolean>>({});
  const [busyRead, setBusyRead] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const selected = useMemo(
    () => unread.find((a) => a.id === selectedId) ?? null,
    [unread, selectedId],
  );

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
      setSelectedId((prev) => (prev === id ? null : prev));
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
    <div className="mx-auto w-full max-w-7xl overflow-x-clip px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-sans text-lg font-semibold tracking-tight text-foreground">
            Alerts
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review unread alerts, run triage on individual items, expand
            why-triggered explainability, and mark items read when done.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default" aria-live="polite">
            <Bell className="h-3 w-3" aria-hidden />
            {unread.length} unread
          </Badge>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadAlerts()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <Card className="p-6 text-center">
          <p
            className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2
              className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden
            />
            Loading alerts&hellip;
          </p>
        </Card>
      ) : unread.length === 0 ? (
        <Card className="p-6 text-center">
          <div className="mx-auto max-w-md">
            <Bell
              className="mx-auto h-8 w-8 text-muted-foreground"
              aria-hidden
            />
            <h2 className="mt-2 text-base font-semibold text-foreground">
              No unread alerts
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              New alerts appear here when the alerts endpoint returns unread
              items. Use Refresh to reload the current list.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => void loadAlerts()}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section aria-label="Unread alerts" className="min-w-0 space-y-3">
            {unread.map((alert) => {
              const triage = triageById[alert.id];
              const bodyExcerpt = (alert.body || "").slice(0, 200);
              const expanded = !!expandedById[alert.id];
              return (
                <Card key={alert.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">
                      {alert.title || "Untitled alert"}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default">Unread</Badge>
                      <Badge variant="default" className="font-mono">
                        z-score:{" "}
                        {alert.z_score == null
                          ? "n/a"
                          : Number(alert.z_score).toFixed(2)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        <time dateTime={alert.created_at ?? undefined}>
                          {timeAgo(alert.created_at)}
                        </time>
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 break-words text-sm text-muted-foreground">
                    {bodyExcerpt}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void runTriage(alert.id)}
                      disabled={!!busyTriage[alert.id]}
                    >
                      {busyTriage[alert.id] ? "Triaging..." : "Triage"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedById((p) => ({
                          ...p,
                          [alert.id]: !p[alert.id],
                        }))
                      }
                    >
                      {expanded ? "Hide details" : "Why triggered"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Inspect ${alert.title || "untitled alert"}`}
                      onClick={() => setSelectedId(alert.id)}
                    >
                      Inspect
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void markRead(alert.id)}
                      disabled={!!busyRead[alert.id]}
                    >
                      {busyRead[alert.id] ? "Marking..." : "Mark as read"}
                    </Button>
                  </div>

                  {triage && (
                    <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
                      <Badge variant={triageBadgeVariant(triage.severity)}>
                        {triage.severity === "critical" ||
                        triage.severity === "high" ? (
                          <AlertTriangle
                            className="h-3 w-3"
                            aria-hidden
                          />
                        ) : (
                          <Info className="h-3 w-3" aria-hidden />
                        )}
                        {triage.severity}
                      </Badge>
                      <p className="mt-2 break-words text-sm text-foreground">
                        {triage.summary}
                      </p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        Suggested action: {triage.suggested_action}
                      </p>
                      {(triage.key_catalysts?.length ?? 0) > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-foreground">
                            Key catalysts
                          </p>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                            {(triage.key_catalysts ?? []).map((k) => (
                              <li key={k} className="break-words">
                                {k}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {expanded && (
                    <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        Why triggered
                      </p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        This alert is generated by anomaly monitoring over market
                        and portfolio signals. The z-score indicates deviation
                        magnitude from baseline behavior.
                      </p>
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Confidence</span>
                          <span className="font-mono tabular-nums">
                            {(confidenceFromZ(alert.z_score) * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div
                          className="mt-1 h-2 overflow-hidden rounded-full border border-border bg-muted"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(
                            confidenceFromZ(alert.z_score) * 100,
                          )}
                          aria-label={`Confidence for ${alert.title || "untitled alert"}`}
                        >
                          <div
                            className="h-full bg-secondary transition-all duration-500 motion-reduce:transition-none"
                            style={{
                              width: `${confidenceFromZ(alert.z_score) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </section>

          <aside
            aria-label="Alert detail"
            className="min-w-0 xl:sticky xl:top-4 xl:self-start"
          >
            <Card className="p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Alert detail
              </p>
              {selected ? (
                <div className="mt-2 min-w-0">
                  <h2 className="break-words text-sm font-semibold text-foreground">
                    {selected.title || "Untitled alert"}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="default">Unread</Badge>
                    <Badge variant="default" className="font-mono">
                      z-score:{" "}
                      {selected.z_score == null
                        ? "n/a"
                        : Number(selected.z_score).toFixed(2)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      <time dateTime={selected.created_at ?? undefined}>
                        {timeAgo(selected.created_at)}
                      </time>
                    </span>
                  </div>
                  <p className="mt-2 break-words text-sm leading-6 text-foreground">
                    {selected.body || "No body provided for this alert."}
                  </p>

                  {triageById[selected.id] ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
                      <Badge
                        variant={triageBadgeVariant(
                          triageById[selected.id].severity,
                        )}
                      >
                        {triageById[selected.id].severity}
                      </Badge>
                      <p className="mt-2 break-words text-sm text-foreground">
                        {triageById[selected.id].summary}
                      </p>
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        Suggested action:{" "}
                        {triageById[selected.id].suggested_action}
                      </p>
                      {(triageById[selected.id].key_catalysts?.length ?? 0) >
                        0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                          {(triageById[selected.id].key_catalysts ?? []).map(
                            (k) => (
                              <li key={k} className="break-words">
                                {k}
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                      No triage result yet for this alert. Use Triage to request
                      one; nothing runs until you do.
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void runTriage(selected.id)}
                      disabled={!!busyTriage[selected.id]}
                    >
                      {busyTriage[selected.id] ? "Triaging..." : "Triage"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-expanded={!!expandedById[selected.id]}
                      onClick={() =>
                        setExpandedById((p) => ({
                          ...p,
                          [selected.id]: !p[selected.id],
                        }))
                      }
                    >
                      {expandedById[selected.id]
                        ? "Hide details"
                        : "Why triggered"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void markRead(selected.id)}
                      disabled={!!busyRead[selected.id]}
                    >
                      {busyRead[selected.id] ? "Marking..." : "Mark as read"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedId(null)}
                    >
                      Close panel
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Opening or closing this panel never marks the alert read and
                    never runs triage on its own.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Select Inspect on an alert to review its full body, z-score,
                  timestamp, and triage result here. Opening this panel never
                  marks an alert read or runs triage.
                </p>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
