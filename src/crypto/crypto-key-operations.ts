import type { Pool } from "pg";

import type { CryptoKeyManager } from "./crypto-key-manager";
import { inTransaction, withClient } from "../pg-helpers";

interface CryptoKeyOperationOptions {
  pool: Pool;
  schema: string;
  manager: CryptoKeyManager;
  keyId: string;
}

/** Creates a new per-entity crypto key. */
export function createCryptoKey(
  options: CryptoKeyOperationOptions,
): Promise<void> {
  const { pool, schema, manager, keyId } = options;
  return withClient(pool, (c) =>
    manager.createKey({ client: c, schema, keyId }),
  );
}

/**
 * Revokes a crypto key and crypto-shreds dependent data: it also deletes any
 * snapshots derived from events encrypted with that key, since those snapshots
 * may contain now-irrecoverable PII.
 */
export function revokeCryptoKey(
  options: CryptoKeyOperationOptions,
): Promise<void> {
  const { pool, schema, manager, keyId } = options;
  return inTransaction(pool, async (c) => {
    await manager.revokeKey({ client: c, schema, keyId });
    await c.query(
      `DELETE FROM ${schema}.snapshots WHERE stream_id IN (SELECT DISTINCT stream_id FROM ${schema}.events WHERE crypto_key_id = $1)`,
      [keyId],
    );
  });
}
