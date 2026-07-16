import type { EventStore } from "../event-store";
import type { ReplayedEvent } from "../types";
import type {
  AggregateDefinition,
  AggregateEventInput,
  AggregateInstance,
} from "./types";

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

export function mapEventsForAppend<TEvents>(options: {
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
