<div align="center">
  <picture>
    <img alt="Alvyn" src="./logo.png" width="315">
  </picture>
</div>

<br>

# Alvyn

> **Beta** — Alvyn is under active development. The API may change before v1.0. We encourage contributions and feedback to help make this a battle-tested library.

A production-grade event sourcing library for **Node.js** and **PostgreSQL**. Type-safe aggregates, GDPR crypto-shredding, projections, transactional outbox, and schema evolution — all in one package.

[![CI](https://github.com/lox-solutions/alvyn/actions/workflows/ci.yml/badge.svg)](https://github.com/lox-solutions/alvyn/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@lox-solutions/alvyn)](https://www.npmjs.com/package/@lox-solutions/alvyn)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why Alvyn?

Most event sourcing libraries for Node.js are either too minimal (just an append/read layer) or too opinionated (forcing a specific framework). Alvyn sits in the middle — it gives you the building blocks for production event-sourced systems without dictating your application architecture.

- **PostgreSQL only** — No abstraction over multiple databases. This lets Alvyn use advisory locks, `FOR UPDATE SKIP LOCKED`, transactional outbox, and schema isolation as first-class features.
- **TypeScript first** — `defineAggregate` and `defineProjection` use curried generics for full type inference. No casting, no `any`.
- **GDPR built-in** — Per-entity AES-256-GCM envelope encryption with key revocation. Revoking a key makes all PII for that entity cryptographically irrecoverable.
- **CloudEvents v1.0.2** — Every stored event complies with the CloudEvents specification.

## Install

```bash
npm install @lox-solutions/alvyn pg
# or
pnpm add @lox-solutions/alvyn pg
```

`pg` is a peer dependency — you provide the connection pool.

## Quick Start

```typescript
import { Pool } from "pg";
import { EventStore, defineAggregate } from "@lox-solutions/alvyn";

// 1. Create the event store
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const eventStore = new EventStore({ pool });
await eventStore.setup(); // idempotent — safe on every startup

// 2. Define an aggregate
type OrderEvents = {
  OrderPlaced: { customerId: string; total: number };
  OrderShipped: { trackingNumber: string };
};

const Order = defineAggregate<OrderEvents>()({
  streamPrefix: "Order",
  initialState: () => ({ status: "pending", total: 0 }),
  evolve: {
    OrderPlaced: (state, event) => ({
      ...state,
      status: "placed",
      total: event.data?.total ?? 0,
    }),
    OrderShipped: (state) => ({ ...state, status: "shipped" }),
  },
});

// 3. Use it
const order = await Order.load(eventStore, "order-123");

await Order.append(eventStore, "order-123", {
  expectedVersion: order.version,
  events: [{ type: "OrderShipped", data: { trackingNumber: "TRACK-456" } }],
});
```

## Features

| Feature                  | Description                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| **Aggregates**           | `defineAggregate` with full TypeScript inference, OCC, and auto-snapshots |
| **Projections**          | `defineProjection` for typed read models with checkpoint tracking         |
| **Crypto-Shredding**     | Per-entity AES-256-GCM envelope encryption for GDPR compliance            |
| **Transactional Outbox** | At-least-once delivery to external systems, atomic with event writes      |
| **Schema Evolution**     | Read-time upcasters that transform old event shapes without migrations    |
| **Snapshots**            | Automatic snapshot management with Map/Set serialization support          |
| **CloudEvents**          | All events comply with CloudEvents v1.0.2 specification                   |

## Documentation

Full documentation is available at **[lox-solutions.github.io/alvyn](https://lox-solutions.github.io/alvyn)**.

- [Getting Started](https://lox-solutions.github.io/alvyn/docs)
- [Aggregates](https://lox-solutions.github.io/alvyn/docs/aggregates)
- [Crypto-Shredding & GDPR](https://lox-solutions.github.io/alvyn/docs/crypto-shredding)
- [Projections & Outbox](https://lox-solutions.github.io/alvyn/docs/projections)
- [Schema Evolution](https://lox-solutions.github.io/alvyn/docs/schema-evolution)
- [API Reference](https://lox-solutions.github.io/alvyn/docs/api-reference)
- [Database Schema](https://lox-solutions.github.io/alvyn/docs/database-schema)

## Requirements

- Node.js >= 18
- PostgreSQL >= 14
- `pg` ^8 (peer dependency)

## Contributing

Alvyn is in beta and we actively welcome contributions. Whether it's bug reports, feature requests, documentation improvements, or code — all contributions help make this library more robust.

```bash
# Clone and install
git clone https://github.com/lox-solutions/alvyn.git
cd alvyn
pnpm install

# Run tests (requires Docker for PostgreSQL via Testcontainers)
pnpm vitest run

# Run with coverage
pnpm vitest run --coverage
```

The test suite uses [Testcontainers](https://testcontainers.com/) to spin up PostgreSQL instances automatically — you just need Docker running.

Please open an [issue](https://github.com/lox-solutions/alvyn/issues) or [pull request](https://github.com/lox-solutions/alvyn/pulls) on GitHub.

## License

[MIT](LICENSE)
