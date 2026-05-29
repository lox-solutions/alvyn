import type { EventStore } from "../event-store";
import type { ReplayedEvent, Upcaster } from "../types";
import type {
  AggregateDefinition,
  AggregateHandle,
  AggregateInstance,
  EventMap,
} from "./types";
import {
  detectCollectionFields,
  loadFromReplay,
  loadWithSnapshotSupport,
  mapEventsForAppend,
} from "./aggregate-helpers";

function createAggregateHandle<TEvents extends EventMap, TState>(
  def: AggregateDefinition<TEvents, TState>,
): AggregateHandle<TEvents, TState> {
  const {
    streamPrefix,
    initialState,
    evolve,
    encryption,
    snapshot,
    deserializeSnapshot,
    upcasters,
  } = def;
  const { mapFields, setFields } =
    snapshot && !deserializeSnapshot
      ? detectCollectionFields(initialState() as Record<string, unknown>)
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
    append: (eventStore, input) =>
      appendAggregate({ eventStore, input, buildStreamId, encryption }),
    getUpcasters: (): Upcaster[] => upcasters ?? [],
  };
}

async function loadAggregate<TEvents extends EventMap, TState>(options: {
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
    initialState: def.initialState,
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
export function defineAggregate<TEvents extends EventMap>(): <TState>(
  definition: AggregateDefinition<TEvents, TState>,
) => AggregateHandle<TEvents, TState> {
  return <TState>(def: AggregateDefinition<TEvents, TState>) =>
    createAggregateHandle(def);
}
