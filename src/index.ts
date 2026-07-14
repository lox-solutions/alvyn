// ---------------------------------------------------------------------------
// alvyn — Public API
// ---------------------------------------------------------------------------

// Core class
export { EventStore } from "./event-store";

// Aggregate builder (the main DX surface)
export { defineAggregate } from "./aggregate/define-aggregate";

// Projection builder
export { defineProjection } from "./projection/define-projection";

// Snapshot builder
export { defineSnapshot } from "./snapshot/define-snapshot";

// Types — configuration
export type { EventStoreConfig } from "./types";

// Types — aggregate builder
export type {
  AggregateDefinition,
  AggregateEventInput,
  AggregateHandle,
  AggregateInstance,
  AggregateLoadEventsOptions,
  AggregateReplayedEvent,
  AggregateSubscribeOptions,
  AggregateStoredEvent,
  EncryptionConfig,
  EventMap,
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

// Types — stream discovery
export type { ListStreamsOptions } from "./types";

// Types — projections & outbox
//
// NOTE: the outbox (OutboxHandler / processOutbox) is a *competing-consumer*
// adapter — each event is handled exactly once across the fleet — intended for
// bridging events to an external broker (e.g. NATS). For in-process fan-out,
// where every replica observes every event, use `EventStore.subscribe()`.
export type { OutboxEntry, OutboxHandler, Projection } from "./types";

// Types — subscriptions (fan-out)
export type {
  SubscribeOptions,
  SubscriptionLowerBound,
} from "./subscription/subscribe-options";

// Types — projection builder
export type {
  ProjectionDefinition,
  ProjectionHandle,
  ProjectionHandlerContext,
} from "./projection/types";

// Types — snapshot builder
export type {
  SnapshotDefinition,
  SnapshotEncryptionConfig,
  SnapshotHandle,
  SnapshotLoadResult,
} from "./snapshot/types";

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
  ReservedSnapshotEventTypeError,
  StreamNotFoundError,
} from "./errors";
