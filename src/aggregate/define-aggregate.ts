import type { EventStore } from "../event-store";
import type { ReplayedEvent, Upcaster } from "../types";
import type {
  AggregateDefinition,
  AggregateEventInput,
  AggregateHandle,
  AggregateInstance,
  EventMap,
} from "./types";

// ---------------------------------------------------------------------------
// Snapshot restoration helpers
// ---------------------------------------------------------------------------

/**
 * Auto-restore Map and Set fields from JSON-deserialized snapshot data.
 *
 * JSON round-tripping loses Map/Set prototypes:
 *  - With the custom replacer: Map → `{key: value}`, Set → `[value, ...]`
 *  - Without (legacy snapshots): Map → `{key: value}`, Set → `{}`  (data loss!)
 *
 * This function uses the field lists derived from `initialState()` to restore
 * the correct prototypes on top-level fields only. Nested Map/Set structures
 * are NOT handled — use `deserializeSnapshot` for those cases.
 *
 * Backward compatibility:
 *  - Set stored as array (new format) → `new Set(array)`
 *  - Set stored as `{}` (legacy format) → `new Set()` (empty — data was already lost)
 *  - Map stored as object → `new Map(Object.entries(object))`
 *
 * Limitation: Map keys are always restored as strings (JSON only supports string keys).
 */
function restoreSnapshot<T>(
  raw: T,
  mapFields: string[],
  setFields: string[],
): T {
  if (mapFields.length === 0 && setFields.length === 0) return raw;

  const restored = { ...(raw as Record<string, unknown>) };

  for (const key of mapFields) {
    const val = restored[key];
    if (val instanceof Map) continue;
    restored[key] = new Map(Object.entries(val ?? {}));
  }

  for (const key of setFields) {
    const val = restored[key];
    if (val instanceof Set) continue;
    restored[key] = new Set(Array.isArray(val) ? val : Object.keys(val ?? {}));
  }

  return restored as T;
}

/**
 * Defines a typed aggregate with full TypeScript inference.
 *
 * Uses a curried function pattern to allow partial type inference:
 * the event map TEvents is provided explicitly, while TState is
 * inferred from the definition.
 *
 * Usage:
 * ```typescript
 * type OrderEvents = {
 *   OrderPlaced: { orderId: string; total: number };
 *   OrderShipped: { trackingNumber: string };
 * };
 *
 * const Order = defineAggregate<OrderEvents>()({
 *   streamPrefix: "Order",
 *   initialState: () => ({ status: "pending", total: 0 }),
 *   evolve: {
 *     OrderPlaced: (state, event) => ({ ...state, total: event.data?.total ?? 0 }),
 *     OrderShipped: (state) => ({ ...state, status: "shipped" }),
 *   },
 * });
 *
 * const order = await Order.load(eventStore, "order-123");
 * ```
 */
export function defineAggregate<TEvents extends EventMap>() {
  return function <TState>(
    definition: AggregateDefinition<TEvents, TState>,
  ): AggregateHandle<TEvents, TState> {
    const {
      streamPrefix,
      initialState,
      evolve,
      encryption,
      snapshot,
      deserializeSnapshot,
      upcasters,
    } = definition;

    // Auto-detect Map/Set fields from the initial state for snapshot restoration.
    // This avoids requiring aggregate authors to write manual deserialization.
    const mapFields: string[] = [];
    const setFields: string[] = [];
    if (snapshot && !deserializeSnapshot) {
      const reference = initialState() as Record<string, unknown>;
      for (const [key, value] of Object.entries(reference)) {
        if (value instanceof Map) mapFields.push(key);
        else if (value instanceof Set) setFields.push(key);
      }
    }

    function buildStreamId(entityId: string): string {
      return `${streamPrefix}-${entityId}`;
    }

    function applyEvents(state: TState, events: ReplayedEvent[]): TState {
      let current = state;

      for (const event of events) {
        // Use CloudEvents `type` attribute for handler dispatch
        const handler = evolve[event.type as keyof typeof evolve] as
          | ((state: TState, event: ReplayedEvent) => TState)
          | undefined;

        if (handler) {
          current = handler(current, event);
        }
        // Events without a handler are silently skipped.
        // This supports forward compatibility — new event types can be
        // added to the stream without breaking existing aggregate definitions.
      }

      return current;
    }

    const handle: AggregateHandle<TEvents, TState> = {
      streamPrefix,

      async load(
        eventStore: EventStore,
        entityId: string,
      ): Promise<AggregateInstance<TState>> {
        const streamId = buildStreamId(entityId);

        if (snapshot) {
          const { snapshot: snap, events } =
            await eventStore.loadWithSnapshot(streamId);
          const baseState = snap
            ? deserializeSnapshot
              ? deserializeSnapshot(snap.data)
              : restoreSnapshot(snap.data as TState, mapFields, setFields)
            : initialState();
          const baseVersion = snap ? snap.streamVersion : 0;
          const state = applyEvents(baseState, events);
          const version =
            events.length > 0
              ? events[events.length - 1]!.streamVersion
              : baseVersion;

          // Auto-snapshot if we replayed enough events since last snapshot.
          // Wrapped in try-catch: a failed snapshot is not fatal — the aggregate
          // state was already computed successfully. It just means the next load
          // will replay more events until a snapshot eventually succeeds.
          if (snapshot.every > 0 && events.length >= snapshot.every) {
            try {
              await eventStore.saveSnapshot({
                streamId,
                streamVersion: version,
                snapshotType: streamPrefix,
                data: state,
              });
            } catch {
              // Snapshot save failed — log and continue.
              // The aggregate state is still valid; we just miss the optimization.
            }
          }

          return {
            state,
            version,
            exists: version > 0,
            streamId,
          };
        }

        // No snapshot config — full replay
        const events = await eventStore.load(streamId);
        const state = applyEvents(initialState(), events);
        const version =
          events.length > 0 ? events[events.length - 1]!.streamVersion : 0;

        return {
          state,
          version,
          exists: version > 0,
          streamId,
        };
      },

      async append(
        eventStore: EventStore,
        entityId: string,
        input: {
          expectedVersion: number;
          events: AggregateEventInput<TEvents>[];
          outboxTopics?: string[];
        },
      ): Promise<{ fromVersion: number; toVersion: number }> {
        const streamId = buildStreamId(entityId);

        const result = await eventStore.append({
          streamId,
          expectedVersion: input.expectedVersion,
          outboxTopics: input.outboxTopics,
          events: input.events.map((e) => {
            const encryptedFields =
              encryption?.encryptedFields[e.type] ?? undefined;
            const cryptoKeyId =
              encryptedFields && encryptedFields.length > 0
                ? encryption!.cryptoKeyId(entityId)
                : undefined;

            return {
              type: e.type,
              data: e.data,
              extensions: e.extensions,
              schemaVersion: e.schemaVersion,
              encryptedFields,
              cryptoKeyId,
            };
          }),
        });

        return {
          fromVersion: result.fromVersion,
          toVersion: result.toVersion,
        };
      },

      getUpcasters(): Upcaster[] {
        return upcasters ?? [];
      },
    };

    return handle;
  };
}
