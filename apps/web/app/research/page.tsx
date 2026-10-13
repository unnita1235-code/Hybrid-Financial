"use client";

import { Copy, Download, Loader2, Mic, MicOff, RotateCcw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/lib/hooks/use-voice-input";
import { readResearchSse, type ResearchStreamEvent } from "@/lib/research-stream";

type SubQuestionItem = {
  index: number;
  question: string;
  done: boolean;
  ragHits: number | null;
};

function confidenceClasses(score: number) {
  if (score > 0.7) return "bg-success";
  if (score >= 0.5) return "bg-warning";
  return "bg-destructive";
}

function confidenceVariant(score: number | null) {
  if (score == null) return "default" as const;
  if (score > 0.7) return "verified" as const;
  if (score >= 0.5) return "throttled" as const;
  return "failed" as const;
}

export default function ResearchPage() {
  const [query, setQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState("Planning questions...");
  const [subQuestions, setSubQuestions] = useState<SubQuestionItem[]>([]);
  const [warning, setWarning] = useState(false);
  const [summaryWords, setSummaryWords] = useState<string[]>([]);
  const [targetSummaryWords, setTargetSummaryWords] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const voice = useVoiceInput();

  const canRun = query.trim().length >= 10 && query.length <= 2000 && !isRunning;
  const summaryText = useMemo(() => summaryWords.join(" "), [summaryWords]);

  useEffect(() => {
    if (targetSummaryWords.length === 0) return;
    setSummaryWords([]);
    let idx = 0;
    const id = setInterval(() => {
      idx += 1;
      setSummaryWords(targetSummaryWords.slice(0, idx));
      if (idx >= targetSummaryWords.length) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [targetSummaryWords]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (voice.transcript.trim()) {
      setQuery((prev) =>
        prev.trim()
          ? `${prev.trim()} ${voice.transcript.trim()}`
          : voice.transcript.trim(),
      );
      voice.setTranscript("");
    }
  }, [voice, voice.transcript]);

  const resetRun = () => {
    setStatusText("Planning questions...");
    setSubQuestions([]);
    setWarning(false);
    setSummaryWords([]);
    setTargetSummaryWords([]);
    setConfidence(null);
    setError(null);
  };

  const onEvent = (ev: ResearchStreamEvent) => {
    if (ev.type === "status") {
      setStatusText(ev.message || "Planning questions...");
      return;
    }
    if (ev.type === "sub_question") {
      setSubQuestions((prev) => {
        const without = prev.filter((q) => q.index !== ev.index);
        return [
          ...without,
          { index: ev.index, question: ev.question, done: false, ragHits: null },
        ].sort((a, b) => a.index - b.index);
      });
      return;
    }
    if (ev.type === "sub_result") {
      setSubQuestions((prev) =>
        prev.map((q) =>
          q.index === ev.index ? { ...q, done: true, ragHits: ev.rag_hits } : q,
        ),
      );
      return;
    }
    if (ev.type === "discrepancy_warning") {
      setWarning(true);
      return;
    }
    if (ev.type === "summary") {
      setTargetSummaryWords((ev.text || "").split(/\s+/).filter(Boolean));
      return;
    }
    if (ev.type === "confidence") {
      const score = Number(ev.score);
      setConfidence(Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0);
      return;
    }
    if (ev.type === "error") {
      setError(ev.message || "Research failed");
    }
  };

  const runResearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!canRun) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    resetRun();
    setIsRunning(true);
    setHistory((prev) =>
      [query.trim(), ...prev.filter((h) => h !== query.trim())].slice(0, 8),
    );

    try {
      const res = await fetch("/api/research/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
        signal: ac.signal,
      });
      if (!res.ok) {
        setError(`Research request failed (${res.status})`);
        return;
      }
      await readResearchSse(res.body, onEvent);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Research failed");
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const isError = error != null && error.length > 0;
  const status: "Ready" | "Running" | "Streaming" | "Partial" | "Completed" | "No results" | "Error" =
    isError
      ? "Error"
      : isRunning
        ? targetSummaryWords.length > 0 || subQuestions.length > 0
          ? "Streaming"
          : "Running"
        : summaryText || confidence != null
          ? "Completed"
          : subQuestions.length > 0
            ? "Partial"
            : history.length > 0 || query
              ? "No results"
              : "Ready";
  const statusVariant =
    status === "Completed"
      ? "verified"
      : status === "Running" || status === "Streaming" || status === "Partial"
        ? "primary"
        : status === "Error"
          ? "failed"
          : status === "No results"
            ? "throttled"
            : "default";

  return (
    <div className="mx-auto w-full max-w-7xl overflow-x-clip px-4 py-6">
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-sans text-lg font-semibold tracking-tight text-foreground">
            Deep research workspace
          </h1>
          <Badge variant={statusVariant} aria-live="polite">
            {status}
          </Badge>
          {warning && <Badge variant="throttled">Discrepancy flagged</Badge>}
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Ask a research question requiring SQL + document evidence synthesis.
          Sub-questions stream first, then the executive summary and confidence.
        </p>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
      <section aria-label="Research composer">
        <Card className="p-4 sm:p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Research question
        </p>
        <form onSubmit={runResearch} className="mt-3 space-y-3">
          <label htmlFor="research-query" className="sr-only">
            Research question (10 to 2000 characters)
          </label>
          <textarea
            id="research-query"
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 2000))}
            rows={9}
            minLength={10}
            maxLength={2000}
            placeholder="Enter a research question requiring SQL + document evidence synthesis..."
            className="min-h-[220px] w-full resize-y rounded-md border border-input bg-card p-3 font-mono text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus-visible:ring-2 focus-visible:ring-ring/20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={!canRun}
              className="min-h-[44px]"
            >
              {isRunning ? "Running..." : "Run Research"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!voice.supported || voice.state === "listening"}
              onClick={voice.start}
              aria-label="Start voice input"
            >
              <Mic className="h-3.5 w-3.5" aria-hidden /> Voice
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={voice.state !== "listening"}
              onClick={voice.stop}
              aria-label="Stop voice input"
            >
              <MicOff className="h-3.5 w-3.5" aria-hidden /> Stop
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={voice.clear}
              aria-label="Clear voice transcript"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Clear voice
            </Button>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p>{query.length}/2000 chars</p>
            <p>
              Mic:{" "}
              {voice.state === "listening"
                ? "recording"
                : voice.error
                  ? "error"
                  : voice.supported
                    ? "ready"
                    : "unsupported"}
            </p>
          </div>
          {voice.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive" role="alert">
              {voice.error}
            </p>
          )}
        </form>
        </Card>
      </section>

      <section aria-label="Research progress and synthesis">
        <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm text-foreground">
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
          ) : (
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" aria-hidden />
          )}
          <span role="status">{statusText || "Planning questions..."}</span>
        </div>

        {warning && (
          <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" role="alert">
            SQL data and document evidence may conflict — review carefully
          </div>
        )}

        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Sub-questions
          </p>
          {subQuestions.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Planned sub-questions appear here once the stream starts.
            </p>
          ) : (
          <ol className="mt-2 space-y-2">
            {subQuestions.map((q) => (
              <li
                key={q.index}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {q.index}. {q.question}
                  </span>
                  {q.done ? (
                    <Badge variant="verified" className="shrink-0">
                      {q.ragHits ?? 0} RAG hits
                    </Badge>
                  ) : (
                    <Badge variant="primary" className="shrink-0">
                      running…
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ol>
          )}
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Executive summary
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => navigator.clipboard.writeText(summaryText)}
                aria-label="Copy summary"
              >
                <Copy className="h-3 w-3" aria-hidden /> Copy
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const payload = {
                    query,
                    summary: summaryText,
                    confidence: confidence ?? 0,
                    subQuestions,
                  };
                  const blob = new Blob([JSON.stringify(payload, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "research-session.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                aria-label="Export research session JSON"
              >
                <Download className="h-3 w-3" aria-hidden /> Export
              </Button>
            </div>
          </div>
          <p className="mt-2 min-h-[160px] break-words rounded-md border border-border bg-card p-3 text-sm leading-6 text-foreground">
            {summaryText || "Summary will stream here when synthesis starts..."}
          </p>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Confidence
            </p>
            <Badge variant={confidenceVariant(confidence)}>
              {confidence == null
                ? "Awaiting score"
                : `${(confidence * 100).toFixed(1)}%`}
            </Badge>
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full border border-border bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((confidence ?? 0) * 100)} aria-label="Research confidence">
            <div
              className={cn(
                "h-full transition-all duration-500 motion-reduce:transition-none",
                confidence == null ? "bg-muted-foreground/40" : confidenceClasses(confidence),
              )}
              style={{ width: `${Math.round((confidence ?? 0) * 100)}%` }}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
            <p className="mt-1 text-xs text-muted-foreground">
              Query preserved — adjust and run again.
            </p>
          </div>
        )}
        </Card>
      </section>

      <aside aria-label="Evidence and history" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <Card className="p-4 sm:p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Evidence and history
        </p>
        <div className="mt-3 rounded-md border border-border bg-card p-3">
          <p className="text-xs font-medium text-foreground">Recent runs (up to 8)</p>
          <ul className="mt-2 space-y-1">
            {history.length === 0 ? (
              <li className="text-xs text-muted-foreground">
                No prior runs in this session.
              </li>
            ) : (
              history.map((h, i) => (
                <li key={`${h}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setQuery(h)}
                    className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground break-words transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                  >
                    {h}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="mt-3 rounded-md border border-border bg-card p-3">
          <p className="text-xs font-medium text-foreground">Evidence timeline</p>
          <ol className="mt-2 space-y-2">
            {subQuestions.length === 0 ? (
              <li className="text-xs text-muted-foreground">
                Sub-question evidence appears here.
              </li>
            ) : (
              subQuestions.map((s) => (
                <li key={s.index} className="text-xs text-muted-foreground break-words">
                  <Badge variant={s.done ? "verified" : "primary"} className="mb-1">
                    Q{s.index} {s.done ? "completed" : "running"}
                  </Badge>{" "}
                  <span className="font-medium text-foreground">{s.question}</span>
                  <br />
                  <span className="font-numeric text-[11px] tabular-nums">
                    RAG hits: {s.ragHits ?? 0}
                  </span>
                </li>
              ))
            )}
          </ol>
        </div>
        </Card>
      </aside>
      </div>
    </div>
  );
}
