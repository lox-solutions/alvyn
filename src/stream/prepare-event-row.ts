import type { PoolClient } from "pg";
import type { CryptoKeyManager } from "../crypto/crypto-key-manager";
import { encryptFields } from "../crypto/field-encryptor";
import { CryptoSecretsRequiredError } from "../errors";
import type { AppendEventInput, CloudEventExtensions } from "../types";

const CLOUDEVENTS_SPEC_VERSION = "1.0";

export interface PreparedRow {
  version: number;
  id: string;
  source: string;
  specversion: string;
  eventType: string;
  subject: string;
  time: string;
  datacontenttype: string;
  dataJson: string;
  extensionsJson: string;
  encryptedDataJson: string | null;
  cryptoKeyId: string | null;
  schemaVersion: number;
  dataToStore: unknown;
  extensions: CloudEventExtensions;
}

async function encryptEventData(options: {
  event: AppendEventInput;
  cryptoKeyManager: CryptoKeyManager;
  client: PoolClient;
  schema: string;
  keyId: string;
}): Promise<{ dataToStore: unknown; encryptedData: unknown }> {
  const { event, cryptoKeyManager, client, schema, keyId } = options;
  const aesKey = await cryptoKeyManager.getKeyForEncryption({
    client,
    schema,
    keyId,
  });
  const result = encryptFields({
    data: event.data as Record<string, unknown>,
    fields: event.encryptedFields!,
    aesKey,
    keyVersion: cryptoKeyManager.currentSecretVersion,
  });
  return { dataToStore: result.cleanData, encryptedData: result.encryptedData };
}

function buildPreparedRow(options: {
  streamId: string;
  version: number;
  event: AppendEventInput;
  defaultSource: string;
  dataToStore: unknown;
  encryptedData: unknown;
  cryptoKeyId: string | null;
}): PreparedRow {
  const { streamId, version, event, defaultSource } = options;
  const source = event.source ?? defaultSource;
  const schemaVersion = event.schemaVersion ?? 1;
  const extensions: CloudEventExtensions = {
    ...event.extensions,
    schemaversion: schemaVersion,
  };
  return {
    version,
    id: `${streamId}/${version}`,
    source,
    specversion: CLOUDEVENTS_SPEC_VERSION,
    eventType: event.type,
    subject: streamId,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    dataJson: JSON.stringify(options.dataToStore),
    extensionsJson: JSON.stringify(extensions),
    encryptedDataJson: options.encryptedData
      ? JSON.stringify(options.encryptedData)
      : null,
    cryptoKeyId: options.cryptoKeyId,
    schemaVersion,
    dataToStore: options.dataToStore,
    extensions,
  };
}

export async function prepareEventRow(options: {
  event: AppendEventInput;
  streamId: string;
  version: number;
  defaultSource: string;
  cryptoKeyManager: CryptoKeyManager | null;
  client: PoolClient;
  schema: string;
}): Promise<PreparedRow> {
  const { event, cryptoKeyManager, client, schema } = options;
  let dataToStore: unknown = event.data;
  let encryptedData: unknown = null;
  let cryptoKeyId: string | null = event.cryptoKeyId ?? null;

  if (event.encryptedFields?.length && cryptoKeyId) {
    if (!cryptoKeyManager) throw new CryptoSecretsRequiredError();
    const encrypted = await encryptEventData({
      event,
      cryptoKeyManager,
      client,
      schema,
      keyId: cryptoKeyId,
    });
    dataToStore = encrypted.dataToStore;
    encryptedData = encrypted.encryptedData;
  } else {
    cryptoKeyId = null;
  }

  return buildPreparedRow({
    streamId: options.streamId,
    version: options.version,
    event,
    defaultSource: options.defaultSource,
    dataToStore,
    encryptedData,
    cryptoKeyId,
  });
}
