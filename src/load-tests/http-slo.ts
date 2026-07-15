import type {
  HttpLoadTestConfig,
  HttpOperationReport,
  HttpSloReport,
} from "./http-types";

export function evaluateHttpSlos({
  config,
  request,
  read,
  deposit,
}: {
  config: HttpLoadTestConfig;
  request: HttpOperationReport;
  read: HttpOperationReport;
  deposit: HttpOperationReport;
}): HttpSloReport {
  const errorRatePercent =
    request.attempted === 0 ? 0 : (request.failed / request.attempted) * 100;
  const checks: HttpSloReport["checks"] = [
    {
      metric: "read_p95_ms",
      actual: read.latency.p95,
      threshold: config.sloReadP95Ms,
      passed:
        read.latency.p95 === null || read.latency.p95 <= config.sloReadP95Ms,
    },
    {
      metric: "deposit_p95_ms",
      actual: deposit.latency.p95,
      threshold: config.sloDepositP95Ms,
      passed:
        deposit.latency.p95 === null ||
        deposit.latency.p95 <= config.sloDepositP95Ms,
    },
    {
      metric: "error_rate_percent",
      actual: errorRatePercent,
      threshold: config.sloErrorRatePercent,
      passed: errorRatePercent <= config.sloErrorRatePercent,
    },
  ];
  return {
    enforced: config.enforceSlos,
    passed: checks.every((check) => check.passed),
    checks,
  };
}
