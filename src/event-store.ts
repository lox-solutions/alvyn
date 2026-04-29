import type { Pool, PoolClient } from "pg";

import { CryptoKeyManager } from "./crypto/crypto-key-manager";
import {
  EventStoreNotInitializedError,
  InvalidSchemaNameError,
  MasterKeyRequiredError,
  OptimisticConcurrencyError,
} from "./errors";
import { markOutboxProcessed, pollOutbox } from "./outbox/outbox-relay";
import { runProjection as runProjectionFn } from "./projection/projection-runner";
import { runMigrations } from "./schema/migrations";
import {
  deleteSnapshot as deleteSnapshotFn,
  loadSnapshot as loadSnapshotFn,
  saveSnapshot as saveSnapshotFn,
} from "./snapshot/snapshot-store";
import {
  listStreams as listStreamsFn,
  readStream,
} from "./stream/stream-reader";
import { appendToStream } from "./stream/stream-writer";
import type {
  AppendInput,
  AppendResult,
  EventStoreConfig,
  ListStreamsOptions,
  OutboxHandler,
  Projection,
  ReplayedEvent,
  SaveSnapshotInput,
  Snapshot,
  Upcaster,
} from "./types";
import { UpcasterRegistry } from "./upcaster/upcaster-registry";

const SCHEMA_NAME_REGEX = /^[a-z_][a-z0-9_]{0,62}$/;
const DEFAULT_SCHEMA = "event_store";
const DEFAULT_OUTBOX_BATCH_SIZE = 100;
const DEFAULT_CLEANUP_BATCH_SIZE = 1000;
const DEFAULT_PROJECTION_BATCH_SIZE = 500;

/**
 * The main entry point for the event store library.
 *
 * Produces and stores CloudEvents v1.0.2 compliant events.
 * Each stored event has first-class `id`, `source`, `specversion`, `type`,
 * `subject`, `time`, and `datacontenttype` attributes per the spec.
 *
 * Composes all internal modules (stream reader/writer, crypto, snapshots,
 * outbox, projections, upcasters) into a single, cohesive API.
 *
 * Usage:
 * ```typescript
 * const eventStore = new EventStore({
 *   pool: new Pool({ connectionString }),
 *   masterEncryptionKey: process.env.EVENT_STORE_MASTER_KEY,
 *   defaultSource: "urn:myapp:order-service",
 * });
 * await eventStore.setup(); // idempotent — safe on every startup
 * ```
 */
export class EventStore {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly defaultSource: string;
  private readonly cryptoKeyManager: CryptoKeyManager | null;
  private readonly upcasterRegistry: UpcasterRegistry;
  private initialized = false;

  constructor(config: EventStoreConfig) {
    this.pool = config.pool;
    this.schema = config.schema ?? DEFAULT_SCHEMA;
    this.defaultSource = config.defaultSource ?? "event-store";
    this.upcasterRegistry = new UpcasterRegistry();

    // Validate schema name to prevent SQL injection
    if (!SCHEMA_NAME_REGEX.test(this.schema)) {
      throw new InvalidSchemaNameError(this.schema);
    }

    // Initialize crypto manager only if master key is provided
    this.cryptoKeyManager = config.masterEncryptionKey
      ? new CryptoKeyManager(config.masterEncryptionKey)
      : null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Runs idempotent schema migrations (CREATE TABLE IF NOT EXISTS).
   * Safe to call on every application startup.
   */
  async setup(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await runMigrations(client, this.schema);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Stream Operations
  // ---------------------------------------------------------------------------

  /**
   * Returns the current version (max stream_version) for a stream.
   * Returns 0 if the stream does not exist.
   *
   * This is much cheaper than load() when you only need the version number.
   */
  async getStreamVersion(streamId: string): Promise<number> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      const result = await client.query<{ max_version: number | null }>(
        `SELECT MAX(stream_version) as max_version FROM ${this.schema}.events WHERE stream_id = $1`,
        [streamId],
      );
      return result.rows[0]?.max_version ?? 0;
    } finally {
      client.release();
    }
  }

  /**
   * Appends CloudEvents v1.0.2 compliant events to a stream with
   * optimistic concurrency control.
   *
   * Each event gets a unique `id` (format: `"{streamId}/{streamVersion}"`),
   * a `source` (from event input or `defaultSource`), and all other
   * required CloudEvents attributes populated automatically.
   *
   * @throws OptimisticConcurrencyError if expectedVersion doesn't match
   * @throws CryptoKeyRevokedError if encrypting with a revoked key
   */
  async append<T = unknown>(
    input: AppendInput<T>,
    options?: { client?: PoolClient },
  ): Promise<AppendResult> {
    this.ensureInitialized();

    if (options?.client) {
      return appendToStream(
        options.client,
        this.schema,
        { ...input, defaultSource: this.defaultSource },
        this.cryptoKeyManager,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await appendToStream(
        client,
        this.schema,
        { ...input, defaultSource: this.defaultSource },
        this.cryptoKeyManager,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Loads all events for a stream (from version 1).
   * Handles decryption and upcasting automatically.
   * Returns CloudEvents v1.0.2 compliant StoredEvent objects.
   *
   * @param maxEvents - Optional limit on number of events to load.
   *   Use this to prevent unbounded memory usage on large streams.
   */
  async load<T = unknown>(
    streamId: string,
    maxEvents?: number,
  ): Promise<ReplayedEvent<T>[]> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      return await readStream<T>(
        client,
        this.schema,
        streamId,
        1,
        this.cryptoKeyManager,
        this.upcasterRegistry,
        maxEvents,
      );
    } finally {
      client.release();
    }
  }

  /**
   * Loads events for a stream starting from a specific version.
   *
   * @param maxEvents - Optional limit on number of events to load.
   */
  async loadFrom<T = unknown>(
    streamId: string,
    fromVersion: number,
    maxEvents?: number,
  ): Promise<ReplayedEvent<T>[]> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      return await readStream<T>(
        client,
        this.schema,
        streamId,
        fromVersion,
        this.cryptoKeyManager,
        this.upcasterRegistry,
        maxEvents,
      );
    } finally {
      client.release();
    }
  }

  /**
   * Loads a stream using its snapshot (if any) + subsequent events.
   * This is the most efficient way to rebuild aggregate state.
   */
  async loadWithSnapshot<T = unknown>(
    streamId: string,
  ): Promise<{ snapshot: Snapshot<T> | null; events: ReplayedEvent<T>[] }> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      const snapshot = await loadSnapshotFn<T>(client, this.schema, streamId);
      const fromVersion = snapshot ? snapshot.streamVersion + 1 : 1;
      const events = await readStream<T>(
        client,
        this.schema,
        streamId,
        fromVersion,
        this.cryptoKeyManager,
        this.upcasterRegistry,
      );

      return { snapshot, events };
    } finally {
      client.release();
    }
  }

  /**
   * Lists distinct stream IDs, optionally filtered by prefix.
   *
   * Uses the B-tree index on `(stream_id, stream_version)` for efficient
   * prefix scans. Suitable for low-to-moderate frequency queries such as
   * listing aggregate instances. For high-frequency or complex queries,
   * consider building a projection-based read model instead.
   *
   * ```typescript
   * // List all streams
   * const allStreams = await eventStore.listStreams();
   *
   * // List streams for a specific aggregate
   * const orderStreams = await eventStore.listStreams({ prefix: "Order", limit: 50 });
   * ```
   *
   * @param options.prefix - Stream ID prefix (e.g. "AgentRun"). The separator "-" is appended automatically.
   * @param options.limit - Maximum number of stream IDs to return (default: 100).
   * @returns Array of full stream IDs (e.g. ["AgentRun-abc123", "AgentRun-def456"]).
   */
  async listStreams(options?: ListStreamsOptions): Promise<string[]> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      return await listStreamsFn(
        client,
        this.schema,
        options?.prefix,
        options?.limit,
      );
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  /**
   * Saves a snapshot for a stream.
   * Overwrites any existing snapshot for the same stream_id.
   */
  async saveSnapshot<T = unknown>(input: SaveSnapshotInput<T>): Promise<void> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await saveSnapshotFn(client, this.schema, input);
    } finally {
      client.release();
    }
  }

  /**
   * Deletes the snapshot for a stream.
   */
  async deleteSnapshot(streamId: string): Promise<void> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await deleteSnapshotFn(client, this.schema, streamId);
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Crypto / GDPR
  // ---------------------------------------------------------------------------

  /**
   * Creates a new per-entity encryption key.
   * Idempotent — if the key already exists, this is a no-op.
   */
  async createCryptoKey(keyId: string): Promise<void> {
    this.ensureInitialized();
    this.ensureCryptoAvailable();

    const client = await this.pool.connect();
    try {
      await this.cryptoKeyManager!.createKey(client, this.schema, keyId);
    } finally {
      client.release();
    }
  }

  /**
   * Revokes a crypto key (GDPR "right to erasure").
   * Events encrypted with this key will be returned as tombstones on read.
   * Also deletes any snapshots for streams using this key (they may contain PII).
   */
  async revokeKey(keyId: string): Promise<void> {
    this.ensureInitialized();
    this.ensureCryptoAvailable();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await this.cryptoKeyManager!.revokeKey(client, this.schema, keyId);

      // Delete snapshots for all streams that used this crypto key,
      // because snapshots may contain PII from the encrypted events.
      // Uses a single query instead of per-stream deletes for efficiency.
      await client.query(
        `DELETE FROM ${this.schema}.snapshots
         WHERE stream_id IN (
           SELECT DISTINCT stream_id FROM ${this.schema}.events WHERE crypto_key_id = $1
         )`,
        [keyId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Outbox
  // ---------------------------------------------------------------------------

  /**
   * Processes pending outbox entries atomically.
   *
   * Outbox payloads are CloudEvents v1.0.2 JSON format compliant.
   *
   * The handler runs inside the same transaction that locks the entries.
   * Entries are marked as processed only after the handler succeeds.
   * If the handler throws, the transaction is rolled back and the entries
   * remain available for the next poll (at-least-once delivery).
   *
   * Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing
   * across replicas — multiple workers get disjoint sets of entries.
   *
   * @param handler - Called with the batch of entries and the transaction client.
   *   Use the provided client for any database writes that must be atomic with
   *   the outbox processing. Throw to abort.
   * @param limit - Max entries per batch (default: 100).
   * @returns The number of entries processed.
   *
   * ```typescript
   * const processed = await eventStore.processOutbox(async (entries, client) => {
   *   for (const entry of entries) {
   *     await messageBroker.publish(entry.topic, entry.payload);
   *     // Or do transactional DB writes using the provided client:
   *     // await client.query("INSERT INTO ...", [...]);
   *   }
   * });
   * ```
   */
  async processOutbox(handler: OutboxHandler, limit?: number): Promise<number> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const entries = await pollOutbox(
        client,
        this.schema,
        limit ?? DEFAULT_OUTBOX_BATCH_SIZE,
      );

      if (entries.length === 0) {
        await client.query("COMMIT");
        return 0;
      }

      // Handler runs within the transaction — entries remain locked.
      // The client is passed so the handler can participate in the transaction.
      await handler(entries, client);

      // Mark as processed only after handler succeeds
      const ids = entries.map((e) => e.id);
      await markOutboxProcessed(client, this.schema, ids);

      await client.query("COMMIT");
      return entries.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Deletes processed outbox entries older than the specified age.
   * Call this periodically (e.g. daily) to prevent unbounded table growth.
   *
   * Deletes in batches to avoid long lock holds and excessive WAL generation
   * when there are millions of processed entries.
   *
   * @param olderThanMs - Delete entries processed more than this many ms ago (default: 7 days)
   * @param batchSize - Max entries to delete per batch (default: 1000)
   * @returns The total number of entries deleted across all batches.
   */
  async cleanupOutbox(
    olderThanMs: number = 7 * 24 * 60 * 60 * 1000,
    batchSize: number = DEFAULT_CLEANUP_BATCH_SIZE,
  ): Promise<number> {
    this.ensureInitialized();

    let totalDeleted = 0;

    // Loop in batches to avoid unbounded DELETE that could cause
    // long lock holds and huge WAL at high throughput.

    while (true) {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `DELETE FROM ${this.schema}.outbox
           WHERE id IN (
             SELECT id FROM ${this.schema}.outbox
             WHERE processed_at IS NOT NULL
               AND processed_at < now() - make_interval(secs => $1)
             LIMIT $2
           )`,
          [olderThanMs / 1000, batchSize],
        );

        const deleted = result.rowCount ?? 0;
        totalDeleted += deleted;

        // If we deleted fewer than batchSize, we're done
        if (deleted < batchSize) {
          break;
        }
      } finally {
        client.release();
      }
    }

    return totalDeleted;
  }

  // ---------------------------------------------------------------------------
  // Projections
  // ---------------------------------------------------------------------------

  /**
   * Runs a projection by processing the next batch of events.
   * Returns the number of events processed.
   */
  async runProjection(
    projection: Projection,
    batchSize?: number,
  ): Promise<number> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const count = await runProjectionFn(
        client,
        this.schema,
        projection,
        batchSize ?? DEFAULT_PROJECTION_BATCH_SIZE,
      );
      await client.query("COMMIT");
      return count;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Upcasters
  // ---------------------------------------------------------------------------

  /**
   * Registers an upcaster for schema evolution.
   */
  registerUpcaster(upcaster: Upcaster): void {
    this.upcasterRegistry.register(upcaster);
  }

  /**
   * Registers multiple upcasters at once.
   */
  registerUpcasters(upcasters: Upcaster[]): void {
    this.upcasterRegistry.registerAll(upcasters);
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  /**
   * Executes a function within a PostgreSQL transaction.
   * Useful for coordinating event store writes with other database writes.
   *
   * ```typescript
   * await eventStore.withTransaction(async (client) => {
   *   await eventStore.append({ ... }, { client });
   *   await client.query("INSERT INTO ...", [...]);
   * });
   * ```
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retries a function that may fail with {@link OptimisticConcurrencyError}.
   *
   * Use this to safely implement read-then-write patterns under concurrency:
   *
   * ```typescript
   * await eventStore.withRetry(async () => {
   *   const version = await eventStore.getStreamVersion(streamId);
   *   await eventStore.append({
   *     streamId,
   *     expectedVersion: version,
   *     events: [{ type: "OrderPlaced", data: { ... } }],
   *   });
   * });
   * ```
   *
   * @param fn - The function to execute. Will be called up to `maxRetries + 1` times.
   * @param maxRetries - Maximum number of retries (default: 3).
   * @returns The return value of `fn` on success.
   * @throws The last error if all retries are exhausted, or any non-concurrency error immediately.
   */
  async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    this.ensureInitialized();

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (
          error instanceof OptimisticConcurrencyError &&
          attempt < maxRetries
        ) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    // This is unreachable in practice (the loop always throws or returns),
    // but TypeScript can't prove that, so we throw the last error.
    throw lastError;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new EventStoreNotInitializedError();
    }
  }

  private ensureCryptoAvailable(): void {
    if (!this.cryptoKeyManager) {
      throw new MasterKeyRequiredError();
    }
  }
}
