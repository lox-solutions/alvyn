import { evaluateHttpSlos } from "./evaluate-http-slos";
import { HttpMetricsCollector } from "./http-metrics";
import { runHttpOperation, type SuccessfulDeposit } from "./run-http-operation";
import { createTrafficPhases } from "./create-traffic-phases";
import type { HttpLoadTestConfig, HttpTrafficPhaseReport } from "./http-types";
import { ProgressRenderer } from "./progress";

const MILLISECONDS_PER_SECOND = 1_000;
const PROGRESS_INTERVAL = 100;

interface RunHttpTrafficPhaseOptions {
  trafficPhase: ReturnType<typeof createTrafficPhases>[number];
  config: HttpLoadTestConfig;
  ports: number[];
  progress: ProgressRenderer;
  collector: HttpMetricsCollector;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  replicaRequestAttempts: number[];
  completed: { value: number };
  totalRequests: number;
}

export async function runHttpTrafficPhase(
  options: RunHttpTrafficPhaseOptions,
): Promise<HttpTrafficPhaseReport> {
  const { trafficPhase, config } = options;
  const phaseStartedAt = performance.now();
  const phaseCollector = new HttpMetricsCollector();
  await runTrafficLanes({
    ...options,
    phaseStartedAt,
    phaseCollector,
  });
  await waitForPhaseEnd({
    phaseStartedAt,
    durationMs: trafficPhase.durationMs,
  });
  const durationMs = performance.now() - phaseStartedAt;
  const phaseMetrics = phaseCollector.report();
  return {
    name: trafficPhase.name,
    requestOffset: trafficPhase.requestOffset,
    requestCount: trafficPhase.requestCount,
    targetRequestsPerSecond: trafficPhase.targetRequestsPerSecond,
    durationMs,
    achievedRequestsPerSecond:
      durationMs === 0
        ? 0
        : phaseMetrics.request.succeeded /
          (durationMs / MILLISECONDS_PER_SECOND),
    ...phaseMetrics,
    slo: evaluateHttpSlos({ config, ...phaseMetrics }),
  };
}

async function runTrafficLanes({
  trafficPhase,
  config,
  ports,
  progress,
  collector,
  successfulDeposits,
  replicaRequestAttempts,
  completed,
  totalRequests,
  phaseStartedAt,
  phaseCollector,
}: RunHttpTrafficPhaseOptions & {
  phaseStartedAt: number;
  phaseCollector: HttpMetricsCollector;
}): Promise<void> {
  const state = { nextOperation: 0 };
  await Promise.all(
    Array.from(
      { length: Math.min(config.concurrency, trafficPhase.requestCount) },
      () =>
        runTrafficLane({
          trafficPhase,
          config,
          ports,
          progress,
          collector,
          successfulDeposits,
          replicaRequestAttempts,
          completed,
          totalRequests,
          phaseStartedAt,
          phaseCollector,
          state,
        }),
    ),
  );
}

async function runTrafficLane({
  trafficPhase,
  config,
  ports,
  progress,
  collector,
  successfulDeposits,
  replicaRequestAttempts,
  completed,
  totalRequests,
  phaseStartedAt,
  phaseCollector,
  state,
}: RunHttpTrafficPhaseOptions & {
  phaseStartedAt: number;
  phaseCollector: HttpMetricsCollector;
  state: { nextOperation: number };
}): Promise<void> {
  while (true) {
    const phaseOperationIndex = state.nextOperation++;
    if (phaseOperationIndex >= trafficPhase.requestCount) return;
    await paceHttpOperation({
      phaseStartedAt,
      phaseOperationIndex,
      targetRequestsPerSecond: trafficPhase.targetRequestsPerSecond,
    });
    await runHttpOperation({
      operationIndex: trafficPhase.requestOffset + phaseOperationIndex,
      ports,
      config,
      phaseCollector,
      collector,
      successfulDeposits,
      replicaRequestAttempts,
    });
    completed.value++;
    if (
      completed.value % PROGRESS_INTERVAL === 0 ||
      completed.value === totalRequests
    ) {
      progress.update(
        `${trafficPhase.name}: ${completed.value}/${totalRequests} HTTP requests | concurrency: ${Math.min(config.concurrency, trafficPhase.requestCount)}`,
      );
    }
  }
}

async function paceHttpOperation({
  phaseStartedAt,
  phaseOperationIndex,
  targetRequestsPerSecond,
}: {
  phaseStartedAt: number;
  phaseOperationIndex: number;
  targetRequestsPerSecond: number | null;
}): Promise<void> {
  if (targetRequestsPerSecond === null) return;
  const dueAt =
    phaseStartedAt +
    (phaseOperationIndex / targetRequestsPerSecond) * MILLISECONDS_PER_SECOND;
  const delayMs = dueAt - performance.now();
  if (delayMs <= 0) return;
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

async function waitForPhaseEnd({
  phaseStartedAt,
  durationMs,
}: {
  phaseStartedAt: number;
  durationMs: number;
}): Promise<void> {
  const remainingPhaseMs = phaseStartedAt + durationMs - performance.now();
  if (remainingPhaseMs <= 0) return;
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, remainingPhaseMs);
  });
}
