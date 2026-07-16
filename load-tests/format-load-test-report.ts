import type { LoadTestReport } from "./types";

export function formatLoadTestReport(report: LoadTestReport): string {
  const workerCount = report.workers.length;
  return [
    "Alvyn load test",
    `workers: ${workerCount}`,
    `connections: ${report.connectionCount}`,
    `duration: ${Math.round(report.durationMs)} ms`,
    `append operations: ${report.append.succeeded}/${report.append.attempted} (${report.append.eventCount} events)`,
    `load operations: ${report.load.succeeded}/${report.load.attempted} (${report.load.eventCount} events)`,
    `OCC conflicts/retries: ${report.append.conflicts}/${report.append.retries}`,
    `throughput: ${report.throughput.operationsPerSecond.toFixed(2)} operations/s`,
    `latency p50/p95/p99: ${report.overallLatency.p50 ?? "n/a"}/${report.overallLatency.p95 ?? "n/a"}/${report.overallLatency.p99 ?? "n/a"} ms`,
    `verified streams/events: ${report.verification.streamCount}/${report.verification.eventCount}`,
  ].join("\n");
}
