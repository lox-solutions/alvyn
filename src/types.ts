import type { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Event Store Configuration
// ---------------------------------------------------------------------------

export interface EventStoreConfig {
  /** pg Pool instance — the library does NOT create or manage the pool */
  pool: Pool;
  /** PostgreSQL schema name for all event store tables (default: "event_store") */
  schema?: string;
  /**
   * Master encryption key (hex-encoded, 256-bit / 64 hex chars).
   * Required only if using crypto-shredding features.
   * Used for envelope encryption of per-entity AES keys.
   */
  masterEncryptionKey?: string;
  /**
   * Default CloudEvents `source` URI-reference for events produced by this store.
   * Defaults to "event-store". Override with an application-specific URI
   * (e.g. "urn:myapp:service-name" or "https://myapp.example.com").
   */
  defaultSource?: string;
}

// ---------------------------------------------------------------------------
// CloudEvents v1.0.2 — Context Attributes
// ---------------------------------------------------------------------------

/**
 * CloudEvents v1.0.2 REQUIRED context attributes.
 *
 * Every stored event conforms to the CloudEvents specification.
 * Attribute names use lowercase per the spec naming convention.
 *
 * @see https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md
 */
export interface CloudEventRequiredAttributes {
  /**
   * Identifies the event.
   * Unique within the scope of the producer (`source` + `id` is globally unique).
   * Format: `"{streamId}/{streamVersion}"` (e.g. `"Order-123/5"`).
   */
  id: string;

  /**
   * Identifies the context in which the event happened.
   * A URI-reference (e.g. `"urn:myapp:order-service"` or `"https://myapp.example.com"`).
   */
  source: string;

  /**
   * The version of the CloudEvents specification.
   * Always `"1.0"` for this library.
   */
  specversion: string;

  /**
   * Describes the type of event (e.g. `"OrderPlaced"`, `"UserRegistered"`).
   * Maps to the domain event type name.
   */
  type: string;
}

/**
 * CloudEvents v1.0.2 OPTIONAL context attributes.
 *
 * @see https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#optional-attributes
 */
export interface CloudEventOptionalAttributes {
  /**
   * Content type of the `data` value.
   * Defaults to `"application/json"` when data is present.
   */
  datacontenttype?: string;

  /**
   * URI identifying the schema that `data` adheres to.
   */
  dataschema?: string;

  /**
   * Describes the subject of the event in the context of the event producer.
   * In this library, defaults to the `streamId`.
   */
  subject?: string;

  /**
   * Timestamp of when the occurrence happened.
   * RFC 3339 format (e.g. `"2024-03-12T10:00:00.000Z"`).
   */
  time?: string;
}

/**
 * CloudEvents extension attributes.
 *
 * Per the spec, extension attribute names MUST consist of lowercase letters
 * or digits only. These are domain-specific attributes attached to events.
 */
export interface CloudEventExtensions {
  /** Unique ID for correlating a chain of events across services */
  correlationid?: string;
  /** ID of the event/command that caused this event */
  causationid?: string;
  /** ID of the user/system actor who triggered this event */
  actorid?: string;
  /**
   * Schema version for upcasting (default: 1).
   * This is an internal extension used by the event store for schema evolution.
   */
  schemaversion?: number;
  /** Additional arbitrary extension attributes (must be lowercase names) */
  [key: string]: unknown;
}

/**
 * Complete CloudEvents context (required + optional + extensions).
 * This represents the full set of context attributes for a stored event,
 * with extension attributes nested under `extensions` (matching how
 * `StoredEvent` structures them, NOT the flat JSON wire format).
 */
export type CloudEventContext = CloudEventRequiredAttributes &
  CloudEventOptionalAttributes & {
    extensions: CloudEventExtensions;
  };

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
// Snapshots
// ---------------------------------------------------------------------------

export interface Snapshot<T = unknown> {
  streamId: string;
  streamVersion: number;
  snapshotType: string;
  data: T;
  createdAt: Date;
}

export interface SaveSnapshotInput<T = unknown> {
  streamId: string;
  streamVersion: number;
  snapshotType: string;
  data: T;
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
