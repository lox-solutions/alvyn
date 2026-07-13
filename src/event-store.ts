import type { Pool, PoolClient } from "pg";
import { CryptoKeyManager } from "./crypto/crypto-key-manager";
import {
  createCryptoKey as createCryptoKeyOp,
  revokeCryptoKey as revokeCryptoKeyOp,
} from "./crypto/crypto-key-operations";
import {
  EventStoreNotInitializedError,
  InvalidSchemaNameError,
  MasterKeyRequiredError,
} from "./errors";
import { cleanupOutbox, processOutbox } from "./outbox/outbox-processor";
import {
  inTransaction,
  retryOnConcurrencyError,
  withClient,
} from "./pg-helpers";
import { runProjection as runProjectionFn } from "./projection/run-projection";
import { runMigrations } from "./schema/run-migrations";
import {
  listStreams as listStreamsFn,
  readLatestEventByType,
  readStream,
} from "./stream/stream-reader";
import { appendToStream } from "./stream/append-to-stream";
import { getStreamVersion as getStreamVersionFn } from "./stream/get-stream-version";
import { subscribe as subscribeFn } from "./subscription/subscribe";
import { createNotifyWaker } from "./subscription/create-notify-waker";
import type { SubscribeOptions } from "./subscription/subscribe-options";
import type {
  AppendInput,
  AppendResult,
  EventStoreConfig,
  ListStreamsOptions,
  OutboxHandler,
  Projection,
  ReplayedEvent,
  StoredEvent,
  Upcaster,
} from "./types";
import type { SnapshotHandle } from "./snapshot/types";
import { UpcasterRegistry } from "./upcaster/upcaster-registry";
import {
  SCHEMA_NAME_REGEX,
  DEFAULT_SCHEMA,
  DEFAULT_PROJECTION_BATCH_SIZE,
} from "./event-store-constants";

/** Main entry point for the event store library. */
export class EventStore {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly defaultSource: string;
  private readonly cryptoKeyManager: CryptoKeyManager | null;
  private readonly upcasterRegistry: UpcasterRegistry;
  private readonly snapshots: SnapshotHandle<unknown>[];
  private initialized = false;

  constructor(config: EventStoreConfig) {
    this.pool = config.pool;
    this.schema = config.schema ?? DEFAULT_SCHEMA;
    this.defaultSource = config.defaultSource ?? "event-store";
    this.upcasterRegistry = new UpcasterRegistry();
    this.snapshots = config.snapshots ?? [];
    if (!SCHEMA_NAME_REGEX.test(this.schema))
      throw new InvalidSchemaNameError(this.schema);
    this.cryptoKeyManager = config.masterEncryptionKey
      ? new CryptoKeyManager(config.masterEncryptionKey)
      : null;
  }

  async setup(): Promise<void> {
    await withClient(this.pool, (c) => runMigrations(c, this.schema));
    this.initialized = true;
  }

  async getStreamVersion(streamId: string): Promise<number> {
    this.ensureInitialized();
    return withClient(this.pool, (c) =>
      getStreamVersionFn({ client: c, schema: this.schema, streamId }),
    );
  }

  async append<T = unknown>(
    input: AppendInput<T>,
    options?: { client?: PoolClient },
  ): Promise<AppendResult> {
    this.ensureInitialized();
    const opts = {
      schema: this.schema,
      input: { ...input, defaultSource: this.defaultSource },
      cryptoKeyManager: this.cryptoKeyManager,
    };
    const appendAndMaintain = async (client: PoolClient) => {
      const result = await appendToStream({ client, ...opts });
      await this.updateRegisteredSnapshots(
        input.streamId,
        input.events,
        client,
      );
      return result;
    };
    if (options?.client) return appendAndMaintain(options.client);
    return inTransaction(this.pool, appendAndMaintain);
  }

  /** @internal Appends Alvyn-generated snapshot events. */
  async appendSnapshot<T = unknown>(
    input: AppendInput<T>,
    options?: { client?: PoolClient },
  ): Promise<AppendResult> {
    this.ensureInitialized();
    const opts = {
      schema: this.schema,
      input: { ...input, defaultSource: this.defaultSource },
      cryptoKeyManager: this.cryptoKeyManager,
      allowReservedEventTypes: true,
    };
    if (options?.client)
      return appendToStream({ client: options.client, ...opts });
    return inTransaction(this.pool, (c) =>
      appendToStream({ client: c, ...opts }),
    );
  }

  async load<T = unknown>(
    streamId: string,
    maxEvents?: number,
  ): Promise<ReplayedEvent<T>[]> {
    this.ensureInitialized();
    return withClient(this.pool, (c) =>
      readStream<T>({
        client: c,
        schema: this.schema,
        streamId,
        fromVersion: 1,
        cryptoKeyManager: this.cryptoKeyManager,
        upcasterRegistry: this.upcasterRegistry,
        maxEvents,
      }),
    );
  }

  async loadFrom<T = unknown>(
    streamId: string,
    options: { fromVersion: number; maxEvents?: number; client?: PoolClient },
  ): Promise<ReplayedEvent<T>[]> {
    this.ensureInitialized();
    const read = (c: PoolClient) =>
      readStream<T>({
        client: c,
        schema: this.schema,
        streamId,
        fromVersion: options.fromVersion,
        cryptoKeyManager: this.cryptoKeyManager,
        upcasterRegistry: this.upcasterRegistry,
        maxEvents: options.maxEvents,
      });
    if (options.client) return read(options.client);
    return withClient(this.pool, read);
  }

  /** @internal Loads the latest event of a specific type in a stream. */
  async loadLatestEventByType<T = unknown>(
    streamId: string,
    eventType: string,
    options?: { client?: PoolClient },
  ): Promise<ReplayedEvent<T> | null> {
    this.ensureInitialized();
    const read = (c: PoolClient) =>
      readLatestEventByType<T>({
        client: c,
        schema: this.schema,
        streamId,
        eventType,
        cryptoKeyManager: this.cryptoKeyManager,
        upcasterRegistry: this.upcasterRegistry,
      });
    if (options?.client) return read(options.client);
    return withClient(this.pool, read);
  }

  private async updateRegisteredSnapshots(
    streamId: string,
    events: AppendInput["events"],
    client: PoolClient,
  ): Promise<void> {
    if (this.snapshots.length === 0) return;
    const eventTypes = new Set(events.map((event) => event.type));
    for (const snapshot of this.snapshots) {
      if (!streamId.startsWith(`${snapshot.streamPrefix}-`)) continue;
      if (!snapshot.sourceEventTypes.some((type) => eventTypes.has(type)))
        continue;
      await snapshot.updateAfterAppend(this, streamId, { client });
    }
  }

  async listStreams(options?: ListStreamsOptions): Promise<string[]> {
    this.ensureInitialized();
    return withClient(this.pool, (c) =>
      listStreamsFn({
        client: c,
        schema: this.schema,
        prefix: options?.prefix,
        limit: options?.limit,
      }),
    );
  }

  async createCryptoKey(keyId: string): Promise<void> {
    this.ensureInitialized();
    this.ensureCryptoAvailable();
    return createCryptoKeyOp({
      pool: this.pool,
      schema: this.schema,
      manager: this.cryptoKeyManager!,
      keyId,
    });
  }

  async revokeKey(keyId: string): Promise<void> {
    this.ensureInitialized();
    this.ensureCryptoAvailable();
    return revokeCryptoKeyOp({
      pool: this.pool,
      schema: this.schema,
      manager: this.cryptoKeyManager!,
      keyId,
    });
  }

  async processOutbox(handler: OutboxHandler, limit?: number): Promise<number> {
    this.ensureInitialized();
    return processOutbox({
      pool: this.pool,
      schema: this.schema,
      handler,
      limit,
    });
  }

  async cleanupOutbox(
    olderThanMs?: number,
    batchSize?: number,
  ): Promise<number> {
    this.ensureInitialized();
    return cleanupOutbox({
      pool: this.pool,
      schema: this.schema,
      olderThanMs,
      batchSize,
    });
  }

  async runProjection(
    projection: Projection,
    batchSize?: number,
  ): Promise<number> {
    this.ensureInitialized();
    return inTransaction(this.pool, (c) =>
      runProjectionFn({
        client: c,
        schema: this.schema,
        projection,
        batchSize: batchSize ?? DEFAULT_PROJECTION_BATCH_SIZE,
      }),
    );
  }

  subscribe(options?: SubscribeOptions): AsyncIterable<StoredEvent> {
    this.ensureInitialized();
    return subscribeFn({
      pool: this.pool,
      schema: this.schema,
      options,
      createWaker: () => createNotifyWaker(this.pool, this.schema),
    });
  }

  registerUpcaster(upcaster: Upcaster): void {
    this.upcasterRegistry.register(upcaster);
  }
  registerUpcasters(upcasters: Upcaster[]): void {
    this.upcasterRegistry.registerAll(upcasters);
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    this.ensureInitialized();
    return inTransaction(this.pool, fn);
  }

  async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    this.ensureInitialized();
    return retryOnConcurrencyError(fn, maxRetries);
  }

  private ensureInitialized(): void {
    if (!this.initialized) throw new EventStoreNotInitializedError();
  }
  private ensureCryptoAvailable(): void {
    if (!this.cryptoKeyManager) throw new MasterKeyRequiredError();
  }
}
