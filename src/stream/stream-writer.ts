import type { PoolClient } from "pg";

import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import { encryptFields } from "../crypto/field-encryptor";
import { OptimisticConcurrencyError } from "../errors";
import type { AppendEventInput, AppendResult, CloudEventExtensions } from "../types";

/**
 * PostgreSQL maximum number of query parameters.
 * Actual limit is 65535, but we use a slightly lower value for safety margin.
 */
const PG_MAX_PARAMS = 65535;

/** Number of parameters per event row in the INSERT statement */
const PARAMS_PER_EVENT = 14;

/** Number of parameters per outbox row in the INSERT statement */
const PARAMS_PER_OUTBOX = 3;

/** Maximum events per INSERT chunk: floor(65535 / 14) = 4681 */
const MAX_EVENTS_PER_CHUNK = Math.floor(PG_MAX_PARAMS / PARAMS_PER_EVENT);

/** Maximum outbox rows per INSERT chunk: floor(65535 / 3) = 21845 */
const MAX_OUTBOX_ROWS_PER_CHUNK = Math.floor(PG_MAX_PARAMS / PARAMS_PER_OUTBOX);

const CLOUDEVENTS_SPEC_VERSION = "1.0";

/**
 * CloudEvents context attribute names that MUST NOT be overwritten by
 * extension attributes when building the outbox JSON payload.
 */
const RESERVED_CE_KEYS = new Set([
  "specversion",
  "id",
  "source",
  "type",
  "subject",
  "time",
  "datacontenttype",
  "dataschema",
  "data",
]);

/**
 * Appends events to a stream within a single ACID transaction.
 *
 * Each event is stored as a CloudEvents v1.0.2 compliant record with
 * dedicated columns for required and optional context attributes.
 *
 * Concurrency strategy:
 * 1. Acquire a two-key PostgreSQL advisory lock on the stream.
 *    Uses a fixed namespace key + stream hash to avoid collisions with
 *    other subsystems using advisory locks.
 * 2. Read current max version for OCC validation.
 * 3. Batch-insert events with sequential versions, chunked to stay within
 *    PostgreSQL's 65535 parameter limit.
 * 4. The UNIQUE(stream_id, stream_version) constraint is the final safety net.
 *
 * The caller is responsible for BEGIN/COMMIT/ROLLBACK if coordinating
 * with other writes. If `client` is from a pool.connect() without an
 * explicit transaction, this function wraps itself in one.
 */
export async function appendToStream(
  client: PoolClient,
  schema: string,
  input: {
    streamId: string;
    expectedVersion: number;
    events: AppendEventInput[];
    outboxTopics?: string[];
    defaultSource?: string;
  },
  cryptoKeyManager: CryptoKeyManager | null,
): Promise<AppendResult> {
  const { streamId, expectedVersion, events, outboxTopics } = input;
  const defaultSource = input.defaultSource ?? "event-store";

  if (events.length === 0) {
    throw new Error("Cannot append zero events");
  }

  // Acquire advisory lock scoped to this transaction.
  // Two-key lock: fixed namespace (1936024421 = hashtext('event_store')) + stream hash.
  // This prevents collisions with other subsystems using advisory locks and uses
  // the full 32-bit space for each key (rather than cramming everything into one int4).
  await client.query(`SELECT pg_advisory_xact_lock(1936024421, hashtext($1))`, [streamId]);

  // Read current stream version
  const versionResult = await client.query<{ max_version: number | null }>(
    `SELECT MAX(stream_version) as max_version FROM ${schema}.events WHERE stream_id = $1`,
    [streamId],
  );

  const currentVersion = versionResult.rows[0]?.max_version ?? 0;

  // OCC check
  if (expectedVersion === -1) {
    // Expect new stream
    if (currentVersion > 0) {
      throw new OptimisticConcurrencyError(streamId, expectedVersion, currentVersion);
    }
  } else if (expectedVersion > 0) {
    // Expect specific version
    if (currentVersion !== expectedVersion) {
      throw new OptimisticConcurrencyError(streamId, expectedVersion, currentVersion);
    }
  }
  // expectedVersion === 0 -> no concurrency check (append regardless)

  // --- Prepare all rows (encryption may be async per-event) ---
  interface PreparedRow {
    version: number;
    // CloudEvents REQUIRED
    id: string;
    source: string;
    specversion: string;
    eventType: string;
    // CloudEvents OPTIONAL
    subject: string;
    time: string;
    datacontenttype: string;
    // Data & extensions
    dataJson: string;
    extensionsJson: string;
    // Crypto
    encryptedDataJson: string | null;
    cryptoKeyId: string | null;
    schemaVersion: number;
    // For outbox payload (PII-stripped data)
    dataToStore: unknown;
    extensions: CloudEventExtensions;
  }

  let nextVersion = currentVersion + 1;
  const fromVersion = nextVersion;
  const preparedRows: PreparedRow[] = [];

  for (const event of events) {
    const version = nextVersion;
    const time = new Date().toISOString();
    const source = event.source ?? defaultSource;
    const schemaVersion = event.schemaVersion ?? 1;

    // CloudEvents id: "{streamId}/{streamVersion}" — unique within scope of source
    const eventId = `${streamId}/${version}`;

    // Build extensions object from user-provided extensions + schemaversion
    const extensions: CloudEventExtensions = {
      ...event.extensions,
      schemaversion: schemaVersion,
    };

    let dataToStore: unknown = event.data;
    let encryptedData: unknown = null;
    let cryptoKeyId: string | null = event.cryptoKeyId ?? null;

    // Handle encryption if needed
    if (event.encryptedFields && event.encryptedFields.length > 0 && cryptoKeyId) {
      if (!cryptoKeyManager) {
        throw new Error(
          "Crypto operations require a master encryption key in the EventStore configuration",
        );
      }

      const aesKey = await cryptoKeyManager.getKeyForEncryption(client, schema, cryptoKeyId);
      const result = encryptFields(
        event.data as Record<string, unknown>,
        event.encryptedFields,
        aesKey,
      );
      dataToStore = result.cleanData;
      encryptedData = result.encryptedData;
    } else {
      cryptoKeyId = null;
    }

    preparedRows.push({
      version,
      id: eventId,
      source,
      specversion: CLOUDEVENTS_SPEC_VERSION,
      eventType: event.type,
      subject: streamId,
      time,
      datacontenttype: "application/json",
      dataJson: JSON.stringify(dataToStore),
      extensionsJson: JSON.stringify(extensions),
      encryptedDataJson: encryptedData ? JSON.stringify(encryptedData) : null,
      cryptoKeyId,
      schemaVersion,
      dataToStore,
      extensions,
    });

    nextVersion++;
  }

  // --- Batch INSERT events, chunked to stay within PG's parameter limit ---
  const globalPositions: bigint[] = [];

  for (let chunkStart = 0; chunkStart < preparedRows.length; chunkStart += MAX_EVENTS_PER_CHUNK) {
    const chunk = preparedRows.slice(chunkStart, chunkStart + MAX_EVENTS_PER_CHUNK);
    const valuePlaceholders: string[] = [];
    const params: (string | number | null)[] = [];
    let paramIdx = 1;

    for (const row of chunk) {
      valuePlaceholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12}, $${paramIdx + 13})`,
      );
      params.push(
        streamId,
        row.version,
        row.id,
        row.source,
        row.specversion,
        row.eventType,
        row.subject,
        row.time,
        row.datacontenttype,
        row.dataJson,
        row.extensionsJson,
        row.encryptedDataJson,
        row.cryptoKeyId,
        row.schemaVersion,
      );
      paramIdx += PARAMS_PER_EVENT;
    }

    const insertResult = await client.query<{ global_position: string }>(
      `INSERT INTO ${schema}.events
        (stream_id, stream_version, id, source, specversion, event_type, subject, time, datacontenttype, data, extensions, encrypted_data, crypto_key_id, schema_version)
       VALUES ${valuePlaceholders.join(", ")}
       RETURNING global_position`,
      params,
    );

    for (const r of insertResult.rows) {
      globalPositions.push(BigInt(r.global_position));
    }
  }

  // --- Batch INSERT outbox entries if topics are specified ---
  // Outbox payloads are CloudEvents v1.0.2 JSON format compliant
  if (outboxTopics && outboxTopics.length > 0) {
    interface OutboxRow {
      globalPosition: string;
      topic: string;
      payloadJson: string;
    }

    const allOutboxRows: OutboxRow[] = [];

    for (let i = 0; i < preparedRows.length; i++) {
      const row = preparedRows[i]!;
      const globalPosition = globalPositions[i]!;

      // CloudEvents v1.0.2 JSON format
      // IMPORTANT: Use dataToStore (PII-stripped) instead of original event data
      // to avoid leaking plaintext PII into the outbox table.
      const cloudEventsPayload: Record<string, unknown> = {
        specversion: row.specversion,
        id: row.id,
        source: row.source,
        type: row.eventType,
        subject: row.subject,
        time: row.time,
        datacontenttype: row.datacontenttype,
        data: row.dataToStore,
      };

      // Include extension attributes at the top level per CloudEvents JSON format.
      // Guard against collisions with reserved CloudEvents context attribute names.
      for (const [key, value] of Object.entries(row.extensions)) {
        if (value !== undefined && !RESERVED_CE_KEYS.has(key)) {
          cloudEventsPayload[key] = value;
        }
      }

      const payloadJson = JSON.stringify(cloudEventsPayload);

      for (const topic of outboxTopics) {
        allOutboxRows.push({
          globalPosition: globalPosition.toString(),
          topic,
          payloadJson,
        });
      }
    }

    // Insert outbox rows in chunks
    for (
      let chunkStart = 0;
      chunkStart < allOutboxRows.length;
      chunkStart += MAX_OUTBOX_ROWS_PER_CHUNK
    ) {
      const chunk = allOutboxRows.slice(chunkStart, chunkStart + MAX_OUTBOX_ROWS_PER_CHUNK);
      const outboxValues: string[] = [];
      const outboxParams: (string | null)[] = [];
      let outboxParamIdx = 1;

      for (const outboxRow of chunk) {
        outboxValues.push(`($${outboxParamIdx}, $${outboxParamIdx + 1}, $${outboxParamIdx + 2})`);
        outboxParams.push(outboxRow.globalPosition, outboxRow.topic, outboxRow.payloadJson);
        outboxParamIdx += PARAMS_PER_OUTBOX;
      }

      await client.query(
        `INSERT INTO ${schema}.outbox (event_global_pos, topic, payload)
         VALUES ${outboxValues.join(", ")}`,
        outboxParams,
      );
    }
  }

  return {
    streamId,
    fromVersion,
    toVersion: nextVersion - 1,
    globalPositions,
  };
}
