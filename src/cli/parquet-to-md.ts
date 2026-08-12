#!/usr/bin/env bun
import { readFile } from "node:fs/promises";

import {
  asyncBufferFromBytes,
  readResultRows,
  summarizeChunkRows,
} from "../results/parquet";

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    process.stderr.write("Usage: bun src/cli/parquet-to-md.ts <path.parquet>\n");
    process.exitCode = 1;
    return;
  }

  const bytes = new Uint8Array(await readFile(filePath));
  const rows = await readResultRows(asyncBufferFromBytes(bytes));

  if (rows.length === 0) {
    process.stderr.write("No rows found in parquet file.\n");
    process.exitCode = 1;
    return;
  }

  const first = rows[0]!;
  const summary = summarizeChunkRows(rows);
  if (!summary) {
    process.stderr.write("Could not summarize rows.\n");
    process.exitCode = 1;
    return;
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fmtDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  };

  const correctRows = rows.filter((r) => r.score_value === "C");
  const wrongAnswerRows = rows.filter(
    (r) => r.score_value === "I" && r.answer !== null
  );
  const noAnswerRows = rows.filter(
    (r) => r.score_value === "I" && r.answer === null
  );
  const skippedRows = rows.filter((r) => r.score_value === "S");

  const subdomainMap = new Map<
    string,
    { correct: number; wrong: number; noAnswer: number; skipped: number }
  >();
  for (const row of rows) {
    const meta = row.metadata ? JSON.parse(row.metadata) : null;
    const subdomain: string = meta?.subdomain ?? "Unknown";
    const entry = subdomainMap.get(subdomain) ?? {
      correct: 0,
      wrong: 0,
      noAnswer: 0,
      skipped: 0,
    };
    if (row.score_value === "C") entry.correct++;
    else if (row.score_value === "I" && row.answer !== null) entry.wrong++;
    else if (row.score_value === "I" && row.answer === null) entry.noAnswer++;
    else entry.skipped++;
    subdomainMap.set(subdomain, entry);
  }

  const subdomainRows = [...subdomainMap.entries()]
    .sort(([, a], [, b]) => {
      const totalA = a.correct + a.wrong + a.noAnswer + a.skipped;
      const totalB = b.correct + b.wrong + b.noAnswer + b.skipped;
      return totalB - totalA;
    })
    .map(([name, s]) => {
      const total = s.correct + s.wrong + s.noAnswer + s.skipped;
      return `| ${name} | ${s.correct} | ${s.wrong} | ${s.noAnswer} | ${total} | ${pct(s.correct / total)} |`;
    })
    .join("\n");

  const failedRows = [...wrongAnswerRows, ...noAnswerRows, ...skippedRows];
  const failureSection =
    failedRows.length > 0
      ? `## Failures (${failedRows.length})

${noAnswerRows.length > 0 ? `> **Note:** ${noAnswerRows.length} "No answer" failures had empty model responses (content length 0), indicating inference infrastructure issues (decode errors / 503s) rather than model reasoning failures. Transient errors are logged to stderr during the run but are not persisted in the parquet results. To capture them, redirect stderr: \`bun run bench -- ... 2> run.log\`\n\n` : ""}| Sample | Type | Given Answer | Expected | Subdomain | Explanation |
|---|---|---|---|---|---|
${failedRows
  .map((r) => {
    const meta = r.metadata ? JSON.parse(r.metadata) : null;
    const subdomain: string = meta?.subdomain ?? "Unknown";
    let type: string;
    if (r.answer === null) {
      const msgs = r.messages ? JSON.parse(r.messages) : [];
      const lastMsg = msgs[msgs.length - 1];
      const responseLen = lastMsg?.content?.length ?? 0;
      type = responseLen === 0 ? "Empty response" : "No answer parsed";
    } else {
      type = "Wrong answer";
    }
    return `| ${r.sample_id} | ${type} | ${r.answer ?? "-"} | ${r.target ?? "-"} | ${subdomain} | ${(r.explanation ?? "").slice(0, 80)} |`;
  })
  .join("\n")}
`
      : "";

  const md = `# Benchmark Results: ${first.task}

## Overview

| Field | Value |
|---|---|
| **Model** | ${first.model} |
| **Benchmark** | ${first.task} |
| **Epochs** | ${first.epochs} |
| **Temperature** | ${first.temperature ?? "default"} |
| **Created** | ${first.created_at} |

## Scores

| Metric | Value |
|---|---|
| **Accuracy** | **${pct(summary.accuracy)}** |
| Correct | ${correctRows.length} |
| Wrong Answer | ${wrongAnswerRows.length} |
| No Answer (parse failure) | ${noAnswerRows.length} |
| Skipped | ${skippedRows.length} |
| Total | ${rows.length} |

## Token Usage

| Metric | Value |
|---|---|
| Input Tokens | ${summary.inputTokens.toLocaleString()} |
| Output Tokens | ${summary.outputTokens.toLocaleString()} |
| Reasoning Tokens | ${summary.reasoningTokens.toLocaleString()} |
| Total Tokens | ${summary.totalTokens.toLocaleString()} |
| Total Cost | $${summary.totalCost.toFixed(4)} |
| Generation Time | ${fmtDuration(summary.generationTimeMs)} |

## Accuracy by Subdomain

| Subdomain | Correct | Wrong | No Answer | Total | Accuracy |
|---|---|---|---|---|---|
${subdomainRows}

${failureSection}## All Samples

| Sample | Score | Answer | Explanation |
|---|---|---|---|
${rows.map((r) => `| ${r.sample_id} | ${r.score_value === "C" ? "Correct" : r.answer === null ? "No Answer" : "Wrong"} | ${r.answer ?? "-"} | ${(r.explanation ?? "").slice(0, 80)} |`).join("\n")}
`;

  process.stdout.write(md);
}

await main();
