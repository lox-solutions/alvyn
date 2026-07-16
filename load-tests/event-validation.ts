import type { ReplayedEvent } from "../src/types";
import type { ExpectedLiveEvent } from "./expected-operations";
import type { LoadTestConfig } from "./types";

const EVENT_TYPE = "LoadTestEvent";
const EVENT_SOURCE = "alvyn-load-test";

interface EventData {
  phase?: unknown;
  seed?: unknown;
  streamIndex?: unknown;
  eventIndex?: unknown;
  token?: unknown;
  workerId?: unknown;
  operationIndex?: unknown;
}

function asEventData({
  data,
  streamId,
  version,
}: {
  data: unknown;
  streamId: string;
  version: number;
}): EventData {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `Invalid load-test event data on ${streamId} version ${version}`,
    );
  }
  return data;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function assertEqual<T>({
  actual,
  expected,
  label,
}: {
  actual: T;
  expected: T;
  label: string;
}): void {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

export function validateSeedEvent({
  data,
  config,
  streamIndex,
  streamId,
  version,
}: {
  data: EventData;
  config: LoadTestConfig;
  streamIndex: number;
  streamId: string;
  version: number;
}): void {
  const eventIndex = version - 1;
  assertEqual({
    actual: eventIndex < config.historyEventsPerStream,
    expected: true,
    label: `seed event position on ${streamId}`,
  });
  assertEqual({
    actual: requireNumber(data.seed, `seed on ${streamId}`),
    expected: config.seed,
    label: `seed on ${streamId}`,
  });
  assertEqual({
    actual: requireNumber(data.streamIndex, `stream index on ${streamId}`),
    expected: streamIndex,
    label: `stream index on ${streamId}`,
  });
  assertEqual({
    actual: requireNumber(data.eventIndex, `seed event index on ${streamId}`),
    expected: eventIndex,
    label: `seed event index on ${streamId}`,
  });
  assertEqual({
    actual: requireString(data.token, `seed token on ${streamId}`),
    expected: `seed:${config.seed}:${streamIndex}:${eventIndex}`,
    label: `seed token on ${streamId}`,
  });
}

export function validateLiveEvent({
  data,
  expectedLiveEvents,
  seenLiveEvents,
  streamId,
  version,
}: {
  data: EventData;
  expectedLiveEvents: Map<string, ExpectedLiveEvent>;
  seenLiveEvents: Set<string>;
  streamId: string;
  version: number;
}): void {
  const token = requireString(
    data.token,
    `live token on ${streamId} version ${version}`,
  );
  const expected = expectedLiveEvents.get(token);
  if (!expected) throw new Error(`Unexpected live event token ${token}`);
  if (seenLiveEvents.has(token)) {
    throw new Error(`Duplicate live event token ${token}`);
  }
  assertEqual({
    actual: expected.streamId,
    expected: streamId,
    label: `stream for live token ${token}`,
  });
  assertEqual({
    actual: requireNumber(data.workerId, `worker for ${token}`),
    expected: expected.workerId,
    label: `worker for ${token}`,
  });
  assertEqual({
    actual: requireNumber(data.operationIndex, `operation for ${token}`),
    expected: expected.operationIndex,
    label: `operation for ${token}`,
  });
  assertEqual({
    actual: requireNumber(data.eventIndex, `event index for ${token}`),
    expected: expected.eventIndex,
    label: `event index for ${token}`,
  });
  seenLiveEvents.add(token);
}

function validateEventMetadata({
  event,
  streamId,
  version,
}: {
  event: ReplayedEvent;
  streamId: string;
  version: number;
}): void {
  assertEqual({
    actual: event.streamId,
    expected: streamId,
    label: "stream id",
  });
  assertEqual({
    actual: event.streamVersion,
    expected: version,
    label: `stream version on ${streamId}`,
  });
  assertEqual({
    actual: event.type,
    expected: EVENT_TYPE,
    label: "event type",
  });
  assertEqual({
    actual: event.source,
    expected: EVENT_SOURCE,
    label: "event source",
  });
}

function validateEventPayload({
  event,
  config,
  streamIndex,
  expectedLiveEvents,
  seenLiveEvents,
  streamId,
  version,
}: {
  event: ReplayedEvent;
  config: LoadTestConfig;
  streamIndex: number;
  expectedLiveEvents: Map<string, ExpectedLiveEvent>;
  seenLiveEvents: Set<string>;
  streamId: string;
  version: number;
}): void {
  if ("tombstoned" in event) {
    throw new Error(`Unexpected tombstone on ${streamId} version ${version}`);
  }
  const data = asEventData({ data: event.data, streamId, version });
  assertEqual({
    actual: requireNumber(data.seed, `seed on ${streamId}`),
    expected: config.seed,
    label: `seed on ${streamId}`,
  });
  if (version <= config.historyEventsPerStream) {
    assertEqual({ actual: data.phase, expected: "seed", label: "event phase" });
    validateSeedEvent({ data, config, streamIndex, streamId, version });
  } else {
    assertEqual({ actual: data.phase, expected: "live", label: "event phase" });
    validateLiveEvent({
      data,
      expectedLiveEvents,
      seenLiveEvents,
      streamId,
      version,
    });
  }
}

export function validateEvent({
  event,
  config,
  streamIndex,
  expectedLiveEvents,
  seenLiveEvents,
  streamId,
  version,
}: {
  event: ReplayedEvent;
  config: LoadTestConfig;
  streamIndex: number;
  expectedLiveEvents: Map<string, ExpectedLiveEvent>;
  seenLiveEvents: Set<string>;
  streamId: string;
  version: number;
}): void {
  validateEventMetadata({ event, streamId, version });
  validateEventPayload({
    event,
    config,
    streamIndex,
    expectedLiveEvents,
    seenLiveEvents,
    streamId,
    version,
  });
}
