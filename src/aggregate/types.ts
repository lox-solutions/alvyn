import type { EventStore } from "../event-store";
import type {
  ReplayedEvent,
  StoredEvent,
  TombstonedEvent,
  Upcaster,
} from "../types";
import type { SubscribeOptions } from "../subscription/subscribe-options";

// ---------------------------------------------------------------------------
// Utility types for inferring event maps
// ---------------------------------------------------------------------------

/** A map of event type names to their data shapes */
export type EventMap = Record<string, unknown>;

export interface AggregateLoadEventsOptions {
  eventStore: EventStore;
  entityId: string;
  maxEvents?: number;
}

export interface AggregateSubscribeOptions {
  eventStore: EventStore;
  entityId: string;
  options?: Omit<SubscribeOptions, "subject">;
}

/** Extract event type names as a union */
type EventTypeNames<TEvents extends EventMap> = string & keyof TEvents;

/** A single event input for the append operation */
export type AggregateEventInput<TEvents extends EventMap> = {
  [K in EventTypeNames<TEvents>]: {
    type: K;
    data: TEvents[K];
    /** CloudEvents extension attributes (correlationid, causationid, actorid, etc.) */
    extensions?: Record<string, unknown>;
    schemaVersion?: number;
  };
}[EventTypeNames<TEvents>];

/** A stored event whose payload is inferred from its CloudEvents `type`. */
export type AggregateStoredEvent<TEvents extends EventMap> = {
  [K in EventTypeNames<TEvents>]: StoredEvent<TEvents[K]> & { type: K };
}[EventTypeNames<TEvents>];

/** A replayed event whose payload is inferred from its CloudEvents `type`. */
export type AggregateReplayedEvent<TEvents extends EventMap> =
  | AggregateStoredEvent<TEvents>
  | TombstonedEvent;

// ---------------------------------------------------------------------------
// Aggregate Definition (what the developer provides)
// ---------------------------------------------------------------------------

export interface EncryptionConfig<TEvents extends EventMap> {
  /** Derives the crypto key ID from the stream entity ID */
  cryptoKeyId: (entityId: string) => string;
  /** Map of event type → field paths that contain PII */
  encryptedFields: Partial<Record<EventTypeNames<TEvents>, string[]>>;
}

export interface AggregateDefinition<TEvents extends EventMap, TState> {
  /** Prefix for stream IDs (e.g. "Order" → stream_id = "Order-{id}") */
  streamPrefix: string;
  /**
   * Event handlers that evolve the state.
   * Each handler receives the current state and the event,
   * and returns the new state (immutable update pattern).
   *
   * The first event in the stream "creates" the aggregate — its handler
   * receives `null` as state (typed as `TState` for DX — `...null` spreads
   * to `{}` in JS, so the spread pattern works safely).
   *
   * For tombstoned events (GDPR-shredded), event.data will be null.
   * Handlers should gracefully handle null data.
   */
  evolve: {
    [K in EventTypeNames<TEvents>]: (
      state: TState,
      event: ReplayedEvent<TEvents[K]>,
    ) => TState;
  };
  /** Optional: GDPR encryption configuration */
  encryption?: EncryptionConfig<TEvents>;
  /** Optional: schema evolution upcasters */
  upcasters?: Upcaster[];
}

// ---------------------------------------------------------------------------
// Aggregate Instance (what load() returns)
// ---------------------------------------------------------------------------

export interface AggregateInstance<TState> {
  /** The current state after replaying all events, or `null` if no events exist */
  state: TState | null;
  /** The current stream version (number of events) */
  version: number;
  /** The stream ID */
  streamId: string;
}

// ---------------------------------------------------------------------------
// Aggregate Handle (the object returned by defineAggregate)
// ---------------------------------------------------------------------------

export interface AggregateHandle<TState, TEvents extends EventMap> {
  /** The stream prefix */
  readonly streamPrefix: string;

  /**
   * Loads the aggregate state by replaying events.
   */
  load(
    eventStore: EventStore,
    entityId: string,
  ): Promise<AggregateInstance<TState>>;

  /**
   * Loads this aggregate's raw events with payload types inferred from event names.
   */
  loadEvents(
    options: AggregateLoadEventsOptions,
  ): Promise<AggregateReplayedEvent<TEvents>[]>;

  /**
   * Appends events to the aggregate's stream.
   */
  append(
    eventStore: EventStore,
    input: {
      entityId: string;
      expectedVersion: number;
      events: AggregateEventInput<TEvents>[];
      outboxTopics?: string[];
    },
  ): Promise<{ fromVersion: number; toVersion: number }>;

  /**
   * Subscribes to this aggregate's stream with payload types inferred from event names.
   */
  subscribe(
    options: AggregateSubscribeOptions,
  ): AsyncIterable<AggregateStoredEvent<TEvents>>;

  /**
   * Returns all registered upcasters for this aggregate.
   * Call this during setup to register them with the event store.
   */
  getUpcasters(): Upcaster[];
}
