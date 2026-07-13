import type { AppendEventInput } from "../types";
import type { LoadTestConfig } from "./types";

const EVENT_TYPE = "LoadTestEvent";
const EVENT_SOURCE = "alvyn-load-test";
const TOKEN_SEPARATOR = ":";

function createToken(parts: string[]): string {
  return parts.join(TOKEN_SEPARATOR);
}

function createLiveEvent({
  config,
  workerId,
  operationIndex,
  eventIndex,
  operationToken,
}: {
  config: LoadTestConfig;
  workerId: number;
  operationIndex: number;
  eventIndex: number;
  operationToken: string;
}): AppendEventInput {
  return {
    type: EVENT_TYPE,
    source: EVENT_SOURCE,
    data: {
      phase: "live",
      seed: config.seed,
      workerId,
      operationIndex,
      eventIndex,
      token: createToken([operationToken, String(eventIndex)]),
    },
  };
}

export function createLiveEvents({
  config,
  workerId,
  operationIndex,
  operationToken,
}: {
  config: LoadTestConfig;
  workerId: number;
  operationIndex: number;
  operationToken: string;
}): AppendEventInput[] {
  return Array.from({ length: config.appendBatchSize }, (_, eventIndex) =>
    createLiveEvent({
      config,
      workerId,
      operationIndex,
      eventIndex,
      operationToken,
    }),
  );
}
