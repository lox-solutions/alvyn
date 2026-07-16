import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseHttpLoadTestConfig } from "./parse-http-load-test-config";
import { createReport, formatReport, writeReport } from "./http-report";
import { runHttpLoadTest } from "./run-http-load-test";
import { getHttpWorkerIndex, retryHttpRequest } from "./http-retry";
import { serializeError } from "./serialize-error";

export {
  createReport,
  formatReport,
  getHttpWorkerIndex,
  retryHttpRequest,
  runHttpLoadTest,
  writeReport,
};

export async function main(): Promise<void> {
  const config = parseHttpLoadTestConfig();
  const report = await runHttpLoadTest(config);
  console.log(formatReport(report));
  if (report.status === "failed") throw new Error(report.failure);
}

const isMainModule =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  await main().catch((error: unknown) => {
    console.error(serializeError(error));
    process.exitCode = 1;
  });
}
