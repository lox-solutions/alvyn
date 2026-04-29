import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

interface EncryptedFieldEntry {
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
    segment !== "__proto__" &&
    segment !== "constructor" &&
    segment !== "prototype"
  );
}

function setNestedField(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  if (parts.length === 0 || !parts.every(isSafePathSegment)) {
    return;
  }

  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (
      !(part in current) ||
      typeof current[part] !== "object" ||
      current[part] === null
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

/**
 * Removes a nested field from an object by dot-path.
 * Mutates the object in place.
 */
function removeNestedField(obj: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (
      !(part in current) ||
      typeof current[part] !== "object" ||
      current[part] === null
    ) {
      return;
    }
    current = current[part] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]!];
}

/**
 * Encrypts specified fields within an event's data object.
 * Returns the cleaned data (PII removed) and the encrypted field blobs.
 *
 * @param data - The full event data object
 * @param fields - Dot-path field names to encrypt (e.g. ["name", "address.street"])
 * @param aesKey - 256-bit AES key (Buffer, 32 bytes)
 */
export function encryptFields(
  data: Record<string, unknown>,
  fields: string[],
  aesKey: Buffer,
): EncryptResult {
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

    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    encryptedData[field] = {
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
export function decryptFields(
  cleanData: Record<string, unknown>,
  encryptedData: Record<string, EncryptedFieldEntry>,
  aesKey: Buffer,
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(cleanData)) as Record<
    string,
    unknown
  >;

  for (const [field, entry] of Object.entries(encryptedData)) {
    const ciphertext = Buffer.from(entry.ciphertext, "base64");
    const iv = Buffer.from(entry.iv, "base64");
    const authTag = Buffer.from(entry.authTag, "base64");

    const decipher = createDecipheriv(ALGORITHM, aesKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    const value: unknown = JSON.parse(decrypted);
    setNestedField(result, field, value);
  }

  return result;
}
