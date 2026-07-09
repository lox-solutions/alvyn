import type { EventStore } from "../event-store";
import type { ReplayedEvent } from "../types";
import type {
  AggregateDefinition,
  AggregateEventInput,
  AggregateInstance,
  EventMap,
} from "./types";

export function restoreSnapshot<T>(options: {
  raw: T;
  mapFields: string[];
  setFields: string[];
}): T {
  const { raw, mapFields, setFields } = options;
  if (mapFields.length === 0 && setFields.length === 0) return raw;

  const restored = { ...(raw as Record<string, unknown>) };

  for (const key of mapFields) {
    const val = restored[key];
    if (val instanceof Map) continue;
    restored[key] = new Map(Object.entries(val ?? {}));
  }

  for (const key of setFields) {
    const val = restored[key];
    if (val instanceof Set) continue;
    restored[key] = new Set(Array.isArray(val) ? val : Object.keys(val ?? {}));
  }

  return restored as T;
}

export function detectCollectionFields(state: Record<string, unknown>): {
  mapFields: string[];
  setFields: string[];
} {
  const mapFields: string[] = [];
  const setFields: string[] = [];
  for (const [key, value] of Object.entries(state)) {
    if (value instanceof Map) mapFields.push(key);
    else if (value instanceof Set) setFields.push(key);
  }
  return { mapFields, setFields };
}

export function applyEvents<TState>(options: {
  state: TState | null;
  events: ReplayedEvent[];
  evolve: Record<string, (state: TState, event: ReplayedEvent) => TState>;
}): TState | null {
  const { events, evolve } = options;
  let current = options.state;
  for (const event of events) {
    const handler = evolve[event.type] as
      | ((state: TState, event: ReplayedEvent) => TState)
      | undefined;
    if (handler) {
      current = handler(current as TState, event);
    }
  }
  return current;
}

export function buildInstance<TState>(options: {
  state: TState | null;
  version: number;
  streamId: string;
}): AggregateInstance<TState> {
  return {
    state: options.state,
    version: options.version,
    streamId: options.streamId,
  };
}

export async function tryAutoSnapshot<TState>(options: {
  eventStore: EventStore;
  streamId: string;
  streamPrefix: string;
  version: number;
  state: TState;
  eventsReplayed: number;
  snapshotEvery: number;
}): Promise<void> {
  const {
    eventStore,
    streamId,
    streamPrefix,
    version,
    state,
    eventsReplayed,
    snapshotEvery,
  } = options;
  if (snapshotEvery <= 0 || eventsReplayed < snapshotEvery) return;
  try {
    await eventStore.saveSnapshot({
      streamId,
      streamVersion: version,
      snapshotType: streamPrefix,
      data: state,
    });
  } catch (error: unknown) {
    // Snapshot save failed — non-fatal. The aggregate state is valid.
    void error;
  }
}

export async function loadWithSnapshotSupport<
  TEvents extends EventMap,
  TState,
>(options: {
  eventStore: EventStore;
  streamId: string;
  definition: AggregateDefinition<TEvents, TState>;
  mapFields: string[];
  setFields: string[];
}): Promise<AggregateInstance<TState>> {
  const { eventStore, streamId, definition, mapFields, setFields } = options;
  const { evolve, snapshot, deserializeSnapshot } = definition;

  const { snapshot: snap, events } =
    await eventStore.loadWithSnapshot(streamId);

  const baseState = resolveBaseState({
    snap,
    deserializeSnapshot,
    mapFields,
    setFields,
  });

  const baseVersion = snap ? snap.streamVersion : 0;
  const state = applyEvents({
    state: baseState,
    events,
    evolve: evolve as Record<string, (s: TState, e: ReplayedEvent) => TState>,
  });
  const version =
    events.length > 0 ? events[events.length - 1].streamVersion : baseVersion;

  await tryAutoSnapshot({
    eventStore,
    streamId,
    streamPrefix: definition.streamPrefix,
    version,
    state,
    eventsReplayed: events.length,
    snapshotEvery: snapshot!.every,
  });

  return buildInstance({ state, version, streamId });
}

function resolveBaseState<TState>(options: {
  snap: { data: unknown; streamVersion: number } | null;
  deserializeSnapshot?: (data: unknown) => TState;
  mapFields: string[];
  setFields: string[];
}): TState | null {
  const { snap, deserializeSnapshot, mapFields, setFields } = options;
  if (!snap) return null;
  if (deserializeSnapshot) return deserializeSnapshot(snap.data);
  return restoreSnapshot({ raw: snap.data as TState, mapFields, setFields });
}

export function mapEventsForAppend<TEvents extends EventMap>(options: {
  events: AggregateEventInput<TEvents>[];
  encryption: AggregateDefinition<TEvents, unknown>["encryption"];
  entityId: string;
}): {
  type: string;
  data: unknown;
  extensions?: Record<string, unknown>;
  schemaVersion?: number;
  encryptedFields?: string[];
  cryptoKeyId?: string;
}[] {
  const { events, encryption, entityId } = options;
  return events.map((e) => {
    const encryptedFields = encryption?.encryptedFields[e.type] ?? undefined;
    const cryptoKeyId =
      encryption && encryptedFields && encryptedFields.length > 0
        ? encryption.cryptoKeyId(entityId)
        : undefined;
    return {
      type: e.type,
      data: e.data,
      extensions: e.extensions,
      schemaVersion: e.schemaVersion,
      encryptedFields,
      cryptoKeyId,
    };
  });
}

export async function loadFromReplay<TState>(options: {
  eventStore: EventStore;
  streamId: string;
  evolve: Record<string, (s: TState, e: ReplayedEvent) => TState>;
}): Promise<AggregateInstance<TState>> {
  const { eventStore, streamId, evolve } = options;
  const events = await eventStore.load(streamId);
  const state = applyEvents({ state: null, events, evolve });
  const version =
    events.length > 0 ? events[events.length - 1].streamVersion : 0;
  return buildInstance({ state, version, streamId });
}
