import { InvalidCryptoSecretsError } from "../errors";
import type { CryptoSecret, CryptoSecretsConfig } from "../types";

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
        "Invalid crypto secret entry; expected version:value",
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

export function parseCryptoSecretVersion(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new InvalidCryptoSecretsError(
      "GDPR_CRYPTO_CURRENT_VERSION must be a string",
    );
  }
  const versionText = value.trim();
  if (versionText === "") return undefined;
  if (!/^\d+$/.test(versionText)) {
    throw new InvalidCryptoSecretsError(
      "Invalid current crypto secret version; versions must be integers",
    );
  }
  const version = Number(versionText);
  validateVersion(version);
  return version;
}

export function parseCryptoSecretsConfig(options: {
  secrets: string | undefined;
  currentVersion: string | undefined;
}): CryptoSecretsConfig | null {
  const secrets = parseCryptoSecrets(options.secrets);
  const currentVersion = parseCryptoSecretVersion(options.currentVersion);
  if (secrets.length === 0 && currentVersion === undefined) return null;
  if (currentVersion === undefined) {
    throw new InvalidCryptoSecretsError(
      "GDPR_CRYPTO_CURRENT_VERSION is required when GDPR_CRYPTO_SECRETS is configured",
    );
  }
  return { currentVersion, secrets };
}

/** Validates and returns a copy of explicitly configured secrets. */
export function validateCryptoSecrets(
  config: CryptoSecretsConfig,
): CryptoSecretsConfig {
  const { currentVersion, configuredSecrets } = validateConfigShape(config);
  if (configuredSecrets.length === 0) {
    throw new InvalidCryptoSecretsError(
      "At least one crypto secret is required",
    );
  }

  const versions = new Set<number>();
  const secrets = configuredSecrets.map((secret) =>
    validateSecretEntry(secret, versions),
  );

  if (!secrets.some((secret) => secret.version === currentVersion)) {
    throw new InvalidCryptoSecretsError(
      `Current crypto secret version ${currentVersion} is not configured`,
    );
  }

  return { currentVersion, secrets };
}

function validateConfigShape(config: unknown): {
  currentVersion: number;
  configuredSecrets: unknown[];
} {
  const configured = config;
  if (
    !configured ||
    typeof configured !== "object" ||
    Array.isArray(configured)
  ) {
    throw new InvalidCryptoSecretsError(
      "Crypto secrets must be an object with currentVersion and secrets",
    );
  }
  const configRecord = configured as Record<string, unknown>;
  if (typeof configRecord.currentVersion !== "number") {
    throw new InvalidCryptoSecretsError(
      "Crypto secrets must have a numeric currentVersion",
    );
  }
  if (!Array.isArray(configRecord.secrets)) {
    throw new InvalidCryptoSecretsError(
      "Crypto secrets must have a secrets array",
    );
  }

  const currentVersion = configRecord.currentVersion;
  validateVersion(currentVersion);
  return { currentVersion, configuredSecrets: configRecord.secrets };
}

function validateSecretEntry(
  secret: unknown,
  versions: Set<number>,
): CryptoSecret {
  if (!secret || typeof secret !== "object") {
    throw new InvalidCryptoSecretsError(
      "Each crypto secret must have a string value",
    );
  }
  const configured = secret as Record<string, unknown>;
  if (typeof configured.value !== "string") {
    throw new InvalidCryptoSecretsError(
      "Each crypto secret must have a string value",
    );
  }
  if (typeof configured.version !== "number") {
    throw new InvalidCryptoSecretsError(
      "Each crypto secret must have a numeric version",
    );
  }
  const { value, version } = configured;
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
