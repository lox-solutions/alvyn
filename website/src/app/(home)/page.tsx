import Link from "next/link";
import { NeonHeadline } from "@/components/NeonHeadline";
import { JourneySimulator } from "@/components/JourneySimulator";
import { CodeShowcase } from "@/components/CodeShowcase";
import { InstallSnippet } from "@/components/InstallSnippet";
import type { Metadata } from "next";
import { baseUrl } from "@/lib/shared";
import {
  Sparkles,
  Database,
  Lock,
  GitFork,
  FileJson,
  ArrowRight,
  Bot,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = {
  alternates: { canonical: baseUrl },
};

export default function HomePage() {
  return (
    <div className="flex flex-col items-center flex-1 overflow-hidden bg-fd-background text-fd-foreground selection:bg-zinc-800">
      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      <section className="relative w-full flex flex-col items-center justify-center px-6 text-center py-12 md:py-16 overflow-hidden">
        {/* Soft, premium radial glow targeting the headline */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full opacity-[0.1] dark:opacity-[0.05] blur-[120px]"
          style={{
            background:
              "radial-gradient(circle, var(--color-neon-glow) 0%, transparent 70%)",
          }}
        />

        <div className="relative z-10 flex flex-col items-center w-full max-w-5xl">
          {/* Logo with high-end glassmorphism and minimal borders */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Alvyn"
            width={112}
            height={112}
            className="mb-6"
          />

          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-fd-border bg-fd-secondary/60 text-xs font-mono font-medium text-fd-foreground mb-6 backdrop-blur-sm shadow-sm">
            <Sparkles size={13} className="text-emerald-400" />
            Event history for AI agents &amp; everyday applications
          </div>

          <NeonHeadline line1="Your data tells" line2="the whole story." />

          <p className="text-base md:text-lg text-zinc-600 dark:text-zinc-300 max-w-2xl mb-6 leading-relaxed tracking-normal font-normal text-center px-4">
            Store agent tool calls, order updates, and business events. Rebuild
            application state from that history — in your own PostgreSQL
            database. Alvyn brings type-safe event sourcing to TypeScript,
            without requiring a new agent framework or a separate message
            broker.
          </p>

          {/* Action CTAs in Apple Style */}
          <div className="flex flex-wrap justify-center gap-4 mb-6">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold bg-fd-primary text-fd-primary-foreground hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer shadow-[0_8px_30px_rgba(var(--color-fd-primary),0.15)]"
            >
              Get Started
              <ArrowRight size={15} />
            </Link>
            <Link
              href="/docs/playbooks/ai-agent-deterministic-memory-and-audit"
              className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-secondary/60 backdrop-blur-sm px-8 py-3.5 text-sm font-semibold text-fd-foreground hover:bg-fd-secondary/80 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer shadow-sm"
            >
              <Bot size={16} />
              AI Agent Playbook
            </Link>
            <Link
              href="https://github.com/lox-solutions/alvyn"
              className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-secondary/40 backdrop-blur-sm px-8 py-3.5 text-sm font-semibold text-fd-secondary-foreground hover:bg-fd-secondary/60 transition-all cursor-pointer"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              GitHub Repository
            </Link>
          </div>
          <InstallSnippet />
          <p className="text-sm text-fd-muted-foreground mt-4">
            Start with one stream. No prior event sourcing or CQRS knowledge
            needed.
          </p>
        </div>
      </section>

      <section className="w-full border-t border-fd-border py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-semibold tracking-tight text-center mb-4">
            Keep the steps, not just the latest result.
          </h2>
          <p className="text-fd-muted-foreground text-center max-w-2xl mx-auto mb-8">
            Try a familiar library checkout. The same principle applies to an
            agent run or an order: save what happened, then derive the current
            state. This interactive illustration runs locally in your browser,
            not against a database.
          </p>
          <JourneySimulator />
        </div>
      </section>

      {/* ── CODE SHOWCASE SECTION ───────────────────────────────────────── */}
      <section className="w-full bg-fd-background relative py-32">
        <div className="max-w-5xl mx-auto px-6 flex flex-col items-center">
          <div className="text-center mb-16 max-w-xl">
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-fd-muted-foreground mb-3 block">
              Type-Safe, PostgreSQL-Native
            </span>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-fd-foreground mb-4">
              A few events. A state you can explain.
            </h2>
            <p className="text-sm text-fd-muted-foreground leading-relaxed max-w-md mx-auto">
              No complex external message brokers or distributed consensus
              clusters. Alvyn runs directly inside your existing PostgreSQL
              database. Typed events and reducers keep your application
              contracts explicit.
            </p>
          </div>
          <CodeShowcase />
        </div>
      </section>

      {/* ── THESIS SECTION ───────────────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border bg-fd-secondary/20 backdrop-blur-xl relative">
        <div className="max-w-6xl mx-auto px-6 py-32 grid grid-cols-1 md:grid-cols-2 gap-24 relative z-10">
          {/* Pillar 1 */}
          <div className="flex flex-col text-left">
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-fd-muted-foreground mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-fd-border" /> 01 — Start with a
              useful history
            </span>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-6 text-fd-foreground">
              Deterministic replay &amp; audit trails
              <br />
              <span className="text-fd-muted-foreground font-normal">
                for AI &amp; distributed systems.
              </span>
            </h2>
            <div className="space-y-6 text-fd-muted-foreground leading-relaxed text-base font-normal">
              <p>
                A final status cannot tell you which tool timed out, why an
                order changed, or which approval preceded a payment. If your
                application only stores the latest state, those transitions are
                missing.
              </p>
              <p>
                With Alvyn, your application explicitly records meaningful
                events. Pure reducers turn them into current state. That is
                event sourcing: start small, without splitting your whole
                application into separate read and write services. Add
                projections when your queries need them.
              </p>
              <p>
                Replay reconstructs state from recorded events. It does not
                rerun models deterministically, reveal their internal reasoning,
                or automatically resume external tool calls. Keep your existing
                AI SDK, web framework, and observability tools.
              </p>
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="flex flex-col text-left">
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-fd-muted-foreground mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-fd-border" /> 02 — Know the
              guarantees
            </span>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-6 text-fd-foreground">
              Useful records.
              <br />
              <span className="text-fd-muted-foreground font-normal">
                Explicit boundaries.
              </span>
            </h2>
            <div className="space-y-6 text-fd-muted-foreground leading-relaxed text-base font-normal">
              <p>
                Append-oriented APIs and CloudEvents provide a structured
                history. They do not make PostgreSQL tamper-proof: database
                permissions, retention, backups, and monitoring remain part of
                your deployment.
              </p>
              <p>
                Optional AES-256-GCM envelope encryption supports
                crypto-shredding. Protect snapshots separately and account for
                exported data, keys, and backups. Reducers must explicitly
                handle redacted events.
              </p>
              <p>
                These primitives can support audit and privacy requirements;
                using Alvyn alone does not establish GDPR or EU AI Act
                compliance. Article 12 addresses logging for high-risk AI
                systems, not a universal requirement to record every model
                token.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES SECTION ────────────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border bg-fd-secondary/30">
        <div className="max-w-6xl mx-auto px-6 py-32 text-left">
          <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-fd-muted-foreground mb-3 block">
            The Engine
          </span>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-20 text-fd-foreground max-w-xl">
            Start small. Add the primitives you need.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Sparkles,
                n: "01",
                title: "Rebuild application state",
                body: "Replay recorded events through your reducers. Inspect agent steps or business transitions without calling the model or external tools again.",
              },
              {
                icon: ShieldCheck,
                n: "02",
                title: "Structured event history",
                body: "Record the inputs, outputs, and decisions your application chooses to persist as CloudEvents. Complement traces with durable business history.",
              },
              {
                icon: Lock,
                n: "03",
                title: "Optional envelope encryption",
                body: "Built-in envelope encryption. Revoking a cryptographic tenant or user key renders PII unreadable (tombstoned), helping teams honor erasure requests while keeping the event stream intact.",
              },
              {
                icon: Database,
                n: "04",
                title: "PostgreSQL-native outbox",
                body: "Commit events and outbox records together. Relay with at-least-once delivery; external side effects still need idempotency. No separate broker required to get started.",
              },
              {
                icon: FileJson,
                n: "05",
                title: "Type-Safe Aggregates & Invariants",
                body: "Typed payloads and handler inference help keep events and reducers consistent. Your application validates inputs and enforces business rules before appending.",
              },
              {
                icon: GitFork,
                n: "06",
                title: "Read-time schema evolution",
                body: "Upcasters transform older event payloads when reading, without rewriting history. Plan compatible reader and writer rollouts as your application changes.",
              },
            ].map(({ icon: Icon, n, title, body }) => (
              <div
                key={n}
                className="group relative rounded-3xl border border-fd-border bg-fd-secondary/40 p-8 hover:border-fd-accent hover:bg-fd-accent/20 transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="p-3 rounded-2xl bg-fd-secondary border border-fd-border text-fd-secondary-foreground group-hover:text-fd-foreground group-hover:border-fd-accent transition-all duration-300 shadow-sm">
                    <Icon size={18} />
                  </div>
                  <span className="text-xs font-mono font-bold tracking-widest text-fd-muted-foreground group-hover:text-fd-secondary-foreground transition-all duration-300">
                    {n}
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-3 text-fd-foreground transition-all duration-300">
                  {title}
                </h3>
                <p className="text-sm text-fd-muted-foreground leading-relaxed font-light">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MANIFESTO & CLOSING CTA ─────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border py-16">
        <div className="max-w-4xl mx-auto px-6 space-y-5">
          <h2 className="text-3xl font-semibold">
            Is Alvyn right for your application?
          </h2>
          <p className="text-fd-muted-foreground">
            Choose it when transitions matter: tool execution records,
            approvals, orders, subscriptions, or other state with a history
            worth keeping. Ordinary CRUD is still a good choice when you only
            need current values.
          </p>
          <p className="text-fd-muted-foreground">
            Alvyn is not a workflow runtime, vector memory service, or
            observability platform. Keep those tools where you need scheduling,
            semantic retrieval, or tracing. Event history is the complementary
            persistence layer.
          </p>
          <div className="flex flex-wrap gap-6 underline underline-offset-4">
            <Link href="/docs/load-testing">Benchmarks and their limits</Link>
            <Link href="/docs/api-reference">
              API and concurrency guarantees
            </Link>
            <Link href="https://github.com/lox-solutions/alvyn/releases">
              Releases and compatibility changes
            </Link>
          </div>
        </div>
      </section>
      <section className="relative w-full border-t border-fd-border overflow-hidden bg-gradient-to-b from-transparent to-fd-background">
        {/* Soft, premium highlight mask */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full opacity-[0.03] blur-[120px]"
          style={{
            background:
              "radial-gradient(circle, var(--color-fd-primary) 0%, transparent 70%)",
          }}
        />

        <div className="max-w-4xl mx-auto px-6 py-40 text-center relative z-10">
          <p className="text-4xl md:text-6xl font-semibold tracking-tight leading-tight mb-8 text-fd-foreground">
            &ldquo;The event log is not a side effect.
            <br />
            <span className="text-fd-muted-foreground">
              It is your system.&rdquo;
            </span>
          </p>
          <p className="text-fd-muted-foreground text-base max-w-xl mx-auto mb-14 leading-relaxed font-normal">
            You do not need to redesign your whole application. Pick one agent
            run or business process, record its events, and rebuild its state.
            Learn event sourcing by solving a problem you already have.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full px-10 py-4 text-sm font-semibold bg-fd-primary text-fd-primary-foreground hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_8px_30px_rgba(var(--color-fd-primary),0.15)] cursor-pointer"
            >
              Start Building Now
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/docs/playbooks/ai-agent-deterministic-memory-and-audit"
              className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-secondary/60 backdrop-blur-sm px-10 py-4 text-sm font-semibold text-fd-foreground hover:bg-fd-secondary/80 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer shadow-sm"
            >
              <Bot size={16} />
              Explore AI Agent Playbook
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
