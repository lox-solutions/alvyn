import type { Pool } from "pg";

import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import { withClient } from "../pg-helpers";
import { readStream } from "../stream/stream-reader";
import type { ReplayedEvent, Snapshot } from "../types";
import type { UpcasterRegistry } from "../upcaster/upcaster-registry";
import { loadSnapshot as loadSnapshotFn } from "./snapshot-store";

/**
 * Loads the latest snapshot for a stream (if any) plus the events appended
 * after it, so the caller can rehydrate state from the snapshot forward.
 */
export async function loadWithSnapshot<T = unknown>(options: {
  pool: Pool;
  schema: string;
  streamId: string;
  cryptoKeyManager: CryptoKeyManager | null;
  upcasterRegistry: UpcasterRegistry;
}): Promise<{ snapshot: Snapshot<T> | null; events: ReplayedEvent<T>[] }> {
  const { pool, schema, streamId, cryptoKeyManager, upcasterRegistry } =
    options;
  return withClient(pool, async (client) => {
    const snapshot = await loadSnapshotFn<T>({ client, schema, streamId });
    const fromVersion = snapshot ? snapshot.streamVersion + 1 : 1;
    const events = await readStream<T>({
      client,
      schema,
      streamId,
      fromVersion,
      cryptoKeyManager,
      upcasterRegistry,
    });
    return { snapshot, events };
  });
}
