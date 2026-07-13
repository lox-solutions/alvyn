import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { buildAggregateReport } from "./metrics";
import type {
  LoadTestConfig,
  LoadTestReport,
  VerificationSummary,
} from "./types";

export function createReport({
  config,
  schema,
  workerMetrics,
  startedAt,
  verification,
}: {
  config: LoadTestConfig;
  schema: string;
  workerMetrics: LoadTestReport["workers"];
  startedAt: number;
  verification: VerificationSummary;
}): LoadTestReport {
  const durationMs = performance.now() - startedAt;
  return {
    configuration: config,
    schema,
    connectionCount: (config.workerCount + 1) * config.poolSize,
    durationMs,
    ...buildAggregateReport({ workers: workerMetrics, durationMs }),
    verification,
    workers: workerMetrics,
  };
}

export async function writeReport(
  config: LoadTestConfig,
  report: LoadTestReport,
): Promise<void> {
  if (!config.outputPath) return;
  const outputPath = isAbsolute(config.outputPath)
    ? config.outputPath
    : resolve(process.cwd(), config.outputPath);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
