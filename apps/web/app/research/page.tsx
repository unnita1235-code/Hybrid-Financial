"use client";

import { Copy, Download, Loader2, Mic, MicOff, RotateCcw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  if (score > 0.7) return "bg-emerald-500";
  if (score >= 0.5) return "bg-amber-400";
  return "bg-red-500";
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

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-6 lg:grid-cols-[1.1fr_1.5fr_1fr]">
      <section className="glass-terminal rounded-xl p-4 sm:p-5">
        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          Deep research workspace
        </p>
        <form onSubmit={runResearch} className="mt-3 space-y-3">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 2000))}
            rows={9}
            minLength={10}
            maxLength={2000}
            placeholder="Enter a research question requiring SQL + document evidence synthesis..."
            className="min-h-[220px] w-full resize-y rounded-lg border border-border bg-card p-3 font-mono text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!canRun}
              className="rounded-md border border-primary bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isRunning ? "Running..." : "Run Research"}
            </button>
            <button
              type="button"
              disabled={!voice.supported || voice.state === "listening"}
              onClick={voice.start}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              <Mic className="h-3.5 w-3.5" /> Voice
            </button>
            <button
              type="button"
              disabled={voice.state !== "listening"}
              onClick={voice.stop}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              <MicOff className="h-3.5 w-3.5" /> Stop
            </button>
            <button
              type="button"
              onClick={voice.clear}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Clear voice
            </button>
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
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {voice.error}
            </p>
          )}
        </form>
      </section>

      <section className="glass-terminal rounded-xl p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm text-slate-200">
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
          ) : (
            <span className="inline-block h-2 w-2 rounded-full bg-slate-500" />
          )}
          <span>{statusText || "Planning questions..."}</span>
        </div>

        {warning && (
          <div className="mt-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
            ⚠ SQL data and document evidence may conflict — review carefully
          </div>
        )}

        <div className="mt-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
            Sub-questions
          </p>
          <ol className="mt-2 space-y-2">
            {subQuestions.map((q) => (
              <li
                key={q.index}
                className="animate-[fadeIn_280ms_ease-out] rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {q.index}. {q.question}
                  </span>
                  {q.done ? (
                    <span className="text-xs text-emerald-300">
                      ✓ ({q.ragHits ?? 0} RAG hits)
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">running...</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              Executive summary
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={async () => navigator.clipboard.writeText(summaryText)}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
              <button
                type="button"
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
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3 w-3" /> Export
              </button>
            </div>
          </div>
          <p className="mt-2 min-h-[160px] rounded-md border border-border bg-card p-3 text-sm leading-6 text-foreground">
            {summaryText || "Summary will stream here when synthesis starts..."}
          </p>
        </div>

        <div className="mt-5">
          <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
            Confidence
          </p>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full border border-border bg-muted">
            <div
              className={cn(
                "h-full transition-all duration-500",
                confidence == null ? "bg-slate-700" : confidenceClasses(confidence),
              )}
              style={{ width: `${Math.round((confidence ?? 0) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {confidence == null
              ? "Awaiting score..."
              : `${(confidence * 100).toFixed(1)}%`}
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
      </section>

      <aside className="glass-terminal rounded-xl p-4 sm:p-5">
        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          Evidence and history
        </p>
        <div className="mt-3 rounded-md border border-border bg-card p-3">
          <p className="text-xs font-medium text-foreground">Recent runs</p>
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
                    className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
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
                <li key={s.index} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Q{s.index}:</span>{" "}
                  {s.question}
                  <br />
                  <span className="text-[11px]">
                    Status: {s.done ? "completed" : "running"} · RAG hits:{" "}
                    {s.ragHits ?? 0}
                  </span>
                </li>
              ))
            )}
          </ol>
        </div>
      </aside>
    </div>
  );
}
