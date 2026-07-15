import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, parseLoadTestConfig } from "./config";
import {
  DEFAULT_HTTP_LOAD_TEST_CONFIG,
  parseHttpLoadTestConfig,
} from "./http-config";
import { HttpLatencyCollector, HttpMetricsCollector } from "./http-metrics";
import { validateHttpOperationResponse } from "./http-response-validation";
import { createReport, retryHttpRequest } from "./http-runner";
import { evaluateHttpSlos } from "./http-slo";
import { createTrafficPhases } from "./http-traffic";
import { getExpectedHttpOperation } from "./http-workload";
import { MetricsCollector, buildAggregateReport } from "./metrics";
import { createLoadTestEnvironment } from "./provenance";
import { withTimeout } from "./timeout";

describe("load-test configuration", () => {
  it("parses explicit timeout options for the direct harness", () => {
    const config = parseLoadTestConfig(
      [
        "--operation-timeout-ms",
        "1234",
        "--worker-ready-timeout-ms",
        "2345",
        "--run-timeout-ms",
        "3456",
      ],
      {},
    );

    expect(config).toMatchObject({
      operationTimeoutMs: 1234,
      workerReadyTimeoutMs: 2345,
      runTimeoutMs: 3456,
    });
  });

  it("rejects non-positive timeout options", () => {
    expect(() =>
      parseHttpLoadTestConfig(["--operation-timeout-ms", "0"], {}),
    ).toThrow("operation-timeout-ms must be an integer >= 1");
  });

  it("keeps defaults internally consistent", () => {
    expect(DEFAULT_CONFIG.runTimeoutMs).toBeGreaterThan(
      DEFAULT_CONFIG.operationTimeoutMs,
    );
    expect(DEFAULT_HTTP_LOAD_TEST_CONFIG.runTimeoutMs).toBeGreaterThan(
      DEFAULT_HTTP_LOAD_TEST_CONFIG.operationTimeoutMs,
    );
  });
});

describe("HTTP response validation", () => {
  const readOperation = {
    ...getExpectedHttpOperation({
      config: { ...DEFAULT_HTTP_LOAD_TEST_CONFIG, readPercent: 100 },
      operationIndex: 0,
    }),
    kind: "read" as const,
  };

  it("accepts a valid aggregate response", () => {
    expect(() =>
      validateHttpOperationResponse(readOperation, {
        streamId: `LoadTestAccount-${readOperation.accountId}`,
        version: 20,
        state: {
          status: "open",
          balance: 19,
          depositCount: 19,
          depositTotal: 19,
        },
      }),
    ).not.toThrow();
  });

  it("rejects a 200 read body for the wrong account", () => {
    expect(() =>
      validateHttpOperationResponse(readOperation, {
        streamId: "LoadTestAccount-wrong-account",
        version: 20,
        state: {
          status: "open",
          balance: 19,
          depositCount: 19,
          depositTotal: 19,
        },
      }),
    ).toThrow("streamId mismatch");
  });

  it("rejects malformed read state and version values", () => {
    expect(() =>
      validateHttpOperationResponse(readOperation, {
        streamId: `LoadTestAccount-${readOperation.accountId}`,
        version: -1,
        state: {
          status: "closed",
          balance: Number.NaN,
          depositCount: 19,
          depositTotal: 19,
        },
      }),
    ).toThrow();
  });

  it("rejects internally inconsistent finite balance and version values", () => {
    expect(() =>
      validateHttpOperationResponse(readOperation, {
        streamId: `LoadTestAccount-${readOperation.accountId}`,
        version: 18,
        state: {
          status: "open",
          balance: 18,
          depositCount: 19,
          depositTotal: 19,
        },
      }),
    ).toThrow("version mismatch");
    expect(() =>
      validateHttpOperationResponse(readOperation, {
        streamId: `LoadTestAccount-${readOperation.accountId}`,
        version: 20,
        state: {
          status: "open",
          balance: 18,
          depositCount: 19,
          depositTotal: 19,
        },
      }),
    ).toThrow("balance mismatch");
  });

  it("validates successful deposit identity and version range", () => {
    const depositOperation = {
      ...readOperation,
      kind: "deposit" as const,
      amount: 7,
      operationToken: "http:1:0",
    };

    expect(() =>
      validateHttpOperationResponse(depositOperation, {
        accountId: depositOperation.accountId,
        amount: depositOperation.amount,
        operationToken: depositOperation.operationToken,
        fromVersion: 21,
        toVersion: 21,
      }),
    ).not.toThrow();
    expect(() =>
      validateHttpOperationResponse(depositOperation, {
        accountId: depositOperation.accountId,
        amount: 99,
        operationToken: depositOperation.operationToken,
        fromVersion: 21,
        toVersion: 21,
      }),
    ).toThrow("amount mismatch");
    expect(() =>
      validateHttpOperationResponse(depositOperation, {
        accountId: depositOperation.accountId,
        amount: depositOperation.amount,
        operationToken: depositOperation.operationToken,
        fromVersion: 20,
        toVersion: 21,
      }),
    ).toThrow("version range");
  });
});

describe("load-test timeouts", () => {
  it("rejects a hung operation with a descriptive error", async () => {
    vi.useFakeTimers();
    try {
      const operation = withTimeout(
        new Promise<never>(() => undefined),
        50,
        "read",
      );
      const assertion = expect(operation).rejects.toThrow(
        "read timed out after 50 ms",
      );
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns completed operations and clears their deadline", async () => {
    await expect(withTimeout(Promise.resolve(42), 50, "read")).resolves.toBe(
      42,
    );
  });
});

describe("HTTP metrics and SLOs", () => {
  it("reports deterministic percentiles and bounded sample counts", () => {
    const latencies = new HttpLatencyCollector();
    for (let value = 1; value <= 10_500; value++) latencies.record(value);

    const report = latencies.report();
    expect(report.count).toBe(10_000);
    expect(report.p50).not.toBeNull();
    expect(report.p95).toBeGreaterThan(report.p50!);
    expect(report.p99).toBeGreaterThan(report.p95!);
  });

  it("aggregates retries, failures, and error diagnostics", () => {
    const metrics = new HttpMetricsCollector();
    metrics.record({
      kind: "deposit",
      succeeded: false,
      latencyMs: 12,
      conflicts: 2,
      retries: 2,
      error: "exhausted",
    });

    expect(metrics.report()).toMatchObject({
      request: { attempted: 1, failed: 1, conflicts: 2, retries: 2 },
      deposit: { attempted: 1, failed: 1 },
      errors: ["exhausted"],
    });
  });

  it("passes an error rate exactly equal to the configured SLO", () => {
    const operation = {
      attempted: 1_000,
      succeeded: 999,
      failed: 1,
      conflicts: 0,
      retries: 0,
      latency: { count: 1, p50: 1, p95: 1, p99: 1 },
    };
    const report = evaluateHttpSlos({
      config: DEFAULT_HTTP_LOAD_TEST_CONFIG,
      request: operation,
      read: operation,
      deposit: operation,
    });

    expect(
      report.checks.find((check) => check.metric === "error_rate_percent"),
    ).toMatchObject({ actual: 0.1, threshold: 0.1, passed: true });
  });
});

describe("HTTP workload planning", () => {
  it("reproduces operation identity from the same seed and index", () => {
    const config = { ...DEFAULT_HTTP_LOAD_TEST_CONFIG, seed: 42 };
    expect(getExpectedHttpOperation({ config, operationIndex: 17 })).toEqual(
      getExpectedHttpOperation({ config, operationIndex: 17 }),
    );
  });

  it("partitions daily traffic without losing requests or duration", () => {
    const config = {
      ...DEFAULT_HTTP_LOAD_TEST_CONFIG,
      profile: "daily" as const,
      requestCount: 101,
      durationSeconds: 10,
    };
    const phases = createTrafficPhases(config);

    expect(phases.map((phase) => phase.name)).toEqual([
      "off-peak",
      "peak",
      "cool-down",
    ]);
    expect(phases.reduce((total, phase) => total + phase.requestCount, 0)).toBe(
      101,
    );
    expect(phases.reduce((total, phase) => total + phase.durationMs, 0)).toBe(
      10_000,
    );
    expect(phases[1]!.requestOffset).toBe(phases[0]!.requestCount);
  });
});

describe("retry and report accounting", () => {
  it("counts conflicts and retries without retrying beyond the limit", async () => {
    const attempts: number[] = [];
    const result = await retryHttpRequest({
      operationIndex: 3,
      maxRetries: 2,
      send: async (attempt) => {
        attempts.push(attempt);
        return { status: attempt < 2 ? 409 : 201 };
      },
      isConflict: (response) => response.status === 409,
      wait: async () => undefined,
    });

    expect(attempts).toEqual([0, 1, 2]);
    expect(result).toMatchObject({ conflicts: 2, retries: 2 });
  });

  it("aggregates direct worker metrics and throughput", () => {
    const collector = new MetricsCollector(0);
    collector.recordAppendAttempt();
    collector.recordAppendConflict();
    collector.recordAppendSuccess(10, 2);
    collector.recordLoadAttempt();
    collector.recordLoadFailure(20, new Error("broken read"));

    const report = buildAggregateReport({
      workers: [collector.toMetrics()],
      durationMs: 1_000,
    });
    expect(report).toMatchObject({
      append: { attempted: 1, succeeded: 1, conflicts: 1, retries: 1 },
      load: { attempted: 1, failed: 1 },
      throughput: { operationsPerSecond: 1, appendEventsPerSecond: 2 },
      errors: ["broken read"],
    });
  });

  it("produces a diagnostic failed HTTP report", () => {
    const metrics = new HttpMetricsCollector().report();
    const report = createReport({
      config: DEFAULT_HTTP_LOAD_TEST_CONFIG,
      schema: "http_load_test",
      startedAt: performance.now(),
      phaseDurations: {
        setupMs: 1,
        seedingMs: 0,
        workerStartupMs: 0,
        snapshotBenchmarkMs: 0,
        httpRequestsMs: 0,
        verificationMs: 0,
      },
      metrics,
      snapshotBenchmark: null,
      verification: null,
      workers: [],
      failure: "worker crashed",
      environment: createLoadTestEnvironment("16.4"),
    });

    expect(report).toMatchObject({
      status: "failed",
      failure: "worker crashed",
      environment: { postgresqlVersion: "16.4" },
      verification: null,
    });
  });
});
