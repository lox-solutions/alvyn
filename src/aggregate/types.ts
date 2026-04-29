import type { EventStore } from "../event-store";
import type { ReplayedEvent, Upcaster } from "../types";

// ---------------------------------------------------------------------------
// Utility types for inferring event maps
// ---------------------------------------------------------------------------

/** A map of event type names to their data shapes */
export type EventMap = Record<string, unknown>;

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

// ---------------------------------------------------------------------------
// Aggregate Definition (what the developer provides)
// ---------------------------------------------------------------------------

export interface EncryptionConfig<TEvents extends EventMap> {
  /** Derives the crypto key ID from the stream entity ID */
  cryptoKeyId: (entityId: string) => string;
  /** Map of event type → field paths that contain PII */
  encryptedFields: Partial<Record<EventTypeNames<TEvents>, string[]>>;
}

export interface SnapshotConfig {
  /**
   * Auto-create a snapshot every N events.
   *
   * Map and Set fields in aggregate state are handled automatically:
   * - On save: a custom JSON replacer converts Map → object, Set → array
   * - On load: fields are auto-restored by inspecting `initialState()`
   *
   * Limitations:
   * - Only top-level Map/Set fields are auto-restored. Nested structures
   *   (e.g. `Map<string, Set<string>>`) require `deserializeSnapshot`.
   * - Map keys are always restored as strings (JSON limitation).
   */
  every: number;
}

export interface AggregateDefinition<TEvents extends EventMap, TState> {
  /** Prefix for stream IDs (e.g. "Order" → stream_id = "Order-{id}") */
  streamPrefix: string;
  /** Factory function returning the initial aggregate state */
  initialState: () => TState;
  /**
   * Event handlers that evolve the state.
   * Each handler receives the current state and the event,
   * and returns the new state (immutable update pattern).
   *
   * For tombstoned events (GDPR-shredded), event.data will be null.
   * Handlers should gracefully handle null data.
   */
  evolve: {
    [K in EventTypeNames<TEvents>]: (state: TState, event: ReplayedEvent<TEvents[K]>) => TState;
  };
  /** Optional: GDPR encryption configuration */
  encryption?: EncryptionConfig<TEvents>;
  /** Optional: automatic snapshot configuration */
  snapshot?: SnapshotConfig;
  /**
   * Optional: custom snapshot deserialization.
   *
   * By default, the framework auto-detects top-level Map and Set fields from
   * `initialState()` and restores their prototypes after JSON deserialization.
   * This covers the common case — you do NOT need this hook for simple Map/Set fields.
   *
   * Use this hook only for advanced cases like nested Map/Set structures or
   * custom class instances that need manual reconstruction.
   */
  deserializeSnapshot?: (raw: unknown) => TState;
  /** Optional: schema evolution upcasters */
  upcasters?: Upcaster[];
}

// ---------------------------------------------------------------------------
// Aggregate Instance (what load() returns)
// ---------------------------------------------------------------------------

export interface AggregateInstance<TState> {
  /** The current state after replaying all events */
  state: TState;
  /** The current stream version (number of events) */
  version: number;
  /** Whether the stream exists (has at least one event) */
  exists: boolean;
  /** The stream ID */
  streamId: string;
}

// ---------------------------------------------------------------------------
// Aggregate Handle (the object returned by defineAggregate)
// ---------------------------------------------------------------------------

export interface AggregateHandle<TEvents extends EventMap, TState> {
  /** The stream prefix */
  readonly streamPrefix: string;

  /**
   * Loads the aggregate state by replaying events (with snapshot optimization).
   */
  load(eventStore: EventStore, entityId: string): Promise<AggregateInstance<TState>>;

  /**
   * Appends events to the aggregate's stream.
   */
  append(
    eventStore: EventStore,
    entityId: string,
    input: {
      expectedVersion: number;
      events: AggregateEventInput<TEvents>[];
      outboxTopics?: string[];
    },
  ): Promise<{ fromVersion: number; toVersion: number }>;

  /**
   * Returns all registered upcasters for this aggregate.
   * Call this during setup to register them with the event store.
   */
  getUpcasters(): Upcaster[];
}
