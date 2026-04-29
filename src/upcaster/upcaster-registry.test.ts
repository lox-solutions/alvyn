import { describe, it, expect } from "vitest";
import { UpcasterRegistry } from "./upcaster-registry";

describe("UpcasterRegistry", () => {
  describe("register and upcast", () => {
    it("applies a single upcaster", () => {
      const registry = new UpcasterRegistry();
      registry.register({
        eventType: "OrderPlaced",
        fromSchemaVersion: 1,
        toSchemaVersion: 2,
        upcast: (data: unknown) => ({
          ...(data as Record<string, unknown>),
          currency: "EUR",
        }),
      });

      const result = registry.upcast("OrderPlaced", 1, { total: 100 });
      expect(result).toEqual({ total: 100, currency: "EUR" });
    });

    it("chains multiple upcasters v1 -> v2 -> v3", () => {
      const registry = new UpcasterRegistry();
      registry.register({
        eventType: "UserCreated",
        fromSchemaVersion: 1,
        toSchemaVersion: 2,
        upcast: (data: unknown) => ({
          ...(data as Record<string, unknown>),
          role: "user",
        }),
      });
      registry.register({
        eventType: "UserCreated",
        fromSchemaVersion: 2,
        toSchemaVersion: 3,
        upcast: (data: unknown) => ({
          ...(data as Record<string, unknown>),
          active: true,
        }),
      });

      const result = registry.upcast("UserCreated", 1, { name: "Alice" });
      expect(result).toEqual({ name: "Alice", role: "user", active: true });
    });

    it("returns data unchanged when no upcasters registered for event type", () => {
      const registry = new UpcasterRegistry();
      const data = { foo: "bar" };
      const result = registry.upcast("UnknownEvent", 1, data);
      expect(result).toBe(data); // same reference
    });

    it("returns data unchanged when stored version is already latest", () => {
      const registry = new UpcasterRegistry();
      registry.register({
        eventType: "OrderPlaced",
        fromSchemaVersion: 1,
        toSchemaVersion: 2,
        upcast: (data: unknown) => ({
          ...(data as Record<string, unknown>),
          extra: true,
        }),
      });

      const data = { total: 100, currency: "EUR" };
      const result = registry.upcast("OrderPlaced", 2, data);
      expect(result).toBe(data); // no transformation applied
    });

    it("skips upcasters with version gaps", () => {
      const registry = new UpcasterRegistry();
      // Register v2->v3 but NOT v1->v2
      registry.register({
        eventType: "OrderPlaced",
        fromSchemaVersion: 2,
        toSchemaVersion: 3,
        upcast: (data: unknown) => ({
          ...(data as Record<string, unknown>),
          v3Field: true,
        }),
      });

      const data = { total: 100 };
      const result = registry.upcast("OrderPlaced", 1, data);
      // Gap: no v1->v2, so v2->v3 is never reached
      expect(result).toBe(data);
    });
  });

  describe("registerAll", () => {
    it("registers multiple upcasters at once", () => {
      const registry = new UpcasterRegistry();
      registry.registerAll([
        {
          eventType: "A",
          fromSchemaVersion: 1,
          toSchemaVersion: 2,
          upcast: () => ({ v: 2 }),
        },
        {
          eventType: "A",
          fromSchemaVersion: 2,
          toSchemaVersion: 3,
          upcast: () => ({ v: 3 }),
        },
      ]);

      expect(registry.upcast("A", 1, {})).toEqual({ v: 3 });
    });

    it("sorts by fromSchemaVersion regardless of registration order", () => {
      const registry = new UpcasterRegistry();
      // Register v2->v3 BEFORE v1->v2
      registry.registerAll([
        {
          eventType: "A",
          fromSchemaVersion: 2,
          toSchemaVersion: 3,
          upcast: (data: unknown) => ({
            ...(data as Record<string, unknown>),
            c: true,
          }),
        },
        {
          eventType: "A",
          fromSchemaVersion: 1,
          toSchemaVersion: 2,
          upcast: (data: unknown) => ({
            ...(data as Record<string, unknown>),
            b: true,
          }),
        },
      ]);

      const result = registry.upcast("A", 1, { a: true });
      expect(result).toEqual({ a: true, b: true, c: true });
    });
  });

  describe("getLatestVersion", () => {
    it("returns base version when no upcasters registered", () => {
      const registry = new UpcasterRegistry();
      expect(registry.getLatestVersion("Unknown", 1)).toBe(1);
    });

    it("walks the chain to find the highest version", () => {
      const registry = new UpcasterRegistry();
      registry.registerAll([
        {
          eventType: "A",
          fromSchemaVersion: 1,
          toSchemaVersion: 2,
          upcast: (d: unknown) => d,
        },
        {
          eventType: "A",
          fromSchemaVersion: 2,
          toSchemaVersion: 3,
          upcast: (d: unknown) => d,
        },
      ]);

      expect(registry.getLatestVersion("A", 1)).toBe(3);
      expect(registry.getLatestVersion("A", 2)).toBe(3);
      expect(registry.getLatestVersion("A", 3)).toBe(3);
    });

    it("stops at gap in version chain", () => {
      const registry = new UpcasterRegistry();
      registry.register({
        eventType: "A",
        fromSchemaVersion: 3,
        toSchemaVersion: 4,
        upcast: (d: unknown) => d,
      });

      expect(registry.getLatestVersion("A", 1)).toBe(1);
    });
  });
});
