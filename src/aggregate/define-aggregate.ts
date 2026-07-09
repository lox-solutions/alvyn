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
import { loadFromReplay, mapEventsForAppend } from "./aggregate-helpers";

function createAggregateHandle<TState, TEvents extends EventMap>(
  def: AggregateDefinition<TEvents, TState>,
): AggregateHandle<TState, TEvents> {
  const { streamPrefix, evolve, encryption, upcasters } = def;
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
        buildStreamId,
        evolveMap,
      }),
    loadEvents: (eventStore, entityId, maxEvents) =>
      eventStore.load(buildStreamId(entityId), maxEvents) as Promise<
        AggregateReplayedEvent<TEvents>[]
      >,
    append: (eventStore, input) =>
      appendAggregate({
        eventStore,
        input,
        buildStreamId,
        encryption,
      }),
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
  buildStreamId: (id: string) => string;
  evolveMap: Record<string, (s: TState, e: ReplayedEvent) => TState>;
}): Promise<AggregateInstance<TState>> {
  const { eventStore, entityId, buildStreamId, evolveMap } = options;
  const streamId = buildStreamId(entityId);
  return loadFromReplay({
    eventStore,
    streamId,
    evolve: evolveMap,
  });
}

async function appendAggregate<TState, TEvents extends EventMap>(options: {
  eventStore: EventStore;
  input: {
    entityId: string;
    expectedVersion: number;
    events: unknown[];
    outboxTopics?: string[];
  };
  buildStreamId: (id: string) => string;
  encryption: AggregateDefinition<TEvents, TState>["encryption"];
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
