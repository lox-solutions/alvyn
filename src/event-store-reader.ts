import type { Pool, PoolClient } from "pg";

import type { CryptoKeyManager } from "./crypto/crypto-key-manager";
import { withClient } from "./pg-helpers";
import {
  listStreams as listStreamsFn,
  readLatestEventByType,
  readStream,
} from "./stream/stream-reader";
import type { UpcasterRegistry } from "./upcaster/upcaster-registry";
import type { ListStreamsOptions, ReplayedEvent } from "./types";

interface EventStoreReaderOptions {
  pool: Pool;
  schema: string;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry;
}

interface LoadFromOptions {
  fromVersion: number;
  maxEvents?: number;
  client?: PoolClient;
}

interface LoadLatestEventByTypeOptions {
  streamId: string;
  eventType: string;
  client?: PoolClient;
}

/** Coordinates EventStore's database-backed read operations. */
export class EventStoreReader {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly cryptoKeyManager: CryptoKeyManager | null;
  private readonly upcasterRegistry: UpcasterRegistry;

  constructor(options: EventStoreReaderOptions) {
    this.pool = options.pool;
    this.schema = options.schema;
    this.cryptoKeyManager = options.cryptoKeyManager;
    this.upcasterRegistry = options.upcasterRegistry;
  }

  async load<T = unknown>(
    streamId: string,
    maxEvents?: number,
  ): Promise<ReplayedEvent<T>[]> {
    return this.withClient((client) =>
      readStream<T>({
        client,
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
    options: LoadFromOptions,
  ): Promise<ReplayedEvent<T>[]> {
    const read = (client: PoolClient) =>
      readStream<T>({
        client,
        schema: this.schema,
        streamId,
        fromVersion: options.fromVersion,
        cryptoKeyManager: this.cryptoKeyManager,
        upcasterRegistry: this.upcasterRegistry,
        maxEvents: options.maxEvents,
      });
    if (options.client) return read(options.client);
    return this.withClient(read);
  }

  async loadLatestEventByType<T = unknown>(
    options: LoadLatestEventByTypeOptions,
  ): Promise<ReplayedEvent<T> | null> {
    const read = (client: PoolClient) =>
      readLatestEventByType<T>({
        client,
        schema: this.schema,
        streamId: options.streamId,
        eventType: options.eventType,
        cryptoKeyManager: this.cryptoKeyManager,
        upcasterRegistry: this.upcasterRegistry,
      });
    if (options.client) return read(options.client);
    return this.withClient(read);
  }

  listStreams(options?: ListStreamsOptions): Promise<string[]> {
    return this.withClient((client) =>
      listStreamsFn({
        client,
        schema: this.schema,
        prefix: options?.prefix,
        limit: options?.limit,
      }),
    );
  }

  private withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return withClient(this.pool, fn);
  }
}
