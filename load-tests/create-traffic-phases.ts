import type { HttpLoadTestConfig, HttpTrafficPhasePlan } from "./http-types";

const MILLISECONDS_PER_SECOND = 1_000;
const OFF_PEAK_REQUEST_FRACTION = 0.1;
const PEAK_REQUEST_FRACTION = 0.8;
const OFF_PEAK_DURATION_FRACTION = 0.2;
const PEAK_DURATION_FRACTION = 0.6;

function createPhase({
  name,
  requestOffset,
  requestCount,
  durationMs,
}: {
  name: string;
  requestOffset: number;
  requestCount: number;
  durationMs: number;
}): HttpTrafficPhasePlan {
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
  const offPeakRequests = Math.floor(
    config.requestCount * OFF_PEAK_REQUEST_FRACTION,
  );
  const peakRequests = Math.floor(config.requestCount * PEAK_REQUEST_FRACTION);
  const coolDownRequests = config.requestCount - offPeakRequests - peakRequests;
  const offPeakDuration = Math.floor(durationMs * OFF_PEAK_DURATION_FRACTION);
  const peakDuration = Math.floor(durationMs * PEAK_DURATION_FRACTION);
  const coolDownDuration = durationMs - offPeakDuration - peakDuration;
  return [
    createPhase({
      name: "off-peak",
      requestOffset: 0,
      requestCount: offPeakRequests,
      durationMs: offPeakDuration,
    }),
    createPhase({
      name: "peak",
      requestOffset: offPeakRequests,
      requestCount: peakRequests,
      durationMs: peakDuration,
    }),
    createPhase({
      name: "cool-down",
      requestOffset: offPeakRequests + peakRequests,
      requestCount: coolDownRequests,
      durationMs: coolDownDuration,
    }),
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
      createPhase({
        name: `capacity-${target}-rps`,
        requestOffset,
        requestCount,
        durationMs: config.capacityStageSeconds * MILLISECONDS_PER_SECOND,
      }),
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
  return [
    createPhase({
      name: "custom",
      requestOffset: 0,
      requestCount: config.requestCount,
      durationMs: 0,
    }),
  ];
}
