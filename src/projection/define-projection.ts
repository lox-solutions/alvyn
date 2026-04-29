import type { PoolClient } from "pg";

import type { EventMap } from "../aggregate/types";
import type { StoredEvent } from "../types";
import type {
  ProjectionDefinition,
  ProjectionHandle,
  ProjectionHandlerContext,
} from "./types";

/**
 * Defines a typed projection from an event-sourced aggregate.
 *
 * Uses the same curried function pattern as `defineAggregate` to allow
 * partial type inference: the event map TEvents is provided explicitly,
 * while the handler types are inferred from the definition.
 *
 * The returned handle satisfies the `Projection` interface and can be
 * passed directly to `eventStore.runProjection()`.
 *
 * Usage:
 * ```typescript
 * type OrderEvents = {
 *   OrderPlaced: { customerId: string; total: number };
 *   OrderShipped: { trackingNumber: string };
 * };
 *
 * const orderProjection = defineProjection<OrderEvents>()({
 *   projectionName: "order-summary",
 *   streamPrefix: "Order",
 *   handlers: {
 *     OrderPlaced: async (data, ctx) => {
 *       await ctx.client.query(
 *         `INSERT INTO order_summaries (id, total, status) VALUES ($1, $2, 'placed')`,
 *         [ctx.entityId, data.total],
 *       );
 *     },
 *     OrderShipped: async (_data, ctx) => {
 *       await ctx.client.query(
 *         `UPDATE order_summaries SET status = 'shipped' WHERE id = $1`,
 *         [ctx.entityId],
 *       );
 *     },
 *   },
 * });
 *
 * await eventStore.runProjection(orderProjection, 500);
 * ```
 */
export function defineProjection<TEvents extends EventMap>() {
  return function (
    definition: ProjectionDefinition<TEvents>,
  ): ProjectionHandle {
    const { projectionName, streamPrefix, handlers } = definition;
    const prefix = `${streamPrefix}-`;

    return {
      projectionName,
      streamPrefix,

      async handle(event: StoredEvent, client: PoolClient): Promise<void> {
        // Fast-path: skip events from other aggregates
        if (!event.streamId.startsWith(prefix)) return;

        // Use CloudEvents `type` attribute for handler dispatch
        const handler = handlers[event.type as keyof TEvents & string];
        if (!handler) return;

        const entityId = event.streamId.slice(prefix.length);

        const ctx: ProjectionHandlerContext = {
          entityId,
          streamId: event.streamId,
          globalPosition: event.globalPosition,
          streamVersion: event.streamVersion,
          createdAt: event.createdAt,
          client,
        };

        await (
          handler as (
            data: unknown,
            ctx: ProjectionHandlerContext,
          ) => Promise<void>
        )(event.data, ctx);
      },
    };
  };
}
