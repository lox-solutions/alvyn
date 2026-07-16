import type { PoolClient } from "pg";
import type { EventStore } from "../event-store";
import type { ReplayedEvent, StoredEvent } from "../types";
import type {
  SnapshotDefinition,
  SnapshotEncryptionConfig,
  SnapshotHandle,
  SnapshotLoadResult,
  SnapshotUpdateAfterAppendOptions,
} from "./types";
import type { ValidEventMap } from "../valid-event-map";

function createSnapshotHandle<TState, TEvents>(
  def: SnapshotDefinition<TState, TEvents>,
): SnapshotHandle<TState> {
  const {
    streamPrefix,
    snapshotName,
    every,
    initialState,
    evolve,
    encryption,
  } = def;
  const snapshotEventType = `${snapshotName}Snapshot`;
  const buildStreamId = (entityId: string): string =>
    `${streamPrefix}-${entityId}`;
  const evolveMap = evolve as Record<
    string,
    (state: TState, event: ReplayedEvent) => TState
  >;
  const sourceEventTypes = Object.keys(evolveMap);

  return {
    streamPrefix,
    snapshotName,
    snapshotEventType,
    sourceEventTypes,
    load: (eventStore, entityId) =>
      loadSnapshot({
        eventStore,
        streamId: buildStreamId(entityId),
        snapshotEventType,
        initialState,
        evolveMap,
      }),
    updateAfterAppend: (args: SnapshotUpdateAfterAppendOptions) => {
      const { eventStore, streamId, options } = args;
      return updateSnapshotAfterAppend({
        eventStore,
        entityId: streamId.slice(streamPrefix.length + 1),
        streamId,
        snapshotEventType,
        every,
        initialState,
        evolveMap,
        encryption,
        client: options?.client,
      });
    },
  };
}

function isStoredEvent<T>(event: ReplayedEvent<T>): event is StoredEvent<T> {
  return !("tombstoned" in event);
}

async function loadSnapshot<TState>(options: {
  eventStore: EventStore;
  streamId: string;
  snapshotEventType: string;
  initialState: TState;
  evolveMap: Record<string, (state: TState, event: ReplayedEvent) => TState>;
}): Promise<SnapshotLoadResult<TState>> {
  const { eventStore, streamId, snapshotEventType, initialState, evolveMap } =
    options;
  return loadSnapshotState({
    eventStore,
    streamId,
    snapshotEventType,
    initialState,
    evolveMap,
  });
}

async function loadSnapshotState<TState>(options: {
  eventStore: EventStore;
  streamId: string;
  snapshotEventType: string;
  initialState: TState;
  evolveMap: Record<string, (state: TState, event: ReplayedEvent) => TState>;
  client?: PoolClient;
}): Promise<SnapshotLoadResult<TState>> {
  const {
    eventStore,
    streamId,
    snapshotEventType,
    initialState,
    evolveMap,
    client,
  } = options;
  const latestSnapshot = await eventStore.loadLatestEventByType<TState>({
    streamId,
    eventType: snapshotEventType,
    client,
  });
  const snapshotBase = getSnapshotBase(latestSnapshot, initialState);
  const { snapshotVersion } = snapshotBase;
  const replayFromVersion = snapshotVersion === null ? 1 : snapshotVersion + 1;
  const events = await eventStore.loadFrom(streamId, {
    fromVersion: replayFromVersion,
    client,
  });
  const version = events.at(-1)?.streamVersion ?? snapshotVersion ?? 0;
  let state = snapshotBase.state;
  let replayedEvents = 0;

  for (const event of events) {
    const handler = evolveMap[event.type];
    if (!handler) continue;
    state = handler(state, event);
    replayedEvents += 1;
  }
  return {
    state,
    streamId,
    version,
    snapshotVersion,
    replayedEvents,
  };
}

function getSnapshotBase<TState>(
  latestSnapshot: ReplayedEvent<TState> | null,
  initialState: TState,
): { state: TState; snapshotVersion: number | null } {
  if (latestSnapshot && isStoredEvent(latestSnapshot)) {
    return {
      state: latestSnapshot.data,
      snapshotVersion: latestSnapshot.streamVersion,
    };
  }
  return { state: initialState, snapshotVersion: null };
}

async function updateSnapshotAfterAppend<TState>(options: {
  eventStore: EventStore;
  entityId: string;
  streamId: string;
  snapshotEventType: string;
  every: number;
  initialState: TState;
  evolveMap: Record<string, (state: TState, event: ReplayedEvent) => TState>;
  encryption?: SnapshotEncryptionConfig;
  client?: PoolClient;
}): Promise<void> {
  const {
    eventStore,
    entityId,
    streamId,
    snapshotEventType,
    every,
    initialState,
    evolveMap,
    encryption,
    client,
  } = options;
  if (every <= 0) return;

  const result = await loadSnapshotState({
    eventStore,
    streamId,
    snapshotEventType,
    initialState,
    evolveMap,
    client,
  });
  if (result.replayedEvents < every) return;

  await eventStore.appendSnapshot(
    {
      streamId,
      expectedVersion: result.version,
      events: [
        {
          type: snapshotEventType,
          data: result.state,
          encryptedFields: encryption?.encryptedFields,
          cryptoKeyId: encryption?.cryptoKeyId(entityId),
        },
      ],
    },
    { client },
  );
}

/** Defines a typed event-backed snapshot with full TypeScript inference. */
export function defineSnapshot<TState, TEvents>(): (
  definition: [ValidEventMap<TEvents>] extends [never]
    ? never
    : SnapshotDefinition<TState, TEvents>,
) => SnapshotHandle<TState> {
  return (def: SnapshotDefinition<TState, TEvents>) =>
    createSnapshotHandle(def);
}
