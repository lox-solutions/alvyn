import { HttpMetricsCollector } from "./http-metrics";
import { createTrafficPhases } from "./create-traffic-phases";
import { runHttpTrafficPhase } from "./run-http-traffic-phase";
import type { SuccessfulDeposit } from "./run-http-operation";
import type { HttpLoadTestConfig, HttpTrafficPhaseReport } from "./http-types";
import { ProgressRenderer } from "./progress";

interface HttpRequestRunResult {
  metrics: ReturnType<HttpMetricsCollector["report"]>;
  successfulDeposits: Map<string, SuccessfulDeposit>;
  trafficPhases: HttpTrafficPhaseReport[];
  replicaRequestAttempts: number[];
  durationMs: number;
}

export async function runHttpRequests({
  config,
  ports,
  progress,
}: {
  config: HttpLoadTestConfig;
  ports: number[];
  progress: ProgressRenderer;
}): Promise<HttpRequestRunResult> {
  const startedAt = performance.now();
  const collector = new HttpMetricsCollector();
  const successfulDeposits = new Map<string, SuccessfulDeposit>();
  const replicaRequestAttempts = ports.map(() => 0);
  const plans = createTrafficPhases(config);
  const totalRequests = plans.reduce(
    (total, trafficPhase) => total + trafficPhase.requestCount,
    0,
  );
  const completed = { value: 0 };
  const trafficPhases: HttpTrafficPhaseReport[] = [];
  for (const trafficPhase of plans) {
    trafficPhases.push(
      await runHttpTrafficPhase({
        trafficPhase,
        config,
        ports,
        progress,
        collector,
        successfulDeposits,
        replicaRequestAttempts,
        completed,
        totalRequests,
      }),
    );
  }
  return {
    metrics: collector.report(),
    successfulDeposits,
    trafficPhases,
    replicaRequestAttempts,
    durationMs: performance.now() - startedAt,
  };
}
