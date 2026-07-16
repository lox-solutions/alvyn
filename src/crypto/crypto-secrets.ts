import { InvalidCryptoSecretsError } from "../errors";
import type { CryptoSecret } from "../types";

const MAX_SECRET_VERSION = 0xffffffff;

/**
 * Parses `version:value,...` configuration used by GDPR_CRYPTO_SECRETS.
 * Values may contain colons; only the first colon separates version and value.
 */
export function parseCryptoSecrets(value: string | undefined): CryptoSecret[] {
  if (value === undefined || value.trim() === "") return [];

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
  if (secrets.length === 0) {
    throw new InvalidCryptoSecretsError(
      "At least one crypto secret is required",
    );
  }

  const versions = new Set<number>();
  return secrets.map((secret) => {
    if (!secret || typeof secret.value !== "string") {
      throw new InvalidCryptoSecretsError(
        "Each crypto secret must have a string value",
      );
    }
    validateVersion(secret.version);
    if (secret.value.trim() === "") {
      throw new InvalidCryptoSecretsError(
        `Secret version ${secret.version} must have a non-empty value`,
      );
    }
    if (versions.has(secret.version)) {
      throw new InvalidCryptoSecretsError(
        `Duplicate crypto secret version ${secret.version}`,
      );
    }
    versions.add(secret.version);
    return { version: secret.version, value: secret.value };
  });
}

function validateVersion(version: number): void {
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    version > MAX_SECRET_VERSION
  ) {
    throw new InvalidCryptoSecretsError(
      `Invalid secret version "${String(version)}"; versions must be non-negative integers`,
    );
  }
}
