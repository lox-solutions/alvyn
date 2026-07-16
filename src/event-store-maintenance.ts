import type { Pool } from "pg";

import type { CryptoKeyManager } from "./crypto/crypto-key-manager";
import {
  createCryptoKey as createCryptoKeyOp,
  revokeCryptoKey as revokeCryptoKeyOp,
} from "./crypto/crypto-key-operations";
import { CryptoSecretsRequiredError } from "./errors";
import { cleanupOutbox, processOutbox } from "./outbox/outbox-processor";
import { inTransaction } from "./pg-helpers";
import { runProjection as runProjectionFn } from "./projection/run-projection";
import { DEFAULT_PROJECTION_BATCH_SIZE } from "./event-store-constants";
import type { OutboxHandler, Projection } from "./types";

interface EventStoreMaintenanceOptions {
  pool: Pool;
  schema: string;
  cryptoKeyManager: CryptoKeyManager | null;
}

/** Owns EventStore operations that maintain derived infrastructure. */
export class EventStoreMaintenance {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly cryptoKeyManager: CryptoKeyManager | null;

  constructor(options: EventStoreMaintenanceOptions) {
    this.pool = options.pool;
    this.schema = options.schema;
    this.cryptoKeyManager = options.cryptoKeyManager;
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

  runProjection(projection: Projection, batchSize?: number): Promise<number> {
    return inTransaction(this.pool, (client) =>
      runProjectionFn({
        client,
        schema: this.schema,
        projection,
        batchSize: batchSize ?? DEFAULT_PROJECTION_BATCH_SIZE,
      }),
    );
  }

  private requireCryptoKeyManager(): CryptoKeyManager {
    if (!this.cryptoKeyManager) throw new CryptoSecretsRequiredError();
    return this.cryptoKeyManager;
  }
}
