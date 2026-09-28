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

      const result = registry.upcast({
        eventType: "OrderPlaced",
        storedSchemaVersion: 1,
        data: { total: 100 },
      });
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

      const result = registry.upcast({
        eventType: "UserCreated",
        storedSchemaVersion: 1,
        data: { name: "Alice" },
      });
      expect(result).toEqual({ name: "Alice", role: "user", active: true });
    });

    it("returns data unchanged when no upcasters registered for event type", () => {
      const registry = new UpcasterRegistry();
      const data = { foo: "bar" };
      const result = registry.upcast({
        eventType: "UnknownEvent",
        storedSchemaVersion: 1,
        data,
      });
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
      const result = registry.upcast({
        eventType: "OrderPlaced",
        storedSchemaVersion: 2,
        data,
      });
      expect(result).toBe(data); // no transformation applied
    });

    it("rejects incomplete upcaster chains on read", () => {
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

      expect(() =>
        registry.upcast({
          eventType: "OrderPlaced",
          storedSchemaVersion: 1,
          data: { total: 100 },
        }),
      ).toThrow(/Missing upcaster.*version 1/);
    });
  });

  it("rejects a gap after a successful upcast step", () => {
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
        fromSchemaVersion: 3,
        toSchemaVersion: 4,
        upcast: (d: unknown) => d,
      },
    ]);
    expect(() =>
      registry.upcast({ eventType: "A", storedSchemaVersion: 1, data: {} }),
    ).toThrow(/version 2/);
  });

  it("rejects duplicate and invalid transitions", () => {
    const registry = new UpcasterRegistry();
    const first = {
      eventType: "A",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast: (d: unknown) => d,
    };
    registry.register(first);
    expect(() => registry.register(first)).toThrow(/Duplicate upcaster/);
    expect(() => registry.register({ ...first, fromSchemaVersion: 0 })).toThrow(
      /Invalid upcaster/,
    );
    expect(() => registry.register({ ...first, toSchemaVersion: 1 })).toThrow(
      /Invalid upcaster/,
    );
    expect(() =>
      registry.register({ ...first, fromSchemaVersion: 2, toSchemaVersion: 1 }),
    ).toThrow(/Invalid upcaster/);
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

      expect(
        registry.upcast({ eventType: "A", storedSchemaVersion: 1, data: {} }),
      ).toEqual({ v: 3 });
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

      const result = registry.upcast({
        eventType: "A",
        storedSchemaVersion: 1,
        data: { a: true },
      });
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

    it("rejects a gap in the version chain", () => {
      const registry = new UpcasterRegistry();
      registry.register({
        eventType: "A",
        fromSchemaVersion: 3,
        toSchemaVersion: 4,
        upcast: (d: unknown) => d,
      });

      expect(() => registry.getLatestVersion("A", 1)).toThrow(
        /Missing upcaster.*version 1/,
      );
    });
  });
});
