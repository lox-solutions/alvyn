import type { Upcaster } from "../types";

/**
 * Registry for event schema upcasters.
 *
 * Upcasters transform old event schemas into newer versions at read-time.
 * The stored event in the database is NEVER modified — transformations
 * happen in memory during load().
 *
 * Example: If an event was stored as schema version 1, and upcasters
 * v1→v2 and v2→v3 exist, the event is passed through both transformations
 * in sequence, producing a version 3 event for the application.
 */
export class UpcasterRegistry {
  /**
   * Map of eventType → sorted array of upcasters.
   * Sorted by fromSchemaVersion ascending for chain execution.
   */
  private readonly upcasters = new Map<string, Upcaster[]>();

  /**
   * Registers an upcaster for a specific event type and version range.
   */
  register(upcaster: Upcaster): void {
    const existing = this.upcasters.get(upcaster.eventType) ?? [];
    existing.push(upcaster);
    // Keep sorted by fromSchemaVersion for correct chain execution
    existing.sort((a, b) => a.fromSchemaVersion - b.fromSchemaVersion);
    this.upcasters.set(upcaster.eventType, existing);
  }

  /**
   * Registers multiple upcasters at once.
   */
  registerAll(upcasters: Upcaster[]): void {
    for (const upcaster of upcasters) {
      this.register(upcaster);
    }
  }

  /**
   * Applies all applicable upcasters to transform event data
   * from its stored schema version to the latest version.
   *
   * @param eventType - The event type name
   * @param storedSchemaVersion - The schema version stored in the database
   * @param data - The raw event data from the database
   * @returns The upcasted data (or the original data if no upcasters apply)
   */
  upcast(eventType: string, storedSchemaVersion: number, data: unknown): unknown {
    const chain = this.upcasters.get(eventType);
    if (!chain || chain.length === 0) {
      return data;
    }

    let currentData = data;
    let currentVersion = storedSchemaVersion;

    for (const upcaster of chain) {
      if (upcaster.fromSchemaVersion === currentVersion) {
        currentData = upcaster.upcast(currentData);
        currentVersion = upcaster.toSchemaVersion;
      }
    }

    return currentData;
  }

  /**
   * Returns the latest schema version for an event type
   * (the highest toSchemaVersion in the chain).
   * Returns the input version if no upcasters are registered.
   */
  getLatestVersion(eventType: string, baseVersion: number): number {
    const chain = this.upcasters.get(eventType);
    if (!chain || chain.length === 0) {
      return baseVersion;
    }

    let version = baseVersion;
    for (const upcaster of chain) {
      if (upcaster.fromSchemaVersion === version) {
        version = upcaster.toSchemaVersion;
      }
    }
    return version;
  }
}
