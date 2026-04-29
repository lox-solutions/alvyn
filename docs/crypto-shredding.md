# Crypto-Shredding & GDPR

The event store implements **envelope encryption** for GDPR-compliant PII handling. Per-entity encryption keys allow surgical data erasure by revoking a single key, making all PII for that entity irrecoverable without touching any other data.

> **Related:** [Event Store Overview](../event-store.md) | [Aggregates](./aggregates.md) | [API Reference](./api-reference.md)

---

## Architecture

```
                  +----------------------------+
                  |       Master Key            |
                  |  (256-bit AES, from env)    |
                  +-----------+----------------+
                              | encrypts/decrypts
                  +-----------v----------------+
                  |  Per-Entity AES Key         |
                  |  (stored in crypto_keys     |
                  |   encrypted by master)      |
                  +-----------+----------------+
                              | encrypts/decrypts
              +---------------v------------------+
              |  Individual PII Fields            |
              |  (each field encrypted with       |
              |   AES-256-GCM, unique IV)         |
              +----------------------------------+
```

**Two-layer envelope encryption:**

1. A **master key** (256-bit AES, provided via `EVENT_STORE_MASTER_KEY` env var) encrypts per-entity AES keys.
2. Each entity (e.g., a user) gets its own **AES-256-GCM key** stored encrypted in the `crypto_keys` table.
3. Individual PII fields within event data are encrypted with the entity's key, each with a unique random IV.

---

## How It Works

### Write Path (append)

1. For each event with `encryptedFields` + `cryptoKeyId`, the entity's AES key is retrieved and decrypted from the DB using the master key.
2. Each PII field (specified as dot-paths, e.g. `"address.street"`) is:
   - Extracted from the event data
   - JSON-stringified and encrypted with AES-256-GCM (random IV per field)
   - Stored in the `encrypted_data` column as `{ ciphertext, iv, authTag }` (base64-encoded)
3. The `data` column stores the event payload **with PII fields removed**.

**Example of what gets stored in the database:**

```
data column:            { "loginCount": 5 }
encrypted_data column:  { "name": { "ciphertext": "...", "iv": "...", "authTag": "..." },
                          "email": { "ciphertext": "...", "iv": "...", "authTag": "..." } }
crypto_key_id column:   "user:abc123"
```

### Read Path (load)

1. If the entity's crypto key is **active**: fields are decrypted and merged back into the event data. The caller sees the complete event as if encryption was transparent.
2. If the key is **revoked or missing**: the event is returned as a `TombstonedEvent` with `data: null` and `tombstoned: true`.

---

## Setting Up Encryption

### 1. Provide a Master Key

Generate a 256-bit (64 hex character) master key:

```bash
openssl rand -hex 32
```

Set it as the `EVENT_STORE_MASTER_KEY` environment variable and pass it to the `EventStore` constructor:

```typescript
const eventStore = new EventStore({
  pool,
  masterEncryptionKey: process.env.EVENT_STORE_MASTER_KEY,
});
```

### 2. Create Entity Keys

Create a per-entity key before appending encrypted events:

```typescript
await eventStore.createCryptoKey("user:abc123");
```

This is **idempotent** -- if the key already exists, it's a no-op.

### 3. Configure Aggregate Encryption

In the aggregate definition, specify which fields contain PII per event type:

```typescript
const User = defineAggregate<UserEvents>()({
  streamPrefix: "User",
  // ... initialState, evolve ...

  encryption: {
    cryptoKeyId: (entityId) => `user:${entityId}`,
    encryptedFields: {
      UserRegistered: ["name", "email", "address.street"],
      UserRenamed: ["name"],
      // UserDeactivated has no PII -- no entry needed
    },
  },
});
```

### 4. Or Use Low-Level API

If not using aggregates, specify encryption per-event in the `append` call:

```typescript
await eventStore.append({
  streamId: "User-abc123",
  expectedVersion: 0,
  events: [
    {
      type: "UserRegistered",
      data: { name: "Alice", email: "alice@example.com", loginCount: 0 },
      encryptedFields: ["name", "email"],
      cryptoKeyId: "user:abc123",
    },
  ],
});
```

---

## Dot-Path Field Notation

Encrypted fields are specified using dot-path notation for nested objects:

```typescript
encryptedFields: ["name", "address.street", "address.city"];
```

Given event data:

```json
{
  "name": "Alice",
  "address": { "street": "123 Main", "city": "Berlin" },
  "active": true
}
```

After encryption, `data` column contains:

```json
{ "address": {}, "active": true }
```

And `encrypted_data` column contains:

```json
{
  "name": { "ciphertext": "...", "iv": "...", "authTag": "..." },
  "address.street": { "ciphertext": "...", "iv": "...", "authTag": "..." },
  "address.city": { "ciphertext": "...", "iv": "...", "authTag": "..." }
}
```

---

## GDPR Right to Erasure

The complete flow for handling a user deletion request:

```typescript
// 1. When user registers -- create their crypto key
await eventStore.createCryptoKey("user:abc123");

// 2. Normal operation -- append events with encrypted PII
await User.append(eventStore, "abc123", {
  expectedVersion: -1,
  events: [
    {
      type: "UserRegistered",
      data: {
        name: "Alice",
        email: "alice@example.com",
        address: { street: "123 Main", city: "Berlin" },
      },
    },
  ],
});

// 3. User requests deletion -- revoke the key
await eventStore.revokeKey("user:abc123");

// 4. All future reads return tombstones for encrypted events
const user = await User.load(eventStore, "abc123");
// user.state.name  -> "" (from initialState, since event.data is null)
// user.state.email -> "" (from initialState)
```

### What `revokeKey` Does

Within a single transaction:

1. Sets `revoked_at = now()` on the crypto key (the key is **not deleted** -- kept for audit trail)
2. Finds all streams that used this crypto key
3. Deletes snapshots for those streams (snapshots may contain cached PII)

The key is never deleted from the database. This is intentional -- the `revoked_at` timestamp provides an audit trail for GDPR compliance.

---

## Tombstoned Events

After key revocation, encrypted events are returned as `TombstonedEvent`:

```typescript
interface TombstonedEvent
  extends CloudEventRequiredAttributes, CloudEventOptionalAttributes {
  globalPosition: bigint;
  streamId: string;
  streamVersion: number;
  type: string; // Event type name (CloudEvents `type`)
  data: null; // PII shredded -- irrecoverable
  extensions: CloudEventExtensions; // Extensions are NOT encrypted
  createdAt: Date;
  tombstoned: true;
}
```

**Important characteristics:**

- `data` is `null` -- the PII is cryptographically irrecoverable
- `extensions` is still available (it's never encrypted)
- `type` is still available -- you know _what_ happened, just not _the PII details_
- Non-encrypted events in the same stream are **not affected**

### Handling Tombstones in Evolve Handlers

Evolve handlers **must** use optional chaining with fallbacks:

```typescript
evolve: {
  UserRegistered: (state, event) => ({
    ...state,
    name: event.data?.name ?? state.name,
    email: event.data?.email ?? state.email,
    // Non-PII fields also need fallbacks since the entire data is null
    active: event.data?.active ?? state.active,
  }),
}
```

---

## Error Handling

| Error                    | When                                                     | Recovery                                      |
| ------------------------ | -------------------------------------------------------- | --------------------------------------------- |
| `CryptoKeyRevokedError`  | Trying to encrypt **new** events with a revoked key      | Do not write PII for deleted users            |
| `CryptoKeyNotFoundError` | Crypto key does not exist in the key store               | Create the key first with `createCryptoKey()` |
| `MasterKeyRequiredError` | Crypto operation without `masterEncryptionKey` in config | Provide the master key                        |

Note: `CryptoKeyRevokedError` is only thrown on **write** operations. On **read**, revoked keys simply produce tombstoned events without throwing.

---

## Security Details

- **Algorithm:** AES-256-GCM (authenticated encryption) for both master-to-entity and entity-to-field encryption
- **IV:** 12 bytes, randomly generated per encryption operation
- **Auth tag:** 16 bytes
- **Entity key storage format:** `[iv (12 bytes)][authTag (16 bytes)][ciphertext]` stored as `BYTEA`
- **Field storage format:** `{ ciphertext, iv, authTag }` as base64 strings in `JSONB`
- **Key cache:** Decrypted entity keys are cached in a per-read-call `Map` (not across requests) to avoid redundant DB lookups within a single stream load
