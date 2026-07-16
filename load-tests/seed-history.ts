import { EventStore } from "../src/event-store";
import type { AppendEventInput } from "../src/types";
import { getStreamIds } from "./workload";
import type { LoadTestConfig } from "./types";

const EVENT_TYPE = "LoadTestEvent";
const EVENT_SOURCE = "alvyn-load-test";
const TOKEN_SEPARATOR = ":";

export interface SeedSummary {
  streamIds: string[];
  eventCount: number;
}

export interface SeedProgress {
  streamIndex: number;
  streamCount: number;
  eventCount: number;
  totalEventCount: number;
}

function createSeedEvent({
  config,
  streamIndex,
  eventIndex,
}: {
  config: LoadTestConfig;
  streamIndex: number;
  eventIndex: number;
}): AppendEventInput {
  return {
    type: EVENT_TYPE,
    source: EVENT_SOURCE,
    data: {
      phase: "seed",
      seed: config.seed,
      streamIndex,
      eventIndex,
      token: [
        "seed",
        String(config.seed),
        String(streamIndex),
        String(eventIndex),
      ].join(TOKEN_SEPARATOR),
    },
  };
}

export async function seedHistory({
  eventStore,
  config,
  onProgress,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  onProgress?: (progress: SeedProgress) => void | Promise<void>;
}): Promise<SeedSummary> {
  const streamIds = getStreamIds(config);
  const totalEventCount = config.streamCount * config.historyEventsPerStream;
  let eventCount = 0;
  for (const [streamIndex, streamId] of streamIds.entries()) {
    for (
      let eventIndex = 0;
      eventIndex < config.historyEventsPerStream;
      eventIndex += config.appendBatchSize
    ) {
      const eventBatch = Array.from(
        {
          length: Math.min(
            config.appendBatchSize,
            config.historyEventsPerStream - eventIndex,
          ),
        },
        (_, batchIndex) =>
          createSeedEvent({
            config,
            streamIndex,
            eventIndex: eventIndex + batchIndex,
          }),
      );
      await eventStore.append({
        streamId,
        expectedVersion: eventIndex === 0 ? -1 : eventIndex,
        events: eventBatch,
      });
      eventCount += eventBatch.length;
      await onProgress?.({
        streamIndex,
        streamCount: streamIds.length,
        eventCount,
        totalEventCount,
      });
    }
  }
  return { streamIds, eventCount };
}
