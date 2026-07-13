import type { Pool, PoolClient } from "pg";
import { CryptoKeyManager } from "./crypto/crypto-key-manager";
import {
  EventStoreNotInitializedError,
  InvalidSchemaNameError,
} from "./errors";
import {
  inTransaction,
  retryOnConcurrencyError,
  withClient,
} from "./pg-helpers";
import { EventStoreReader } from "./event-store-reader";
import { EventStoreMaintenance } from "./event-store-maintenance";
import { runMigrations } from "./schema/run-migrations";
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
import { SCHEMA_NAME_REGEX, DEFAULT_SCHEMA } from "./event-store-constants";

interface LoadLatestEventByTypeOptions {
  streamId: string;
  eventType: string;
  client?: PoolClient;
}

/** Main entry point for the event store library. */
export class EventStore {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly defaultSource: string;
  private readonly cryptoKeyManager: CryptoKeyManager | null;
  private readonly upcasterRegistry: UpcasterRegistry;
  private readonly snapshots: SnapshotHandle<unknown>[];
  private readonly reader: EventStoreReader;
  private readonly maintenance: EventStoreMaintenance;
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
    this.reader = new EventStoreReader({
      pool: this.pool,
      schema: this.schema,
      cryptoKeyManager: this.cryptoKeyManager,
      upcasterRegistry: this.upcasterRegistry,
    });
    this.maintenance = new EventStoreMaintenance({
      pool: this.pool,
      schema: this.schema,
      cryptoKeyManager: this.cryptoKeyManager,
    });
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
      await this.updateRegisteredSnapshots({
        streamId: input.streamId,
        events: input.events,
        client,
      });
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
    return this.reader.load<T>(streamId, maxEvents);
  }

  async loadFrom<T = unknown>(
    streamId: string,
    options: { fromVersion: number; maxEvents?: number; client?: PoolClient },
  ): Promise<ReplayedEvent<T>[]> {
    this.ensureInitialized();
    return this.reader.loadFrom<T>(streamId, options);
  }

  /** @internal Loads the latest event of a specific type in a stream. */
  async loadLatestEventByType<T = unknown>(
    options: LoadLatestEventByTypeOptions,
  ): Promise<ReplayedEvent<T> | null> {
    this.ensureInitialized();
    return this.reader.loadLatestEventByType<T>(options);
  }

  private async updateRegisteredSnapshots(options: {
    streamId: string;
    events: AppendInput["events"];
    client: PoolClient;
  }): Promise<void> {
    const { streamId, events, client } = options;
    if (this.snapshots.length === 0) return;
    const eventTypes = new Set(events.map((event) => event.type));
    for (const snapshot of this.snapshots) {
      if (!streamId.startsWith(`${snapshot.streamPrefix}-`)) continue;
      if (!snapshot.sourceEventTypes.some((type) => eventTypes.has(type)))
        continue;
      await snapshot.updateAfterAppend({
        eventStore: this,
        streamId,
        options: { client },
      });
    }
  }

  async listStreams(options?: ListStreamsOptions): Promise<string[]> {
    this.ensureInitialized();
    return this.reader.listStreams(options);
  }

  async createCryptoKey(keyId: string): Promise<void> {
    this.ensureInitialized();
    return this.maintenance.createCryptoKey(keyId);
  }

  async revokeKey(keyId: string): Promise<void> {
    this.ensureInitialized();
    return this.maintenance.revokeKey(keyId);
  }

  async processOutbox(handler: OutboxHandler, limit?: number): Promise<number> {
    this.ensureInitialized();
    return this.maintenance.processOutbox(handler, limit);
  }

  async cleanupOutbox(
    olderThanMs?: number,
    batchSize?: number,
  ): Promise<number> {
    this.ensureInitialized();
    return this.maintenance.cleanupOutbox(olderThanMs, batchSize);
  }

  async runProjection(
    projection: Projection,
    batchSize?: number,
  ): Promise<number> {
    this.ensureInitialized();
    return this.maintenance.runProjection(projection, batchSize);
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
}
