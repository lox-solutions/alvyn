// ---------------------------------------------------------------------------
// alvyn — Public API
// ---------------------------------------------------------------------------

// Core class
export { EventStore } from "./event-store";

// Aggregate builder (the main DX surface)
export { defineAggregate } from "./aggregate/define-aggregate";

// Projection builder
export { defineProjection } from "./projection/define-projection";

// Types — configuration
export type { EventStoreConfig } from "./types";

// Types — aggregate builder
export type {
  AggregateDefinition,
  AggregateEventInput,
  AggregateHandle,
  AggregateInstance,
  EncryptionConfig,
  EventMap,
  SnapshotConfig,
} from "./aggregate/types";

// Types — CloudEvents v1.0.2
export type {
  CloudEventContext,
  CloudEventExtensions,
  CloudEventOptionalAttributes,
  CloudEventRequiredAttributes,
} from "./types";

// Types — events
export type {
  AppendEventInput,
  AppendInput,
  AppendResult,
  ReplayedEvent,
  StoredEvent,
  TombstonedEvent,
} from "./types";

// Types — snapshots
export type { SaveSnapshotInput, Snapshot } from "./types";

// Types — stream discovery
export type { ListStreamsOptions } from "./types";

// Types — projections & outbox
export type { OutboxEntry, OutboxHandler, Projection } from "./types";

// Types — projection builder
export type {
  ProjectionDefinition,
  ProjectionHandle,
  ProjectionHandlerContext,
} from "./projection/types";

// Types — upcasting
export type { Upcaster } from "./types";

// Types — transactions
export type { TransactionContext } from "./types";

// Errors (for catch blocks)
export {
  CryptoKeyNotFoundError,
  CryptoKeyRevokedError,
  EventStoreNotInitializedError,
  InvalidSchemaNameError,
  MasterKeyRequiredError,
  OptimisticConcurrencyError,
  StreamNotFoundError,
} from "./errors";
