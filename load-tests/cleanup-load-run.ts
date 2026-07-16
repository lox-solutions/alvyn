import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type pg from "pg";
import { terminateWorkers, type WorkerHandle } from "./worker-process";
import { ProgressRenderer } from "./progress";

export async function cleanupLoadRun({
  runSignal,
  abortRun,
  progress,
  workers,
  coordinatorPool,
  container,
}: {
  runSignal: AbortSignal;
  abortRun: () => void;
  progress: ProgressRenderer;
  workers: WorkerHandle[];
  coordinatorPool: pg.Pool | null;
  container: StartedPostgreSqlContainer | null;
}): Promise<void> {
  runSignal.removeEventListener("abort", abortRun);
  progress.finish();
  await terminateWorkers(workers);
  await Promise.allSettled(workers.map((worker) => worker.ready));
  await Promise.allSettled(workers.map((worker) => worker.completed));
  try {
    if (coordinatorPool) await coordinatorPool.end();
  } finally {
    if (container) await container.stop();
  }
}
