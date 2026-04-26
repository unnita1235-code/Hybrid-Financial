import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { ComponentType, ReactNode } from "react";
import type { MemoReportResponse } from "@/lib/memo-reports";

// react-pdf component typings lag React 19; cast via `unknown` at the boundary.
const PDFDocument = Document as unknown as ComponentType<{
  children?: ReactNode;
}>;
const PDFPage = Page as unknown as ComponentType<{
  size?: string;
  style?: unknown;
  wrap?: boolean;
  children?: ReactNode;
}>;
const PDFText = Text as unknown as ComponentType<{
  style?: unknown;
  wrap?: boolean;
  children?: ReactNode;
}>;
const PDFView = View as unknown as ComponentType<{
  style?: unknown;
  children?: ReactNode;
}>;

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.5,
    color: "#1a1a1a",
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9.5,
    color: "#525252",
    marginBottom: 6,
  },
  meta: { fontSize: 8, color: "#a3a3a3", marginBottom: 18 },
  rule: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
    marginBottom: 14,
  },
  para: { marginBottom: 5 },
  footer: { marginTop: 22, fontSize: 7.5, color: "#a3a3a3" },
});

function paragraphsFromMemo(memo: string) {
  return memo
    .split(/\n+/)
    .map((l) => l.replace(/\r/g, "").trim())
    .filter((l) => l.length > 0);
}

export function MemoPdfDocument({ data }: { data: MemoReportResponse }) {
  const parts = paragraphsFromMemo(data.final_memo);
  return (
    <PDFDocument>
      <PDFPage size="A4" style={styles.page} wrap>
        <PDFText style={styles.title}>Analyst memo</PDFText>
        <PDFText style={styles.subtitle}>
          {data.metric_focus} · {data.start_date} → {data.end_date}
        </PDFText>
        <PDFText style={styles.meta} wrap>
          {data.sql_summary}
        </PDFText>
        <PDFView style={styles.rule} />
        {parts.map((p, i) => (
          <PDFText key={i} style={styles.para} wrap>
            {p}
          </PDFText>
        ))}
        <PDFText style={styles.footer} wrap>
          Hybrid SQL + RAG + critic · LLM {data.used_llm ? "on" : "off"} · market wire{" "}
          {data.used_news_api ? "live" : "stub"} · {data.model_synthesis}
        </PDFText>
      </PDFPage>
    </PDFDocument>
  );
}
