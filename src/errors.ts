// ---------------------------------------------------------------------------
// Event Store Errors — specific, actionable, catchable
// ---------------------------------------------------------------------------

/**
 * Thrown when a concurrent write conflicts with the expected stream version.
 * The caller should reload the stream and retry.
 */
export class OptimisticConcurrencyError extends Error {
  public readonly name = "OptimisticConcurrencyError" as const;

  constructor(
    public readonly streamId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Concurrency conflict on stream "${streamId}": ` +
        `expected version ${expectedVersion}, but stream is at version ${actualVersion}`,
    );
  }
}

/**
 * Thrown when loading a stream that does not exist and the caller
 * explicitly required existence.
 */
export class StreamNotFoundError extends Error {
  public readonly name = "StreamNotFoundError" as const;

  constructor(public readonly streamId: string) {
    super(`Stream "${streamId}" not found`);
  }
}

/**
 * Thrown when attempting to encrypt/decrypt with a revoked crypto key.
 * This should NOT happen during normal read operations — revoked keys
 * produce tombstoned events instead. This is thrown only if you try to
 * append with a revoked key.
 */
export class CryptoKeyRevokedError extends Error {
  public readonly name = "CryptoKeyRevokedError" as const;

  constructor(public readonly keyId: string) {
    super(`Crypto key "${keyId}" has been revoked — cannot encrypt new events with it`);
  }
}

/**
 * Thrown when a crypto key is required but not found in the key store.
 */
export class CryptoKeyNotFoundError extends Error {
  public readonly name = "CryptoKeyNotFoundError" as const;

  constructor(public readonly keyId: string) {
    super(`Crypto key "${keyId}" not found`);
  }
}

/**
 * Thrown when crypto operations are attempted but no master encryption key
 * was provided in the EventStore configuration.
 */
export class MasterKeyRequiredError extends Error {
  public readonly name = "MasterKeyRequiredError" as const;

  constructor() {
    super(
      "Master encryption key is required for crypto operations. " +
        "Provide `masterEncryptionKey` in the EventStore configuration.",
    );
  }
}

/**
 * Thrown when setup() has not been called before using the event store.
 */
export class EventStoreNotInitializedError extends Error {
  public readonly name = "EventStoreNotInitializedError" as const;

  constructor() {
    super("Event store has not been initialized. Call `await eventStore.setup()` before use.");
  }
}

/**
 * Thrown when the provided schema name is invalid (potential SQL injection vector).
 */
export class InvalidSchemaNameError extends Error {
  public readonly name = "InvalidSchemaNameError" as const;

  constructor(public readonly schemaName: string) {
    super(
      `Invalid schema name: "${schemaName}". ` +
        `Must match /^[a-z_][a-z0-9_]{0,62}$/ (lowercase, underscores, max 63 chars).`,
    );
  }
}
