import { appName, baseUrl } from "@/lib/shared";
import { getPageMarkdownUrl, source } from "@/lib/source";

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();
  const lines: string[] = [
    `# ${appName}`,
    "",
    "> PostgreSQL-native event history for TypeScript applications: AI agent steps, orders, approvals, and other business processes. Not an agent framework or workflow runtime.",
    "",
    "## Core Architectural Primitives & Cheatsheet",
    "- Event Store Setup: `const eventStore = new EventStore({ pool }); await eventStore.setup();`",
    "- Type-Safe Aggregates: `const Agg = defineAggregate<TState, TEvents>()({ streamPrefix, evolve })`",
    "- Stream Operations: `await Agg.load(eventStore, entityId)` | `await Agg.append(eventStore, { entityId, expectedVersion, events })`. An optional idempotencyKey belongs in the append options object.",
    "- Initialization: An aggregate starts with null state; its first event handler must construct the complete state. Provide a handler for every event type.",
    "- Concurrency: expectedVersion -1 requires a new stream; 0 disables the check; a positive version checks the current stream version.",
    "- Recording: Applications explicitly append CloudEvents. Alvyn does not automatically capture model reasoning or tool calls.",
    "- Reading: `await eventStore.load(streamId)` or `await eventStore.loadFrom(streamId, { fromVersion: 1 })` returns an array. No loadStream, toTime, or toVersion API exists. Historical reconstruction requires selecting events and reducing them explicitly.",
    "- Replay reconstructs recorded application state with deterministic reducers, not deterministic model responses or external tool execution.",
    "- Crypto-shredding: Optional per-entity AES-256-GCM encryption. Configure snapshot encryption separately; handle null event data after key revocation. Backups, exports, and key copies require their own policies.",
    "- Transactional Outbox: `await eventStore.processOutbox(handler)` provides at-least-once processing. External effects require idempotency. `await eventStore.cleanupOutbox(7 * 24 * 60 * 60 * 1000)` retains processed records for seven days (argument in milliseconds).",
    "- Projections: Build query models using the projection transaction client. Separate read services are optional, not an onboarding requirement.",
    "- Event-backed snapshots reduce replay work and add events/versions to the stream.",
    "- Operational boundaries: Append-oriented APIs do not prevent privileged SQL mutation or provide legal compliance by themselves.",
    "- Schema Evolution: Read-time event upcasters without mutating stored historical events.",
    "",
    "## Documentation & API Blueprints",
    "",
  ];

  for (const page of pages) {
    const mdUrl = `${baseUrl}${getPageMarkdownUrl(page).url}`;
    const description = page.data.description
      ? `: ${page.data.description}`
      : "";
    lines.push(`- [${page.data.title}](${mdUrl})${description}`);
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
