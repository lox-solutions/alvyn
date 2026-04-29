# Schema Evolution (Upcasters)

Upcasters transform old event schemas into newer versions **at read time**. The stored event in the database is **never modified** -- transformations happen in memory during `load()`.

> **Related:** [Event Store Overview](../event-store.md) | [Aggregates](./aggregates.md) | [API Reference](./api-reference.md)

---

## Why Upcasters?

Event sourcing stores events permanently. When the shape of an event changes (e.g., adding a new required field, restructuring nested data), you have two options:

1. **Migrate stored events** -- Modify existing rows in the database. This breaks the immutability guarantee and is error-prone at scale.
2. **Upcast at read time** -- Transform old events to the new shape when they are loaded. The stored data stays unchanged.

This library uses option 2. Upcasters are pure functions that convert event data from one schema version to the next.

---

## Defining an Upcaster

An upcaster implements the `Upcaster` interface:

```typescript
import type { Upcaster } from "@repo/event-store";

const orderPlacedV1ToV2: Upcaster = {
  eventType: "OrderPlaced", // Which event type this applies to
  fromSchemaVersion: 1, // Source version
  toSchemaVersion: 2, // Target version
  upcast(data: { total: number }) {
    return {
      ...data,
      currency: "EUR", // New required field in v2
    };
  },
};
```

### Registration

Register upcasters with the event store at startup:

```typescript
// Single upcaster
eventStore.registerUpcaster(orderPlacedV1ToV2);

// Multiple upcasters
eventStore.registerUpcasters([orderPlacedV1ToV2, addressV1ToV2]);

// From an aggregate definition
eventStore.registerUpcasters(Order.getUpcasters());
```

---

## Chained Upcasters

When an event type has gone through multiple schema versions, register upcasters for each step. They are automatically chained:

```typescript
// v1: Original format
// { street: "123 Main St" }

// v1 -> v2: Added "city" field
const addressV1ToV2: Upcaster = {
  eventType: "AddressChanged",
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(data: { street: string }) {
    return { ...data, city: "Unknown" };
  },
};

// v2 -> v3: Restructured to nested object
const addressV2ToV3: Upcaster = {
  eventType: "AddressChanged",
  fromSchemaVersion: 2,
  toSchemaVersion: 3,
  upcast(data: { street: string; city: string }) {
    return {
      address: { street: data.street, city: data.city },
    };
  },
};

eventStore.registerUpcasters([addressV1ToV2, addressV2ToV3]);
```

**Result:** A v1 event stored as `{ street: "123 Main St" }` is automatically transformed through both upcasters on read, producing `{ address: { street: "123 Main St", city: "Unknown" } }`.

---

## How Upcasters Work Internally

1. Events are stored with a `schema_version` column (default: `1`). This value is also available in `event.extensions.schemaversion`.
2. The `UpcasterRegistry` maintains a `Map<eventType, Upcaster[]>` sorted by `fromSchemaVersion` ascending.
3. On read, for each event:
   - Look up the upcaster chain for the event type
   - Starting from the stored `schema_version`, walk the chain
   - For each upcaster where `fromSchemaVersion === currentVersion`, apply `upcast()` and advance `currentVersion` to `toSchemaVersion`
   - Events already at the latest version skip upcasters entirely
4. The database row is **never modified**.

### Example Walkthrough

Given registered upcasters: `v1->v2`, `v2->v3`

| Stored Version | Upcasters Applied   | Result Version |
| -------------- | ------------------- | -------------- |
| 1              | v1->v2, then v2->v3 | 3              |
| 2              | v2->v3              | 3              |
| 3              | (none)              | 3              |

---

## Using Upcasters with Aggregates

Define upcasters in the aggregate definition to keep them co-located with the domain logic:

```typescript
const Order = defineAggregate<OrderEvents>()({
  streamPrefix: "Order",
  initialState: () => ({
    /* ... */
  }),
  evolve: {
    /* ... */
  },

  upcasters: [
    {
      eventType: "OrderPlaced",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast(data: { total: number }) {
        return { ...data, currency: "EUR" };
      },
    },
  ],
});

// At startup: register all aggregate upcasters
eventStore.registerUpcasters(Order.getUpcasters());
```

---

## Writing New Events with Schema Versions

When you create a new schema version, set the `schemaVersion` on new events so they don't get upcasted unnecessarily:

```typescript
await Order.append(eventStore, orderId, {
  expectedVersion: order.version,
  events: [
    {
      type: "OrderPlaced",
      data: { total: 99.99, currency: "USD" },
      schemaVersion: 2, // New events are already v2
    },
  ],
});
```

If `schemaVersion` is omitted, it defaults to `1`.

---

## Best Practices

1. **Keep upcasters pure** -- They should be simple data transformations with no side effects or async operations.
2. **Never skip versions** -- If you have v1, v2, and v3, you need both v1->v2 and v2->v3 upcasters. Don't create v1->v3 shortcuts.
3. **Co-locate with aggregates** -- Define upcasters in the aggregate definition to keep schema evolution close to the domain logic.
4. **Register at startup** -- All upcasters must be registered before any read operations. The `setup()` -> `registerUpcasters()` -> serve pattern ensures this.
5. **Test upcaster chains** -- Verify that old events are correctly transformed through multiple versions. See the test suite in `tests/event-store-upcasting.test.ts`.

---

## Step-by-Step Migration Guide

When you need to change the shape of an existing event type, follow this checklist. The examples below assume you're adding a `currency` field to `OrderPlaced`.

### Step 1: Define the upcaster

Write a pure transformation from the old shape to the new shape. Place it in the aggregate definition file:

```typescript
// backend/domains/orders/aggregate.ts

const Order = defineAggregate<OrderEvents>()({
  streamPrefix: "Order",
  initialState: () => ({ total: 0, currency: "EUR" }),
  evolve: {
    // Evolve handlers ALWAYS expect the LATEST shape.
    // Use optional chaining for tombstone safety.
    OrderPlaced: (state, event) => ({
      ...state,
      total: event.data?.total ?? state.total,
      currency: event.data?.currency ?? state.currency,
    }),
  },

  upcasters: [
    {
      eventType: "OrderPlaced",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast(data: { total: number }) {
        return { ...data, currency: "EUR" }; // default for legacy events
      },
    },
  ],
});
```

### Step 2: Update the event type map

Add the new field to the TypeScript type:

```typescript
type OrderEvents = {
  // Before: OrderPlaced: { total: number };
  OrderPlaced: { total: number; currency: string }; // v2
};
```

### Step 3: Register upcasters at startup

In the startup code (e.g., `instrumentation.ts` or wherever `eventStore.setup()` runs):

```typescript
await eventStore.setup();
eventStore.registerUpcasters(Order.getUpcasters());
```

### Step 4: Update new event writes to use the new schema version

New events appended after the change must declare their schema version so the upcaster is not applied to them:

```typescript
await Order.append(eventStore, orderId, {
  expectedVersion: order.version,
  events: [
    {
      type: "OrderPlaced",
      data: { total: 99.99, currency: "USD" },
      schemaVersion: 2, // Mark as v2 — upcaster won't touch it
    },
  ],
});
```

If `schemaVersion` is omitted, it defaults to `1` (and the upcaster WILL run on read).

### Step 5: Delete stale snapshots (if applicable)

If the aggregate uses `snapshot: { every: N }`, existing snapshots contain the old state shape. They must be invalidated:

```typescript
// One-time cleanup — run once after deploying the upcaster
const streams = await eventStore.listStreams({ prefix: "Order" });
for (const streamId of streams) {
  await eventStore.deleteSnapshot(streamId);
}
```

The next `load()` call will replay all events (with upcasting) and auto-save a fresh snapshot.

**Why this is necessary:** Snapshots store the computed aggregate state, not raw event data. Upcasters only transform events — they don't touch snapshots. A stale snapshot from before the schema change would have the old state shape, causing the aggregate to rebuild from an incorrect base.

### Step 6: Write tests

Add tests to `tests/event-store-upcasting.test.ts` covering:

1. **Legacy event transformation** — Insert a raw v1 event via SQL, verify it loads as v2.
2. **Mixed-version stream** — A stream with both v1 (legacy) and v2 (new) events. Only v1 events should be upcasted.
3. **Aggregate state rebuild** — Use `defineAggregate` with `evolve` handlers that expect v2 shape. Verify the aggregate state is correct when replaying mixed-version events.
4. **DB immutability** — Verify the stored database row is unchanged after loading with upcasters.

### Step 7: Deploy

Upcasters are backward-compatible by design. The deployment order does not matter:

- If the new code (with upcasters) reads old events → upcasted transparently.
- If old code (without upcasters) reads old events → works as before.
- If old code reads new v2 events → depends on your evolve handler. Use optional chaining (`event.data?.currency ?? state.currency`) for safety.

---

## Common Migration Scenarios

### Adding a required field

```typescript
// v1: { name: string }
// v2: { name: string; email: string }
{
  eventType: "UserCreated",
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(data: { name: string }) {
    return { ...data, email: "unknown@migrated.com" };
  },
}
```

### Renaming a field

```typescript
// v1: { userName: string }
// v2: { name: string }
{
  eventType: "UserCreated",
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(data: { userName: string }) {
    const { userName, ...rest } = data;
    return { ...rest, name: userName };
  },
}
```

### Restructuring nested data

```typescript
// v1: { street: string; city: string }
// v2: { address: { street: string; city: string } }
{
  eventType: "AddressChanged",
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(data: { street: string; city: string }) {
    return { address: { street: data.street, city: data.city } };
  },
}
```

### Changing a field type

```typescript
// v1: { amount: string }  (stored as string "99.99")
// v2: { amount: number }  (stored as number 99.99)
{
  eventType: "PaymentReceived",
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(data: { amount: string }) {
    return { ...data, amount: parseFloat(data.amount) };
  },
}
```

### Removing a field

```typescript
// v1: { name: string; legacyId: string }
// v2: { name: string }
{
  eventType: "UserCreated",
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  upcast(data: { name: string; legacyId: string }) {
    const { legacyId, ...rest } = data;
    return rest;
  },
}
```
