import { readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";

const RESULTS_DIR = "bench-results";
const OUTPUT_PATH = join(RESULTS_DIR, "summary.md");

const TASK_TITLES: Record<string, string> = {
  gpqa_diamond: "GPQA Diamond",
};

type Row = Record<string, unknown>;

interface RunSummary {
  readonly session: string;
  readonly task: string;
  readonly model: string;
  readonly epochs: number;
  readonly temperature: number | null;
  readonly accuracy: number;
  readonly correct: number;
  readonly total: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly generationTimeMs: number;
  readonly createdAt: string;
  readonly testsRun: number;
  readonly uniqueQuestions: number;
  readonly skipped: number;
  readonly rows: readonly Row[];
}

function num(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function pct(correct: number, total: number): string {
  const rate = total === 0 ? 0 : (correct / total) * 100;
  return `${rate.toFixed(2)}%`;
}

function sessionFromFile(path: string, task: string, model: string): string {
  const base = basename(path, ".parquet");
  const prefix = `${task}-${model.replaceAll("/", "_")}-`;
  const raw = base.startsWith(prefix) ? base.slice(prefix.length) : base;
  return raw.slice(0, 8);
}

function tally(rows: readonly Row[]): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (const row of rows) {
    const score = str(row.score_value);
    if (score === "S") {
      continue;
    }
    total += 1;
    if (score === "C") {
      correct += 1;
    }
  }
  return { correct, total };
}

function groupBy(
  rows: readonly Row[],
  key: (row: Row) => string
): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = groups.get(k);
    if (existing === undefined) {
      groups.set(k, [row]);
    } else {
      existing.push(row);
    }
  }
  return groups;
}

function subdomainOf(row: Row): string {
  const raw = row.metadata;
  if (typeof raw !== "string") {
    return "Unknown";
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const subdomain =
      parsed !== null && typeof parsed === "object"
        ? (parsed as { subdomain?: unknown }).subdomain
        : undefined;
    return typeof subdomain === "string" && subdomain.length > 0
      ? subdomain
      : "Unknown";
  } catch {
    return "Unknown";
  }
}

async function loadRun(path: string): Promise<RunSummary | null> {
  const rows = (await parquetReadObjects({
    file: await asyncBufferFromFile(path),
  })) as Row[];
  const first = rows[0];
  if (first === undefined) {
    return null;
  }
  const task = str(first.task);
  const model = str(first.model);
  return {
    session: sessionFromFile(path, task, model),
    task,
    model,
    epochs: num(first.epochs),
    temperature: first.temperature === null ? null : num(first.temperature),
    accuracy: num(first.accuracy),
    correct: num(first.correct_answers),
    total: num(first.total_questions),
    outputTokens: num(first.output_tokens),
    reasoningTokens: num(first.reasoning_tokens),
    generationTimeMs: num(first.generation_time_ms),
    createdAt: str(first.created_at),
    testsRun: rows.length,
    uniqueQuestions: new Set(rows.map((row) => str(row.sample_id))).size,
    skipped: rows.filter((row) => str(row.score_value) === "S").length,
    rows,
  };
}

function overviewTable(runs: readonly RunSummary[]): string {
  const header = [
    "| Model | Epochs | Temp | Tests | Accuracy | Correct | Output tokens | Wall-clock (model) | Session |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const body = runs.map((run) =>
    [
      run.model,
      String(run.epochs),
      run.temperature === null ? "—" : String(run.temperature),
      run.testsRun.toLocaleString("en-US"),
      `${(run.accuracy * 100).toFixed(2)}%`,
      `${run.correct}/${run.total}`,
      run.outputTokens.toLocaleString("en-US"),
      `${(run.generationTimeMs / 3_600_000).toFixed(2)} h`,
      `\`${run.session}\``,
    ].join(" | ")
  );
  return [...header, ...body.map((line) => `| ${line} |`)].join("\n");
}

function breakdownTable(
  label: string,
  groups: Map<string, Row[]>,
  sort: (a: [string, number], b: [string, number]) => number
): string {
  const withRates = [...groups.entries()].map(([key, rows]) => {
    const { correct, total } = tally(rows);
    return {
      key,
      correct,
      total,
      rate: total === 0 ? 0 : correct / total,
    };
  });
  withRates.sort((a, b) => sort([a.key, a.rate], [b.key, b.rate]));
  return [
    `| ${label} | Accuracy | Correct |`,
    "| --- | --- | --- |",
    ...withRates.map(
      (entry) =>
        `| ${entry.key} | ${pct(entry.correct, entry.total)} | ${entry.correct}/${entry.total} |`
    ),
  ].join("\n");
}

function normalizeFailure(explanation: string): string {
  return explanation
    .replaceAll(/[0-9a-f]{8,}/gi, "<id>")
    .replaceAll(/\d+/g, "<n>")
    .slice(0, 160);
}

function failureTable(rows: readonly Row[]): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const explanation = row.explanation;
    if (
      typeof explanation !== "string" ||
      !/^(Model|Solver) error/.test(explanation)
    ) {
      continue;
    }
    const key = normalizeFailure(explanation);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return null;
  }
  return [
    "| Failure | Count | Share |",
    "| --- | --- | --- |",
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([message, count]) =>
          `| ${message} | ${count} | ${pct(count, rows.length)} |`
      ),
  ].join("\n");
}

function runSection(run: RunSummary): string {
  const epochGroups = groupBy(run.rows, (row) => String(num(row.epoch)));
  const subdomainGroups = groupBy(run.rows, subdomainOf);
  const failures = failureTable(run.rows);
  return [
    `## ${run.model} — \`${run.session}\``,
    "",
    `Run started ${run.createdAt}. Reasoning tokens: ${run.reasoningTokens}.`,
    "",
    `Tests run: ${run.testsRun.toLocaleString("en-US")} (${run.uniqueQuestions.toLocaleString("en-US")} unique questions × ${run.epochs} epochs). Skipped: ${run.skipped}.`,
    "",
    breakdownTable("Epoch", epochGroups, (a, b) => Number(a[0]) - Number(b[0])),
    "",
    breakdownTable("Subdomain", subdomainGroups, (a, b) => a[1] - b[1]),
    ...(failures === null ? [] : ["", failures]),
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const paths =
    args.length > 0
      ? args
      : readdirSync(RESULTS_DIR)
          .filter((file) => file.endsWith(".parquet"))
          .map((file) => join(RESULTS_DIR, file));

  const loaded = await Promise.all(paths.map((path) => loadRun(path)));
  const runs = loaded
    .filter((run): run is RunSummary => run !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (runs.length === 0) {
    process.stderr.write(`No parquet results found in ${RESULTS_DIR}/\n`);
    process.exitCode = 1;
    return;
  }

  const tasks = [...new Set(runs.map((run) => run.task))];
  const title = tasks.map((task) => TASK_TITLES[task] ?? task).join(" / ");

  const markdown = `${[
    `# ${title} results`,
    "",
    overviewTable(runs),
    "",
    ...runs.flatMap((run) => [runSection(run), ""]),
  ].join("\n")}\n`;

  writeFileSync(OUTPUT_PATH, markdown);
  process.stdout.write(markdown);
  process.stderr.write(`\nwrote ${OUTPUT_PATH}\n`);
}

await main();
