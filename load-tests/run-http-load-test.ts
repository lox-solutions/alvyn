import { withTimeout } from "./timeout";
import type { HttpLoadTestConfig, HttpLoadTestReport } from "./http-types";
import { executeHttpLoadTest } from "./execute-http-load-test";

export async function runHttpLoadTest(
  config: HttpLoadTestConfig,
  runSignal?: AbortSignal,
): Promise<HttpLoadTestReport> {
  const controller = new AbortController();
  const signal = runSignal ?? controller.signal;
  return withTimeout({
    operation: executeHttpLoadTest(config, signal),
    timeoutMs: config.runTimeoutMs,
    label: "HTTP load-test run",
    onTimeout: () => controller.abort(),
  });
}
