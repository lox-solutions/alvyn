import type { HttpLoadTestConfig, HttpTrafficPhasePlan } from "./http-types";

const MILLISECONDS_PER_SECOND = 1_000;

function phase(
  name: string,
  requestOffset: number,
  requestCount: number,
  durationMs: number,
): HttpTrafficPhasePlan {
  return {
    name,
    requestOffset,
    requestCount,
    durationMs,
    targetRequestsPerSecond:
      durationMs === 0
        ? null
        : requestCount / (durationMs / MILLISECONDS_PER_SECOND),
  };
}

function createDailyPhases(config: HttpLoadTestConfig): HttpTrafficPhasePlan[] {
  const durationMs = config.durationSeconds * MILLISECONDS_PER_SECOND;
  const offPeakRequests = Math.floor(config.requestCount * 0.1);
  const peakRequests = Math.floor(config.requestCount * 0.8);
  const coolDownRequests = config.requestCount - offPeakRequests - peakRequests;
  const offPeakDuration = Math.floor(durationMs * 0.2);
  const peakDuration = Math.floor(durationMs * 0.6);
  const coolDownDuration = durationMs - offPeakDuration - peakDuration;
  return [
    phase("off-peak", 0, offPeakRequests, offPeakDuration),
    phase("peak", offPeakRequests, peakRequests, peakDuration),
    phase(
      "cool-down",
      offPeakRequests + peakRequests,
      coolDownRequests,
      coolDownDuration,
    ),
  ];
}

function createCapacityPhases(
  config: HttpLoadTestConfig,
): HttpTrafficPhasePlan[] {
  const phases: HttpTrafficPhasePlan[] = [];
  let requestOffset = 0;
  for (
    let target = config.capacityStartRequestsPerSecond;
    target <= config.capacityMaxRequestsPerSecond;
    target += config.capacityStepRequestsPerSecond
  ) {
    const requestCount = Math.round(target * config.capacityStageSeconds);
    phases.push(
      phase(
        `capacity-${target}-rps`,
        requestOffset,
        requestCount,
        config.capacityStageSeconds * MILLISECONDS_PER_SECOND,
      ),
    );
    requestOffset += requestCount;
  }
  return phases;
}

export function createTrafficPhases(
  config: HttpLoadTestConfig,
): HttpTrafficPhasePlan[] {
  if (config.profile === "daily") return createDailyPhases(config);
  if (config.profile === "capacity") return createCapacityPhases(config);
  return [phase("custom", 0, config.requestCount, 0)];
}
