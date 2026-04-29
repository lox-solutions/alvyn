import type { PoolClient } from "pg";

import type { EventMap } from "../aggregate/types";
import type { StoredEvent } from "../types";

// ---------------------------------------------------------------------------
// Projection Handler Context
// ---------------------------------------------------------------------------

/**
 * Context passed to each projection event handler.
 *
 * Provides the transactional `PoolClient` for atomic writes alongside
 * the checkpoint advance, plus event metadata.
 */
export interface ProjectionHandlerContext {
  /** The entity ID extracted from the stream ID (prefix stripped). */
  entityId: string;
  /** The full stream ID (e.g. "AgentRun-abc123"). */
  streamId: string;
  /** The global position of this event in the event store. */
  globalPosition: bigint;
  /** The event's stream version. */
  streamVersion: number;
  /** The event's creation timestamp. */
  createdAt: Date;
  /**
   * The transactional PoolClient.
   * Use this for all SQL writes to ensure atomicity with the
   * projection checkpoint. If the handler fails, both the write
   * and the checkpoint advance are rolled back.
   */
  client: PoolClient;
}

// ---------------------------------------------------------------------------
// Projection Definition (what the developer provides)
// ---------------------------------------------------------------------------

/**
 * Defines a typed projection from an event-sourced aggregate.
 *
 * @template TEvents - The aggregate's event map (same type used in defineAggregate).
 */
export interface ProjectionDefinition<TEvents extends EventMap> {
  /** Unique name for checkpoint tracking in the `projections` table. */
  projectionName: string;
  /** The stream prefix to filter on (e.g. "AgentRun"). Only events from matching streams are processed. */
  streamPrefix: string;
  /**
   * Typed event handlers. Each key is an event type name from TEvents.
   * Handlers that are omitted are silently skipped (forward-compatible).
   *
   * @param data - The fully-typed event data payload.
   * @param ctx - The projection handler context (client, entityId, metadata).
   */
  handlers: {
    [K in keyof TEvents & string]?: (
      data: TEvents[K],
      ctx: ProjectionHandlerContext,
    ) => Promise<void>;
  };
}

// ---------------------------------------------------------------------------
// Projection Handle (what defineProjection returns)
// ---------------------------------------------------------------------------

/**
 * A built projection that satisfies the `Projection` interface
 * and can be passed directly to `eventStore.runProjection()`.
 */
export interface ProjectionHandle {
  /** The projection name (for checkpoint tracking). */
  readonly projectionName: string;
  /** The stream prefix this projection filters on. */
  readonly streamPrefix: string;
  /**
   * Handles a single event. Automatically filters by stream prefix,
   * extracts the entity ID, and dispatches to the correct typed handler.
   */
  handle(event: StoredEvent, client: PoolClient): Promise<void>;
}
