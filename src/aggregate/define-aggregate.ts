import type { EventStore } from "../event-store";
import type { ReplayedEvent, Upcaster } from "../types";
import type {
  AggregateDefinition,
  AggregateHandle,
  AggregateInstance,
  AggregateReplayedEvent,
  AggregateStoredEvent,
  EventMap,
} from "./types";
import {
  loadFromReplay,
  loadWithSnapshotSupport,
  mapEventsForAppend,
} from "./aggregate-helpers";

function createAggregateHandle<TState, TEvents extends EventMap>(
  def: AggregateDefinition<TEvents, TState>,
): AggregateHandle<TState, TEvents> {
  const {
    streamPrefix,
    evolve,
    encryption,
    snapshot,
    deserializeSnapshot,
    upcasters,
  } = def;
  const { mapFields, setFields } =
    snapshot && !deserializeSnapshot
      ? {
          mapFields: snapshot.mapFields ?? [],
          setFields: snapshot.setFields ?? [],
        }
      : { mapFields: [] as string[], setFields: [] as string[] };
  const buildStreamId = (entityId: string): string =>
    `${streamPrefix}-${entityId}`;
  const evolveMap = evolve as Record<
    string,
    (s: TState, e: ReplayedEvent) => TState
  >;

  return {
    streamPrefix,
    load: (eventStore: EventStore, entityId: string) =>
      loadAggregate({
        eventStore,
        entityId,
        def,
        buildStreamId,
        evolveMap,
        mapFields,
        setFields,
        snapshot,
      }),
    loadEvents: (eventStore, entityId, maxEvents) =>
      eventStore.load(buildStreamId(entityId), maxEvents) as Promise<
        AggregateReplayedEvent<TEvents>[]
      >,
    append: (eventStore, input) =>
      appendAggregate({ eventStore, input, buildStreamId, encryption }),
    subscribe: (eventStore, entityId, options) =>
      eventStore.subscribe({
        ...options,
        subject: buildStreamId(entityId),
      }) as AsyncIterable<AggregateStoredEvent<TEvents>>,
    getUpcasters: (): Upcaster[] => upcasters ?? [],
  };
}

async function loadAggregate<TState, TEvents extends EventMap>(options: {
  eventStore: EventStore;
  entityId: string;
  def: AggregateDefinition<TEvents, TState>;
  buildStreamId: (id: string) => string;
  evolveMap: Record<string, (s: TState, e: ReplayedEvent) => TState>;
  mapFields: string[];
  setFields: string[];
  snapshot: AggregateDefinition<TEvents, TState>["snapshot"];
}): Promise<AggregateInstance<TState>> {
  const {
    eventStore,
    entityId,
    def,
    buildStreamId,
    evolveMap,
    mapFields,
    setFields,
    snapshot,
  } = options;
  const streamId = buildStreamId(entityId);
  if (snapshot) {
    return loadWithSnapshotSupport({
      eventStore,
      streamId,
      definition: def,
      mapFields,
      setFields,
    });
  }
  return loadFromReplay({
    eventStore,
    streamId,
    evolve: evolveMap,
  });
}

async function appendAggregate<TEvents extends EventMap>(options: {
  eventStore: EventStore;
  input: {
    entityId: string;
    expectedVersion: number;
    events: unknown[];
    outboxTopics?: string[];
  };
  buildStreamId: (id: string) => string;
  encryption: AggregateDefinition<TEvents, unknown>["encryption"];
}): Promise<{ fromVersion: number; toVersion: number }> {
  const { eventStore, input, buildStreamId, encryption } = options;
  const streamId = buildStreamId(input.entityId);
  const result = await eventStore.append({
    streamId,
    expectedVersion: input.expectedVersion,
    outboxTopics: input.outboxTopics,
    events: mapEventsForAppend({
      events: input.events as never[],
      encryption,
      entityId: input.entityId,
    }),
  });
  return { fromVersion: result.fromVersion, toVersion: result.toVersion };
}

/** Defines a typed aggregate with full TypeScript inference. */
export function defineAggregate<TState, TEvents extends EventMap>(): (
  definition: AggregateDefinition<TEvents, TState>,
) => AggregateHandle<TState, TEvents> {
  return (def: AggregateDefinition<TEvents, TState>) =>
    createAggregateHandle(def);
}
