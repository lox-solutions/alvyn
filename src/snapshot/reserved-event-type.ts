import { ReservedSnapshotEventTypeError } from "../errors";
import type { AppendEventInput } from "../types";

export const SNAPSHOT_EVENT_TYPE_SUFFIX = "Snapshot";

export function isReservedSnapshotEventType(eventType: string): boolean {
  return eventType.endsWith(SNAPSHOT_EVENT_TYPE_SUFFIX);
}

export function assertNoReservedSnapshotEventTypes(
  events: AppendEventInput[],
): void {
  const reservedEvent = events.find((event) =>
    isReservedSnapshotEventType(event.type),
  );
  if (reservedEvent)
    throw new ReservedSnapshotEventTypeError(reservedEvent.type);
}

export function assertOnlyReservedSnapshotEventTypes(
  events: AppendEventInput[],
): void {
  const domainEvent = events.find(
    (event) => !isReservedSnapshotEventType(event.type),
  );
  if (domainEvent) {
    throw new Error(
      `Internal snapshot append can only write event types ending in "Snapshot", got "${domainEvent.type}".`,
    );
  }
}
