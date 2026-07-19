import type { Pool, PoolClient } from "pg";

import type {
  CloudEventExtensions,
  CloudEventOptionalAttributes,
  CloudEventRequiredAttributes,
} from "./cloud-event-types";
import type { SnapshotHandle } from "./snapshot/types";

// Re-export CloudEvents types for backward compatibility
export type {
  CloudEventContext,
  CloudEventExtensions,
  CloudEventOptionalAttributes,
  CloudEventRequiredAttributes,
} from "./cloud-event-types";

// ---------------------------------------------------------------------------
// Event Store Configuration
// ---------------------------------------------------------------------------

export interface EventStoreConfig {
  /** pg Pool instance — the library does NOT create or manage the pool */
  pool: Pool;
  /** PostgreSQL schema name for all event store tables (default: "event_store") */
  schema?: string;
  /**
   * Ordered versioned secrets for crypto-shredding. The first entry is
   * used for new data; later entries are retained for decryption only.
   * `GDPR_CRYPTO_SECRETS` is used when this option is omitted.
   */
  secrets?: CryptoSecret[];
  /**
   * Default CloudEvents `source` URI-reference for events produced by this store.
   * Defaults to "event-store". Override with an application-specific URI
   * (e.g. "urn:myapp:service-name" or "https://myapp.example.com").
   */
  defaultSource?: string;
  /** Snapshot definitions maintained synchronously after matching appends */
  snapshots?: SnapshotHandle<unknown>[];
}

/** A versioned secret used to wrap per-entity encryption keys. */
export interface CryptoSecret {
  version: number;
  value: string;
}

// ---------------------------------------------------------------------------
// Domain Events
// ---------------------------------------------------------------------------

/**
 * A fully resolved event read from the store.
 *
 * The top-level fields are CloudEvents v1.0.2 context attributes.
 * The `data` field contains the domain-specific event payload.
 *
 * Internal store fields (`globalPosition`, `streamId`, `streamVersion`)
 * are also available for stream operations but are NOT part of the
 * CloudEvents envelope.
 */
export interface StoredEvent<T = unknown>
  extends CloudEventRequiredAttributes, CloudEventOptionalAttributes {
  // --- CloudEvents data ---
  /** The domain-specific event payload */
  data: T;

  // --- CloudEvents extensions ---
  /** Extension context attributes (correlationid, causationid, actorid, etc.) */
  extensions: CloudEventExtensions;

  // --- Internal store fields (not part of CloudEvents) ---
  /** Monotonically increasing global position across all streams */
  globalPosition: bigint;
  /** Stream identifier (e.g. "Order-123") */
  streamId: string;
  /** Sequential version within the stream (1, 2, 3, ...) */
  streamVersion: number;
  /** Database-assigned creation timestamp */
  createdAt: Date;
}

/**
 * A tombstoned event where PII has been shredded (GDPR crypto-shredding).
 * The `data` is `null` because the encryption key was revoked.
 */
export interface TombstonedEvent
  extends CloudEventRequiredAttributes, CloudEventOptionalAttributes {
  /** PII was shredded — data is irrecoverable */
  data: null;
  /** Extension context attributes */
  extensions: CloudEventExtensions;
  /** Marker that this event has been tombstoned */
  tombstoned: true;

  // --- Internal store fields ---
  globalPosition: bigint;
  streamId: string;
  streamVersion: number;
  createdAt: Date;
}

/** An event returned from load(). Either a fully resolved event or a tombstone. */
export type ReplayedEvent<T = unknown> = StoredEvent<T> | TombstonedEvent;

// ---------------------------------------------------------------------------
// Append (Write)
// ---------------------------------------------------------------------------

export interface AppendEventInput<T = unknown> {
  /** The CloudEvents `type` attribute (event type name) */
  type: string;
  /** The domain-specific event payload */
  data: T;
  /**
   * CloudEvents `source` URI-reference.
   * Overrides the store's `defaultSource` for this specific event.
   */
  source?: string;
  /**
   * CloudEvents extension attributes (correlationid, causationid, actorid, etc.).
   * Extension names must be lowercase per the CloudEvents spec.
   */
  extensions?: Partial<CloudEventExtensions>;
  /** Field paths within `data` that contain PII and should be encrypted */
  encryptedFields?: string[];
  /** Crypto key ID for encryption (e.g. "user:abc123") */
  cryptoKeyId?: string;
  /**
   * Schema version of this event (default: 1).
   * Stored as the `schemaversion` CloudEvents extension.
   */
  schemaVersion?: number;
}

export interface AppendInput<T = unknown> {
  streamId: string;
  /**
   * Optimistic concurrency control:
   * - `-1` = expect a new stream (stream must not exist)
   * -  `0` = no concurrency check (append regardless)
   * - `N`  = expect the stream's current version to be exactly N
   */
  expectedVersion: number;
  events: AppendEventInput<T>[];
  /** Optional: outbox topics to publish events to */
  outboxTopics?: string[];
}

export interface AppendResult {
  streamId: string;
  /** First new stream_version written */
  fromVersion: number;
  /** Last new stream_version written */
  toVersion: number;
  /** Global positions assigned to each event */
  globalPositions: bigint[];
}

// ---------------------------------------------------------------------------
// Upcasters
// ---------------------------------------------------------------------------

export interface Upcaster<TIn = unknown, TOut = unknown> {
  eventType: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
  upcast(data: TIn): TOut;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface Projection {
  projectionName: string;
  /**
   * Handles a single event for this projection.
   *
   * @param event - The event to process
   * @param client - The PoolClient for the current transaction. Use this client
   *   for all database writes to ensure atomicity with the projection checkpoint.
   *   If your handler writes to a different database, at-least-once semantics
   *   apply (the checkpoint advances only after handler success).
   */
  handle(event: StoredEvent, client: PoolClient): Promise<void>;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export interface OutboxEntry {
  id: bigint;
  eventGlobalPosition: bigint;
  topic: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * Handler function for processing outbox entries.
 *
 * @param entries - The batch of outbox entries to process.
 * @param client - The PoolClient for the current transaction. Use this client
 *   for all database writes to ensure atomicity with the outbox checkpoint.
 *   If your handler writes to a different database, at-least-once semantics
 *   apply (the entries are marked processed only after handler success).
 */
export type OutboxHandler = (
  entries: OutboxEntry[],
  client: PoolClient,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Stream Discovery
// ---------------------------------------------------------------------------

export interface ListStreamsOptions {
  /** Filter by stream ID prefix (e.g. "AgentRun"). The separator "-" is appended automatically. */
  prefix?: string;
  /** Maximum number of stream IDs to return (default: 100) */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

export interface TransactionContext {
  client: PoolClient;
}
