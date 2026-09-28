import type { Pool } from "pg";

import type { CryptoKeyManager } from "./crypto/crypto-key-manager";
import type { UpcasterRegistry } from "./upcaster/upcaster-registry";
import {
  createCryptoKey as createCryptoKeyOp,
  revokeCryptoKey as revokeCryptoKeyOp,
} from "./crypto/crypto-key-operations";
import { CryptoSecretsRequiredError } from "./errors";
import { cleanupOutbox, processOutbox } from "./outbox/outbox-processor";
import { cleanupIdempotencyKeys } from "./stream/idempotency";
import { inTransaction, withClient } from "./pg-helpers";
import { computeSafeWatermark } from "./stream/compute-safe-watermark";
import { runProjection as runProjectionFn } from "./projection/run-projection";
import { DEFAULT_PROJECTION_BATCH_SIZE } from "./event-store-constants";
import type { OutboxHandler, Projection } from "./types";

interface EventStoreMaintenanceOptions {
  pool: Pool;
  schema: string;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry;
}

/** Owns EventStore operations that maintain derived infrastructure. */
export class EventStoreMaintenance {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly cryptoKeyManager: CryptoKeyManager | null;
  private readonly upcasterRegistry: UpcasterRegistry;

  constructor(options: EventStoreMaintenanceOptions) {
    this.pool = options.pool;
    this.schema = options.schema;
    this.cryptoKeyManager = options.cryptoKeyManager;
    this.upcasterRegistry = options.upcasterRegistry;
  }

  createCryptoKey(keyId: string): Promise<void> {
    return createCryptoKeyOp({
      pool: this.pool,
      schema: this.schema,
      manager: this.requireCryptoKeyManager(),
      keyId,
    });
  }

  revokeKey(keyId: string): Promise<void> {
    return revokeCryptoKeyOp({
      pool: this.pool,
      schema: this.schema,
      manager: this.requireCryptoKeyManager(),
      keyId,
    });
  }

  processOutbox(handler: OutboxHandler, limit?: number): Promise<number> {
    return processOutbox({
      pool: this.pool,
      schema: this.schema,
      handler,
      limit,
    });
  }

  cleanupOutbox(olderThanMs?: number, batchSize?: number): Promise<number> {
    return cleanupOutbox({
      pool: this.pool,
      schema: this.schema,
      olderThanMs,
      batchSize,
    });
  }

  cleanupIdempotencyKeys(
    olderThanMs?: number,
    batchSize?: number,
  ): Promise<number> {
    return cleanupIdempotencyKeys({
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
    // A short fence must not hold an exclusive writer lock through the user
    // handler's transaction. The certified position remains safe afterward.
    const safeWatermark = await withClient(this.pool, (client) =>
      computeSafeWatermark({ client, schema: this.schema }),
    );
    return inTransaction(this.pool, (client) =>
      runProjectionFn({
        client,
        schema: this.schema,
        projection,
        batchSize: batchSize ?? DEFAULT_PROJECTION_BATCH_SIZE,
        safeWatermark,
        cryptoKeyManager: this.cryptoKeyManager,
        upcasterRegistry: this.upcasterRegistry,
      }),
    );
  }

  private requireCryptoKeyManager(): CryptoKeyManager {
    if (!this.cryptoKeyManager) throw new CryptoSecretsRequiredError();
    return this.cryptoKeyManager;
  }
}
