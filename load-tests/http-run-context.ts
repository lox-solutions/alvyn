import { randomBytes } from "node:crypto";
import type {
  HttpLoadTestConfig,
  HttpPhaseDurations,
  HttpSnapshotBenchmarkReport,
  HttpTrafficPhaseReport,
  HttpVerificationSummary,
} from "./http-types";
import { HttpMetricsCollector } from "./http-metrics";
import { createLoadTestEnvironment } from "./provenance";
import type { EventStore } from "../src/event-store";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type pg from "pg";
import type { HttpWorkerHandle } from "./http-worker-process";
import { ProgressRenderer } from "./progress";

const SCHEMA_RANDOM_BYTES = 8;

export interface HttpRunContext {
  config: HttpLoadTestConfig;
  schema: string;
  startedAt: number;
  progress: ProgressRenderer;
  phaseDurations: HttpPhaseDurations;
  workers: HttpWorkerHandle[];
  container: StartedPostgreSqlContainer | null;
  coordinatorPool: pg.Pool | null;
  eventStore: EventStore | null;
  environment: ReturnType<typeof createLoadTestEnvironment>;
  ports: number[];
  metrics: ReturnType<HttpMetricsCollector["report"]>;
  trafficPhases: HttpTrafficPhaseReport[];
  replicaRequestAttempts: number[];
  snapshotBenchmark: HttpSnapshotBenchmarkReport | null;
  verification: HttpVerificationSummary | null;
  reportWritten: boolean;
}

export function createHttpRunContext(
  config: HttpLoadTestConfig,
): HttpRunContext {
  return {
    config,
    schema: `http_load_${randomBytes(SCHEMA_RANDOM_BYTES).toString("hex")}`,
    startedAt: performance.now(),
    progress: new ProgressRenderer(config.verbose),
    phaseDurations: {
      setupMs: 0,
      seedingMs: 0,
      workerStartupMs: 0,
      snapshotBenchmarkMs: 0,
      httpRequestsMs: 0,
      verificationMs: 0,
    },
    workers: [],
    container: null,
    coordinatorPool: null,
    eventStore: null,
    environment: createLoadTestEnvironment(null),
    ports: [],
    metrics: new HttpMetricsCollector().report(),
    trafficPhases: [],
    replicaRequestAttempts: Array.from({ length: config.workerCount }, () => 0),
    snapshotBenchmark: null,
    verification: null,
    reportWritten: false,
  };
}
