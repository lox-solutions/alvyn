import { isAbsolute, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { evaluateHttpSlos } from "./evaluate-http-slos";
import { HttpMetricsCollector } from "./http-metrics";
import { createLoadTestEnvironment } from "./provenance";
import type {
  HttpLoadTestConfig,
  HttpLoadTestReport,
  HttpPhaseDurations,
  HttpReplicaReport,
  HttpSnapshotBenchmarkReport,
  HttpTrafficPhaseReport,
  HttpVerificationSummary,
} from "./http-types";

const CAPACITY_SUSTAINABILITY_THRESHOLD = 0.95;
const MILLISECONDS_PER_SECOND = 1_000;

export async function writeReport(
  config: HttpLoadTestConfig,
  report: HttpLoadTestReport,
): Promise<void> {
  if (!config.outputPath) return;
  const outputPath = isAbsolute(config.outputPath)
    ? config.outputPath
    : resolve(process.cwd(), config.outputPath);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}

function createCapacitySummary({
  config,
  trafficPhases,
}: {
  config: HttpLoadTestConfig;
  trafficPhases: HttpTrafficPhaseReport[];
}): HttpLoadTestReport["capacity"] {
  if (config.profile !== "capacity") return null;
  const capacityPhases = trafficPhases.filter(
    (trafficPhase) => trafficPhase.targetRequestsPerSecond !== null,
  );
  const sustainableCapacityPhases = capacityPhases.filter(
    (trafficPhase) =>
      trafficPhase.slo.passed &&
      trafficPhase.achievedRequestsPerSecond >=
        (trafficPhase.targetRequestsPerSecond ?? 0) *
          CAPACITY_SUSTAINABILITY_THRESHOLD,
  );
  const firstUnsustainableCapacityPhase = capacityPhases.find(
    (trafficPhase) => !sustainableCapacityPhases.includes(trafficPhase),
  );
  return {
    maximumSustainableRequestsPerSecond:
      sustainableCapacityPhases.at(-1)?.targetRequestsPerSecond ?? null,
    firstUnsustainableRequestsPerSecond:
      firstUnsustainableCapacityPhase?.targetRequestsPerSecond ?? null,
  };
}

interface BuildReportOptions {
  config: HttpLoadTestConfig;
  schema: string;
  durationMs: number;
  phaseDurations: HttpPhaseDurations;
  metrics: ReturnType<HttpMetricsCollector["report"]>;
  snapshotBenchmark: HttpSnapshotBenchmarkReport | null;
  verification: HttpVerificationSummary | null;
  workers: HttpReplicaReport[];
  trafficPhases: HttpTrafficPhaseReport[];
  reportFailure: string | undefined;
  environment: ReturnType<typeof createLoadTestEnvironment>;
  capacity: HttpLoadTestReport["capacity"];
  slo: ReturnType<typeof evaluateHttpSlos>;
}

function buildReport(options: BuildReportOptions): HttpLoadTestReport {
  const {
    config,
    schema,
    durationMs,
    phaseDurations,
    metrics,
    snapshotBenchmark,
    verification,
    workers,
    trafficPhases,
    reportFailure,
    environment,
    capacity,
    slo,
  } = options;
  const workerConnectionCount = config.workerCount * config.poolSize;
  const coordinatorConnectionCount = config.poolSize;
  return {
    status: reportFailure === undefined ? "passed" : "failed",
    ...(reportFailure === undefined ? {} : { failure: reportFailure }),
    environment,
    configuration: config,
    schema,
    workerConnectionCount,
    coordinatorConnectionCount,
    connectionCount: workerConnectionCount + coordinatorConnectionCount,
    durationMs,
    phaseDurations,
    request: metrics.request,
    read: metrics.read,
    deposit: metrics.deposit,
    throughput: {
      durationMs: phaseDurations.httpRequestsMs,
      successfulRequests: metrics.request.succeeded,
      requestsPerSecond:
        phaseDurations.httpRequestsMs === 0
          ? 0
          : metrics.request.succeeded /
            (phaseDurations.httpRequestsMs / MILLISECONDS_PER_SECOND),
    },
    trafficPhases,
    slo,
    capacity,
    snapshotBenchmark,
    errors: metrics.errors,
    verification,
    workers,
  };
}

export function createReport({
  config,
  schema,
  startedAt,
  phaseDurations,
  metrics,
  snapshotBenchmark,
  verification,
  workers,
  trafficPhases = [],
  failure,
  environment,
}: {
  config: HttpLoadTestConfig;
  schema: string;
  startedAt: number;
  phaseDurations: HttpPhaseDurations;
  metrics: ReturnType<HttpMetricsCollector["report"]>;
  snapshotBenchmark: HttpSnapshotBenchmarkReport | null;
  verification: HttpVerificationSummary | null;
  workers: HttpReplicaReport[];
  trafficPhases?: HttpTrafficPhaseReport[];
  failure?: string;
  environment: ReturnType<typeof createLoadTestEnvironment>;
}): HttpLoadTestReport {
  const slo = evaluateHttpSlos({ config, ...metrics });
  const reportFailure =
    failure ??
    (config.enforceSlos && !slo.passed
      ? "Configured HTTP SLO thresholds were exceeded"
      : undefined);
  return buildReport({
    config,
    schema,
    durationMs: performance.now() - startedAt,
    phaseDurations,
    metrics,
    snapshotBenchmark,
    verification,
    workers,
    trafficPhases,
    reportFailure,
    environment,
    capacity: createCapacitySummary({ config, trafficPhases }),
    slo,
  });
}

function formatOptionalValue(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function formatPhase(phase: HttpTrafficPhaseReport): string {
  return `phase ${phase.name}: ${phase.achievedRequestsPerSecond.toFixed(2)} requests/s, p95 ${formatOptionalValue(phase.request.latency.p95)} ms, SLO ${phase.slo.passed ? "passed" : "failed"}`;
}

function formatSnapshotBenchmark(
  benchmark: HttpSnapshotBenchmarkReport,
): string[] {
  return [
    `snapshot history: ${benchmark.historyEventsPerAccount} events/account`,
    `snapshot latency p99 without/with: ${formatOptionalValue(benchmark.withoutSnapshots.p99)}/${formatOptionalValue(benchmark.withSnapshots.p99)} ms`,
    `snapshot p99 improvement: ${benchmark.latencyImprovementPercent.p99 === null ? "n/a" : `${benchmark.latencyImprovementPercent.p99.toFixed(2)}%`}`,
  ];
}

export function formatReport(report: HttpLoadTestReport): string {
  return [
    "Alvyn aggregate HTTP load test",
    `profile: ${report.configuration.profile}`,
    `status: ${report.status}`,
    ...(report.failure === undefined ? [] : [`failure: ${report.failure}`]),
    `workers: ${report.workers.length}`,
    `replica request attempts: ${report.workers.map((worker) => `${worker.workerId}=${worker.requestAttempts}`).join(", ")}`,
    `connections: ${report.connectionCount} (workers: ${report.workerConnectionCount}, coordinator: ${report.coordinatorConnectionCount})`,
    `duration: ${Math.round(report.durationMs)} ms`,
    `HTTP phase: ${Math.round(report.throughput.durationMs)} ms`,
    `HTTP requests: ${report.request.succeeded}/${report.request.attempted}`,
    `reads: ${report.read.succeeded}/${report.read.attempted}`,
    `deposits: ${report.deposit.succeeded}/${report.deposit.attempted}`,
    `OCC conflicts/retries: ${report.deposit.conflicts}/${report.deposit.retries}`,
    `throughput: ${report.throughput.requestsPerSecond.toFixed(2)} requests/s`,
    `latency p50/p95/p99: ${formatOptionalValue(report.request.latency.p50)}/${formatOptionalValue(report.request.latency.p95)}/${formatOptionalValue(report.request.latency.p99)} ms`,
    `SLO: ${report.slo.passed ? "passed" : "failed"}${report.slo.enforced ? " (enforced)" : " (report only)"}`,
    ...report.trafficPhases.map(formatPhase),
    ...(report.capacity === null
      ? []
      : [
          `maximum sustainable capacity: ${report.capacity.maximumSustainableRequestsPerSecond === null ? "not reached" : `${report.capacity.maximumSustainableRequestsPerSecond} requests/s`}`,
          `first unsustainable capacity: ${report.capacity.firstUnsustainableRequestsPerSecond === null ? "not reached" : `${report.capacity.firstUnsustainableRequestsPerSecond} requests/s`}`,
        ]),
    ...(report.snapshotBenchmark === null
      ? []
      : formatSnapshotBenchmark(report.snapshotBenchmark)),
    `verified accounts/source/stored events: ${report.verification === null ? "n/a" : `${report.verification.accountCount}/${report.verification.eventCount}/${report.verification.storedEventCount}`}`,
  ].join("\n");
}
