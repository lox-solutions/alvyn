import type { PoolClient } from "pg";
import type { EventStore } from "../event-store";
import type { ReplayedEvent, Upcaster } from "../types";
import type {
  AggregateAppendInput,
  AggregateAppendOptions,
  AggregateDefinition,
  AggregateHandle,
  AggregateInstance,
  AggregateLoadEventsOptions,
  AggregateLoadOptions,
  AggregateReplayedEvent,
  AggregateSubscribeOptions,
  AggregateStoredEvent,
} from "./types";
import { loadFromReplay, mapEventsForAppend } from "./aggregate-helpers";
import { isReservedSnapshotEventType } from "../snapshot/reserved-event-type";
import type { ValidEventMap } from "../valid-event-map";

async function loadDomainEvents<TEvents>(options: {
  eventStore: EventStore;
  streamId: string;
  maxEvents?: number;
  client?: PoolClient;
}): Promise<AggregateReplayedEvent<TEvents>[]> {
  const { eventStore, streamId, maxEvents, client } = options;
  const events = await eventStore.load(streamId, { maxEvents, client });
  return events.filter(
    (event) => !isReservedSnapshotEventType(event.type),
  ) as AggregateReplayedEvent<TEvents>[];
}

async function* filterDomainSubscription<TEvents>(
  source: AsyncIterable<AggregateStoredEvent<TEvents>>,
): AsyncIterable<AggregateStoredEvent<TEvents>> {
  for await (const event of source) {
    if (!isReservedSnapshotEventType(event.type)) yield event;
  }
}

function createAggregateHandle<TState, TEvents>(
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
    load: (
      eventStore: EventStore,
      entityId: string,
      options?: AggregateLoadOptions,
    ) =>
      loadAggregate({
        eventStore,
        entityId,
        buildStreamId,
        evolveMap,
        client: options?.client,
      }),
    loadEvents: (options: AggregateLoadEventsOptions) => {
      const { eventStore, entityId, maxEvents, client } = options;
      return loadDomainEvents<TEvents>({
        eventStore,
        streamId: buildStreamId(entityId),
        maxEvents,
        client,
      });
    },
    append: (
      eventStore: EventStore,
      input: AggregateAppendInput<TEvents>,
      options?: AggregateAppendOptions,
    ) =>
      appendAggregate({
        eventStore,
        input,
        buildStreamId,
        encryption,
        client: options?.client,
      }),
    subscribe: (args: AggregateSubscribeOptions) => {
      const { eventStore, entityId, options } = args;
      return filterDomainSubscription<TEvents>(
        eventStore.subscribe({
          ...options,
          subject: buildStreamId(entityId),
        }) as AsyncIterable<AggregateStoredEvent<TEvents>>,
      );
    },
    getUpcasters: (): Upcaster[] => upcasters ?? [],
  };
}

async function loadAggregate<TState>(options: {
  eventStore: EventStore;
  entityId: string;
  buildStreamId: (id: string) => string;
  evolveMap: Record<string, (s: TState, e: ReplayedEvent) => TState>;
  client?: PoolClient;
}): Promise<AggregateInstance<TState>> {
  const { eventStore, entityId, buildStreamId, evolveMap, client } = options;
  const streamId = buildStreamId(entityId);
  return loadFromReplay({
    eventStore,
    streamId,
    evolve: evolveMap,
    client,
  });
}

async function appendAggregate<TState, TEvents>(options: {
  eventStore: EventStore;
  input: AggregateAppendInput<TEvents>;
  buildStreamId: (id: string) => string;
  encryption: AggregateDefinition<TEvents, TState>["encryption"];
  client?: PoolClient;
}): Promise<{ fromVersion: number; toVersion: number }> {
  const { eventStore, input, buildStreamId, encryption, client } = options;
  const streamId = buildStreamId(input.entityId);
  const result = await eventStore.append(
    {
      streamId,
      expectedVersion: input.expectedVersion,
      outboxTopics: input.outboxTopics,
      idempotencyKey: input.idempotencyKey,
      events: mapEventsForAppend({
        events: input.events,
        encryption,
        entityId: input.entityId,
      }),
    },
    { client },
  );
  return { fromVersion: result.fromVersion, toVersion: result.toVersion };
}

/** Defines a typed aggregate with full TypeScript inference. */
export function defineAggregate<TState, TEvents>(): (
  definition: [ValidEventMap<TEvents>] extends [never]
    ? never
    : AggregateDefinition<TEvents, TState>,
) => AggregateHandle<TState, TEvents> {
  return (def: AggregateDefinition<TEvents, TState>) =>
    createAggregateHandle(def);
}
