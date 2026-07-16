import { getExpectedWorkloadOperation } from "./workload";
import type { LoadTestConfig } from "./types";

export interface ExpectedLiveEvent {
  streamId: string;
  workerId: number;
  operationIndex: number;
  eventIndex: number;
}

export interface ExpectedOperations {
  appendOperations: number;
  loadOperations: number;
  liveEventCount: number;
  liveEvents: Map<string, ExpectedLiveEvent>;
}

export function expectedOperations(config: LoadTestConfig): ExpectedOperations {
  let appendOperations = 0;
  let loadOperations = 0;
  const liveEvents = new Map<string, ExpectedLiveEvent>();

  for (let workerId = 0; workerId < config.workerCount; workerId++) {
    for (
      let operationIndex = 0;
      operationIndex < config.operationsPerWorker;
      operationIndex++
    ) {
      const operation = getExpectedWorkloadOperation({
        config,
        workerId,
        operationIndex,
      });
      if (!operation.append) {
        loadOperations++;
        continue;
      }

      appendOperations++;
      for (
        let eventIndex = 0;
        eventIndex < config.appendBatchSize;
        eventIndex++
      ) {
        liveEvents.set(`${operation.operationToken}:${eventIndex}`, {
          streamId: operation.streamId,
          workerId,
          operationIndex,
          eventIndex,
        });
      }
    }
  }

  return {
    appendOperations,
    loadOperations,
    liveEventCount: liveEvents.size,
    liveEvents,
  };
}
