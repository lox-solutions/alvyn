import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MAX_KEY_VERSION = 0xffffffff;
const FIELD_AAD_DOMAIN = "alvyn:encrypted-field:v1";

export interface FieldEncryptionContext {
  eventId: string;
  cryptoKeyId: string;
}

export interface EncryptedFieldEntry {
  /** Version of the configured secret used for this encrypted entry. */
  version: number;
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded authentication tag */
  authTag: string;
}

export interface EncryptResult {
  /** The event data with PII fields removed */
  cleanData: Record<string, unknown>;
  /** The encrypted PII fields (stored in encrypted_data column) */
  encryptedData: Record<string, EncryptedFieldEntry>;
}

/**
 * Extracts a nested field value from an object by dot-path.
 * e.g. getNestedField({ a: { b: "c" } }, "a.b") => "c"
 */
function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Sets a nested field value on an object by dot-path.
 * Mutates the object in place.
 */
function isSafePathSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "__proto__" &&
    segment !== "constructor" &&
    segment !== "prototype"
  );
}

function assertValidFieldPath(path: string): void {
  if (!path.split(".").every(isSafePathSegment)) {
    throw new Error(`Invalid encrypted field path "${path}"`);
  }
}

function assertDistinctFieldPaths(fields: string[]): void {
  const accepted: string[] = [];
  for (const field of fields) {
    assertValidFieldPath(field);
    if (
      accepted.some(
        (other) =>
          field === other ||
          field.startsWith(`${other}.`) ||
          other.startsWith(`${field}.`),
      )
    ) {
      throw new Error(`Encrypted field path "${field}" overlaps another path`);
    }
    accepted.push(field);
  }
}

function assertValidKeyVersion(version: number): void {
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    version > MAX_KEY_VERSION
  ) {
    throw new Error("Invalid encrypted field version");
  }
}

function fieldAad(options: {
  context: FieldEncryptionContext;
  field: string;
  version: number;
}): Buffer {
  return Buffer.from(
    JSON.stringify([
      FIELD_AAD_DOMAIN,
      options.context.eventId,
      options.context.cryptoKeyId,
      options.field,
      options.version,
    ]),
    "utf8",
  );
}

function decodeBase64(value: unknown, label: string): Buffer {
  if (typeof value !== "string") {
    throw new Error(`Invalid encrypted field ${label}`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`Invalid encrypted field ${label}`);
  }
  return decoded;
}

function setNestedField(options: {
  obj: Record<string, unknown>;
  path: string;
  value: unknown;
}): void {
  const { obj, path, value } = options;
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const hasOwnPart = Object.prototype.hasOwnProperty.call(current, part);
    if (
      !hasOwnPart ||
      typeof current[part] !== "object" ||
      current[part] === null
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Removes a nested field from an object by dot-path.
 * Mutates the object in place.
 */
function removeNestedField(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    current = current[part] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];

  delete current[lastKey];
}

/**
 * Encrypts specified fields within an event's data object.
 * Returns the cleaned data (PII removed) and the encrypted field blobs.
 *
 * @param data - The full event data object
 * @param fields - Dot-path field names to encrypt (e.g. ["name", "address.street"])
 * @param aesKey - 256-bit AES key (Buffer, 32 bytes)
 */
export function encryptFields(options: {
  data: Record<string, unknown>;
  fields: string[];
  aesKey: Buffer;
  keyVersion: number;
  context: FieldEncryptionContext;
}): EncryptResult {
  const { data, fields, aesKey, keyVersion, context } = options;
  assertValidKeyVersion(keyVersion);
  assertDistinctFieldPaths(fields);
  // Deep-clone to avoid mutating the original
  const cleanData = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const encryptedData: Record<string, EncryptedFieldEntry> = {};

  for (const field of fields) {
    const value = getNestedField(cleanData, field);
    if (value === undefined) continue;

    const plaintext = JSON.stringify(value);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, aesKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(fieldAad({ context, field, version: keyVersion }));

    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    encryptedData[field] = {
      version: keyVersion,
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };

    removeNestedField(cleanData, field);
  }

  return { cleanData, encryptedData };
}

/**
 * Decrypts encrypted field blobs and merges them back into the event data.
 *
 * @param cleanData - The event data with PII fields removed
 * @param encryptedData - The encrypted field blobs
 * @param aesKey - 256-bit AES key (Buffer, 32 bytes)
 * @returns The full event data with decrypted PII fields restored
 */
export function decryptFields(options: {
  cleanData: Record<string, unknown>;
  encryptedData: Record<string, EncryptedFieldEntry>;
  aesKey: Buffer;
  context: FieldEncryptionContext;
}): Record<string, unknown> {
  const { cleanData, encryptedData, aesKey, context } = options;
  const result = JSON.parse(JSON.stringify(cleanData)) as Record<
    string,
    unknown
  >;

  for (const [field, entry] of Object.entries(encryptedData)) {
    assertValidFieldPath(field);
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid encrypted field entry for "${field}"`);
    }
    assertValidKeyVersion(entry.version);
    const ciphertext = decodeBase64(entry.ciphertext, "ciphertext");
    const iv = decodeBase64(entry.iv, "initialization vector");
    const authTag = decodeBase64(entry.authTag, "authentication tag");
    if (iv.length !== IV_LENGTH) {
      throw new Error("Invalid encrypted field initialization vector");
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error("Invalid encrypted field authentication tag");
    }

    const decipher = createDecipheriv(ALGORITHM, aesKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(fieldAad({ context, field, version: entry.version }));
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    const value: unknown = JSON.parse(decrypted);
    setNestedField({ obj: result, path: field, value });
  }

  return result;
}
