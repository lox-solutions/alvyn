import { InvalidCryptoSecretsError } from "../errors";
import type { CryptoSecret } from "../types";

const MAX_SECRET_VERSION = 0xffffffff;

/**
 * Parses `version:value,...` configuration used by GDPR_CRYPTO_SECRETS.
 * Values may contain colons; only the first colon separates version and value.
 */
export function parseCryptoSecrets(value: string | undefined): CryptoSecret[] {
  if (value === undefined) return [];
  if (typeof value !== "string") {
    throw new InvalidCryptoSecretsError("GDPR_CRYPTO_SECRETS must be a string");
  }
  if (value.trim() === "") return [];

  const entries = value.split(",").map((entry) => entry.trim());
  const secrets: CryptoSecret[] = [];
  const versions = new Set<number>();

  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new InvalidCryptoSecretsError(
        `Invalid entry "${entry}"; expected version:value`,
      );
    }

    const versionText = entry.slice(0, separator).trim();
    const secretValue = entry.slice(separator + 1).trim();
    if (!/^\d+$/.test(versionText)) {
      throw new InvalidCryptoSecretsError(
        `Invalid secret version "${versionText}"; versions must be integers`,
      );
    }

    const version = Number(versionText);
    validateVersion(version);
    if (secretValue === "") {
      throw new InvalidCryptoSecretsError(
        `Secret version ${version} must have a non-empty value`,
      );
    }
    if (versions.has(version)) {
      throw new InvalidCryptoSecretsError(
        `Duplicate crypto secret version ${version}`,
      );
    }

    versions.add(version);
    secrets.push({ version, value: secretValue });
  }

  return secrets;
}

/** Validates and returns an ordered copy of explicitly configured secrets. */
export function validateCryptoSecrets(
  secrets: readonly CryptoSecret[],
): CryptoSecret[] {
  const configured: unknown = secrets;
  if (!Array.isArray(configured)) {
    throw new InvalidCryptoSecretsError("Crypto secrets must be an array");
  }
  if (configured.length === 0) {
    throw new InvalidCryptoSecretsError(
      "At least one crypto secret is required",
    );
  }

  const versions = new Set<number>();
  return configured.map((secret: unknown) => {
    if (
      !secret ||
      typeof secret !== "object" ||
      !("value" in secret) ||
      typeof secret.value !== "string"
    ) {
      throw new InvalidCryptoSecretsError(
        "Each crypto secret must have a string value",
      );
    }
    if (!("version" in secret) || typeof secret.version !== "number") {
      throw new InvalidCryptoSecretsError(
        "Each crypto secret must have a numeric version",
      );
    }
    const { value, version } = secret;
    validateVersion(version);
    if (value.trim() === "") {
      throw new InvalidCryptoSecretsError(
        `Secret version ${version} must have a non-empty value`,
      );
    }
    if (versions.has(version)) {
      throw new InvalidCryptoSecretsError(
        `Duplicate crypto secret version ${version}`,
      );
    }
    versions.add(version);
    return { version, value };
  });
}

function validateVersion(version: number): void {
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    version > MAX_SECRET_VERSION
  ) {
    throw new InvalidCryptoSecretsError(
      `Invalid secret version "${String(version)}"; versions must be integers from 0 to ${MAX_SECRET_VERSION}`,
    );
  }
}
