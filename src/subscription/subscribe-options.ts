/**
 * Cursor for resuming a subscription after a restart.
 *
 * The `id` is the string form of an event's `globalPosition` — the globally
 * ordered, monotonic position assigned by the store. Because the subscription
 * stream is gap-free and in order, remembering the last processed position is
 * enough to resume exactly where you left off without a broker offset store.
 */
export interface SubscriptionLowerBound {
  /** String form of the last processed `globalPosition`. */
  id: string;
  /**
   * - `'exclusive'` (default): resume strictly after `id`.
   * - `'inclusive'`: include the event at `id` as well.
   */
  type?: "exclusive" | "inclusive";
}

/**
 * Options for `EventStore.subscribe`.
 *
 * `subscribe()` is the fan-out primitive: every subscriber (e.g. every replica
 * in a replicaset) observes *all* matching events independently, each with its
 * own cursor. This is distinct from the outbox relay, which is a
 * competing-consumer adapter where each event is processed once across the
 * fleet.
 */
export interface SubscribeOptions {
  /**
   * Subject (stream id) to observe, e.g. `"/orders"` or the `"Order-"` prefix.
   * The store's CloudEvents `subject` equals the `streamId`.
   */
  subject?: string;
  /** When `true`, include child subjects (prefix match) rather than an exact match. */
  recursive?: boolean;
  /** Restrict to these CloudEvents `type` values. */
  eventTypes?: string[];
  /** Resume from a previously processed position. */
  lowerBound?: SubscriptionLowerBound;
  /** Abort signal to stop the stream and release its resources. */
  signal?: AbortSignal;
  /** Catch-up batch size (default: 500). */
  batchSize?: number;
  /** Polling / fallback cadence in milliseconds (default: 1000). */
  pollIntervalMs?: number;
}
