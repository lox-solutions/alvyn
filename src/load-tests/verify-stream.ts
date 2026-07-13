import { EventStore } from "../event-store";
import type { ExpectedLiveEvent } from "./expected-operations";
import type { LoadTestConfig } from "./types";
import { validateEvent } from "./event-validation";
const PAGE_SIZE = 1_000;

export interface StreamVerificationProgress {
  streamId: string;
  eventCount: number;
  totalEventCount: number;
}

async function reportProgress({
  onProgress,
  streamId,
  eventCount,
  totalEventCount,
}: {
  onProgress?: (progress: StreamVerificationProgress) => void | Promise<void>;
  streamId: string;
  eventCount: number;
  totalEventCount: number;
}): Promise<void> {
  await onProgress?.({ streamId, eventCount, totalEventCount });
}

async function verifyPage({
  eventStore,
  config,
  streamId,
  streamIndex,
  expectedLiveEvents,
  seenLiveEvents,
  fromVersion,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  streamId: string;
  streamIndex: number;
  expectedLiveEvents: Map<string, ExpectedLiveEvent>;
  seenLiveEvents: Set<string>;
  fromVersion: number;
}): Promise<number> {
  const events = await eventStore.loadFrom(streamId, {
    fromVersion,
    maxEvents: PAGE_SIZE,
  });
  if (events.length === 0) {
    throw new Error(
      `Missing events on ${streamId} from version ${fromVersion}`,
    );
  }
  for (const [eventIndex, event] of events.entries()) {
    validateEvent({
      event,
      config,
      streamIndex,
      expectedLiveEvents,
      seenLiveEvents,
      streamId,
      version: fromVersion + eventIndex,
    });
  }
  return events.length;
}

export async function verifyStream({
  eventStore,
  config,
  streamId,
  streamIndex,
  expectedLiveEvents,
  seenLiveEvents,
  onProgress,
}: {
  eventStore: EventStore;
  config: LoadTestConfig;
  streamId: string;
  streamIndex: number;
  expectedLiveEvents: Map<string, ExpectedLiveEvent>;
  seenLiveEvents: Set<string>;
  onProgress?: (progress: StreamVerificationProgress) => void | Promise<void>;
}): Promise<number> {
  const finalVersion = await eventStore.getStreamVersion(streamId);
  let nextVersion = 1;
  let eventCount = 0;

  while (nextVersion <= finalVersion) {
    const pageEventCount = await verifyPage({
      eventStore,
      config,
      streamId,
      streamIndex,
      expectedLiveEvents,
      seenLiveEvents,
      fromVersion: nextVersion,
    });
    nextVersion += pageEventCount;
    eventCount += pageEventCount;
    await reportProgress({
      onProgress,
      streamId,
      eventCount,
      totalEventCount: finalVersion,
    });
  }

  if (finalVersion !== eventCount) {
    throw new Error(
      `final version on ${streamId} mismatch: expected ${eventCount}, got ${finalVersion}`,
    );
  }
  return eventCount;
}
