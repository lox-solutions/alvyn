import type { PoolClient } from "pg";
import type { EventStore } from "../event-store";
import type { EventMap } from "../aggregate/types";
import type { ReplayedEvent } from "../types";

type EventTypeNames<TEvents extends EventMap> = string & keyof TEvents;

export interface SnapshotEncryptionConfig {
  /** Derives the crypto key ID from the stream entity ID */
  cryptoKeyId: (entityId: string) => string;
  /** Field paths within the snapshot data that contain PII */
  encryptedFields: string[];
}

export interface SnapshotDefinition<TState, TEvents extends EventMap> {
  /** Prefix for stream IDs (e.g. "Transaction" → stream_id = "Transaction-{id}") */
  streamPrefix: string;
  /** Snapshot name used to generate the event type `${snapshotName}Snapshot` */
  snapshotName: string;
  /** Number of source events after which a new snapshot should be appended */
  every: number;
  /** Initial state used when the stream has no snapshot event yet */
  initialState: TState;
  /** Event handlers that evolve the snapshot state from source events */
  evolve: Partial<{
    [K in EventTypeNames<TEvents>]: (
      state: TState,
      event: ReplayedEvent<TEvents[K]>,
    ) => TState;
  }>;
  /** Optional: GDPR encryption configuration for generated snapshot events */
  encryption?: SnapshotEncryptionConfig;
}

export interface SnapshotLoadResult<TState> {
  /** The current snapshot state after replaying all relevant source events */
  state: TState;
  /** The stream ID */
  streamId: string;
  /** The current stream version, including snapshot events */
  version: number;
  /** The stream version of the latest snapshot event used as replay base */
  snapshotVersion: number | null;
  /** Number of source events replayed after the snapshot base */
  replayedEvents: number;
}

export interface SnapshotUpdateAfterAppendOptions {
  eventStore: EventStore;
  streamId: string;
  options?: { client?: PoolClient };
}

export interface SnapshotHandle<TState> {
  /** The stream prefix */
  readonly streamPrefix: string;
  /** The configured snapshot name */
  readonly snapshotName: string;
  /** The generated snapshot event type */
  readonly snapshotEventType: string;
  /** @internal Event types that can change this snapshot state */
  readonly sourceEventTypes: string[];

  /** Loads the derived state from the latest snapshot event plus later source events. */
  load(
    eventStore: EventStore,
    entityId: string,
  ): Promise<SnapshotLoadResult<TState>>;
  /** @internal Maintains this snapshot after matching source events are appended. */
  updateAfterAppend(options: SnapshotUpdateAfterAppendOptions): Promise<void>;
}
