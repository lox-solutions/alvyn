import {
  HttpLatencyCollector,
  latencyImprovementPercent,
} from "./http-metrics";
import {
  getReplayedEvents,
  readJsonResponse,
  sendHttpAccountRead,
} from "./http-client";
import type {
  HttpLoadTestConfig,
  HttpSnapshotBenchmarkReport,
} from "./http-types";
import { getSnapshotBenchmarkAccountIds } from "./http-seeding";
import { ProgressRenderer } from "./progress";

const HTTP_OK_STATUS = 200;
const SNAPSHOT_PROGRESS_INTERVAL = 100;

interface RunSnapshotLaneOptions {
  config: HttpLoadTestConfig;
  accountIds: string[];
  ports: number[];
  withoutSnapshots: HttpLatencyCollector;
  withSnapshots: HttpLatencyCollector;
  replayedEvents: number[];
  progress: ProgressRenderer;
  state: { nextRequest: number; completed: number };
}

function emptySnapshotBenchmark(
  requestCount: number,
  historyEventsPerAccount: number,
): HttpSnapshotBenchmarkReport {
  const emptyLatency = { count: 0, p50: null, p95: null, p99: null };
  return {
    requestCount,
    historyEventsPerAccount,
    withoutSnapshots: emptyLatency,
    withSnapshots: emptyLatency,
    latencyImprovementPercent: { p50: null, p95: null, p99: null },
    snapshotReplay: {
      count: 0,
      totalEvents: 0,
      averageEvents: null,
      maxEvents: null,
    },
  };
}

async function measureSnapshotRead({
  requestIndex,
  snapshots,
  accountIds,
  ports,
  config,
  withoutSnapshots,
  withSnapshots,
  replayedEvents,
}: {
  requestIndex: number;
  snapshots: boolean;
  accountIds: string[];
  ports: number[];
  config: HttpLoadTestConfig;
  withoutSnapshots: HttpLatencyCollector;
  withSnapshots: HttpLatencyCollector;
  replayedEvents: number[];
}): Promise<void> {
  const accountId = accountIds[requestIndex % accountIds.length];
  const port = ports[requestIndex % ports.length];
  if (accountId === undefined || port === undefined) {
    throw new Error("Snapshot benchmark has no account or worker");
  }
  const startedAt = performance.now();
  const response = await sendHttpAccountRead({
    port,
    accountId,
    snapshots,
    timeoutMs: config.operationTimeoutMs,
  });
  const body = await readJsonResponse(response);
  if (response.status !== HTTP_OK_STATUS) {
    throw new Error(
      `Snapshot benchmark ${snapshots ? "with" : "without"} snapshots failed for ${accountId}: HTTP ${response.status}`,
    );
  }
  const latency = performance.now() - startedAt;
  if (snapshots) {
    withSnapshots.record(latency);
    replayedEvents.push(getReplayedEvents(body));
  } else {
    withoutSnapshots.record(latency);
  }
}

async function runSnapshotLane({
  config,
  accountIds,
  ports,
  withoutSnapshots,
  withSnapshots,
  replayedEvents,
  progress,
  state,
}: RunSnapshotLaneOptions): Promise<void> {
  while (true) {
    const requestIndex = state.nextRequest++;
    if (requestIndex >= config.snapshotBenchmarkRequests) return;
    const firstSnapshots = requestIndex % 2 === 0;
    await measureSnapshotRead({
      requestIndex,
      snapshots: firstSnapshots,
      accountIds,
      ports,
      config,
      withoutSnapshots,
      withSnapshots,
      replayedEvents,
    });
    await measureSnapshotRead({
      requestIndex,
      snapshots: !firstSnapshots,
      accountIds,
      ports,
      config,
      withoutSnapshots,
      withSnapshots,
      replayedEvents,
    });
    state.completed++;
    if (
      state.completed % SNAPSHOT_PROGRESS_INTERVAL === 0 ||
      state.completed === config.snapshotBenchmarkRequests
    ) {
      progress.update(
        `snapshot benchmark: ${state.completed}/${config.snapshotBenchmarkRequests}`,
      );
    }
  }
}

function createSnapshotReport({
  config,
  historyEventsPerAccount,
  withoutSnapshots,
  withSnapshots,
  replayedEvents,
}: {
  config: HttpLoadTestConfig;
  historyEventsPerAccount: number;
  withoutSnapshots: HttpLatencyCollector;
  withSnapshots: HttpLatencyCollector;
  replayedEvents: number[];
}): HttpSnapshotBenchmarkReport {
  const withoutReport = withoutSnapshots.report();
  const withReport = withSnapshots.report();
  const totalEvents = replayedEvents.reduce((total, count) => total + count, 0);
  const replayCount = replayedEvents.length;
  return {
    requestCount: config.snapshotBenchmarkRequests,
    historyEventsPerAccount,
    withoutSnapshots: withoutReport,
    withSnapshots: withReport,
    latencyImprovementPercent: {
      p50: latencyImprovementPercent(withoutReport.p50, withReport.p50),
      p95: latencyImprovementPercent(withoutReport.p95, withReport.p95),
      p99: latencyImprovementPercent(withoutReport.p99, withReport.p99),
    },
    snapshotReplay: {
      count: replayCount,
      totalEvents,
      averageEvents: replayCount === 0 ? null : totalEvents / replayCount,
      maxEvents:
        replayCount === 0
          ? null
          : replayedEvents.reduce(
              (maximum, count) => Math.max(maximum, count),
              0,
            ),
    },
  };
}

export async function runSnapshotBenchmark({
  config,
  ports,
  progress,
}: {
  config: HttpLoadTestConfig;
  ports: number[];
  progress: ProgressRenderer;
}): Promise<HttpSnapshotBenchmarkReport> {
  const historyEventsPerAccount = Math.max(
    config.historyEventsPerAccount,
    config.snapshotBenchmarkHistoryEventsPerAccount,
  );
  if (config.snapshotBenchmarkRequests === 0) {
    return emptySnapshotBenchmark(
      config.snapshotBenchmarkRequests,
      historyEventsPerAccount,
    );
  }
  const accountIds = getSnapshotBenchmarkAccountIds(config);
  const withoutSnapshots = new HttpLatencyCollector();
  const withSnapshots = new HttpLatencyCollector();
  const replayedEvents: number[] = [];
  const state = { nextRequest: 0, completed: 0 };
  await Promise.all(
    Array.from(
      {
        length: Math.min(config.concurrency, config.snapshotBenchmarkRequests),
      },
      () =>
        runSnapshotLane({
          config,
          accountIds,
          ports,
          withoutSnapshots,
          withSnapshots,
          replayedEvents,
          progress,
          state,
        }),
    ),
  );
  return createSnapshotReport({
    config,
    historyEventsPerAccount,
    withoutSnapshots,
    withSnapshots,
    replayedEvents,
  });
}
