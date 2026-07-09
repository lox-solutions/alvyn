import Link from "next/link";
import { basePath } from "@/lib/shared";
import { NeonHeadline } from "@/components/NeonHeadline";
import { JourneySimulator } from "@/components/JourneySimulator";
import { CodeShowcase } from "@/components/CodeShowcase";
import {
  Sparkles,
  Database,
  Lock,
  GitFork,
  FileJson,
  Activity,
  ArrowRight,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center flex-1 overflow-hidden bg-fd-background text-fd-foreground selection:bg-zinc-800">
      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      <section className="relative w-full min-h-[92vh] flex flex-col items-center justify-center px-6 text-center py-24 overflow-hidden">
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
            src={`${basePath}/logo.png`}
            alt="Alvyn"
            width={200}
            height={200}
            className="mb-8"
          />

          {/* Clean monochromatic pill badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-fd-zinc-800 bg-fd-zinc-900/40 px-4 py-2 text-[10px] font-mono tracking-widest uppercase text-fd-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            Event Sourcing · Domain-Driven
          </div>

          <NeonHeadline line1="Your data tells" line2="the whole story." />

          <p className="text-base md:text-lg text-zinc-400 max-w-2xl mb-12 leading-relaxed tracking-normal font-normal text-center px-4">
            CRUD applications capture what happened, but they often lose the
            reason why. Alvyn records the{" "}
            <span className="font-semibold text-fd-foreground border-b border-fd-foreground/20 pb-0.5">
              full narrative
            </span>{" "}
            of your business logic as an immutable stream of events. Stop
            settling for static records; start building on the truth of your history.
          </p>

          {/* Action CTAs in Apple Style */}
          <div className="flex flex-wrap justify-center gap-4 mb-24">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold bg-fd-primary text-fd-primary-foreground hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer shadow-[0_8px_30px_rgba(var(--color-fd-primary),0.15)]"
            >
              Get Started
              <ArrowRight size={15} />
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

          {/* Live Domain Simulator Showcase */}
          <div className="w-full flex flex-col items-center mt-6 z-20">
            <div className="text-center mb-12 max-w-xl">
              <h2 className="text-3xl font-semibold tracking-tight text-fd-foreground mb-3">
                Experience the Paradigm Shift
              </h2>
              <p className="text-sm text-fd-muted-foreground leading-relaxed max-w-md mx-auto">
                Click the library actions below to see why Traditional CRUD
                loses data and how Alvyn builds an AI-ready domain journey
                narrative.
              </p>
            </div>
            <JourneySimulator />
          </div>
        </div>
      </section>

      {/* ── THESIS SECTION ───────────────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border bg-fd-secondary/20 backdrop-blur-xl relative">
        <div className="max-w-6xl mx-auto px-6 py-32 grid grid-cols-1 md:grid-cols-2 gap-24 relative z-10">
          {/* Pillar 1 */}
          <div className="flex flex-col text-left">
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-fd-muted-foreground mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-fd-border" /> 01 — Beyond the Four
              Verbs
            </span>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-6 text-fd-foreground">
              The database shouldn&apos;t
              <br />
              <span className="text-fd-muted-foreground font-normal">
                dictate your domain.
              </span>
            </h2>
            <div className="space-y-6 text-fd-muted-foreground leading-relaxed text-base font-normal">
              <p>
                Traditional CRUD architectures collapse complex business logic
                into generic operations. A single &ldquo;Update&rdquo; might
                represent upgrading a subscription, correcting a billing error,
                or adjusting a delivery window. When these are flattened into a
                table row, the context is lost forever.
              </p>
              <p>
                In an era where data is the ultimate competitive advantage,
                discarding meaning is a strategic risk. You can always derive
                state from events, but you can never reconstruct the{" "}
                <strong className="font-semibold text-fd-foreground">
                  original intent
                </strong>{" "}
                from a modified row.
              </p>
              <p>
                Alvyn ensures that every business action is preserved with its
                full context, creating a high-fidelity record that serves your
                users today and your AI models tomorrow.
              </p>
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="flex flex-col text-left">
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-fd-muted-foreground mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-fd-border" /> 02 — Semantic Precision
            </span>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-6 text-fd-foreground">
              Code that speaks
              <br />
              <span className="text-fd-muted-foreground font-normal">
                your business language.
              </span>
            </h2>
            <div className="space-y-6 text-fd-muted-foreground leading-relaxed text-base font-normal">
              <p>
                When your codebase uses the same vocabulary as your domain
                experts, complexity disappears. Instead of generic functions,
                Alvyn encourages verbs that mean something:{" "}
                <code className="text-fd-secondary-foreground">
                  onboardCustomer
                </code>
                ,{" "}
                <code className="text-fd-secondary-foreground">
                  approveClaim
                </code>
                , or{" "}
                <code className="text-fd-secondary-foreground">
                  suspendAccess
                </code>
                .
              </p>
              <p>
                Naming isn&apos;t just about style; it&apos;s about{" "}
                <strong className="font-semibold text-fd-foreground">
                  system integrity
                </strong>
                . By capturing the language of the business directly in your
                events, you eliminate the translation layer that causes most
                software failures.
              </p>
              <p>
                Event Sourcing with Alvyn turns your audit log into a living
                document that any stakeholder can understand, ensuring your
                architecture stays aligned with reality as you scale.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CODE SHOWCASE SECTION ───────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border bg-fd-background relative py-32">
        <div className="max-w-5xl mx-auto px-6 flex flex-col items-center">
          <div className="text-center mb-16 max-w-xl">
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-fd-muted-foreground mb-3 block">
              Type-Safe, PostgreSQL-Native
            </span>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-fd-foreground mb-4">
              Event streams as simple as standard DB queries.
            </h2>
            <p className="text-sm text-fd-muted-foreground leading-relaxed max-w-md mx-auto">
              No complex external message brokers or distributed consensus
              clusters. Alvyn runs directly inside your existing PostgreSQL
              database with total compile-time safety.
            </p>
          </div>
          <CodeShowcase />
        </div>
      </section>

      {/* ── FEATURES SECTION ────────────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border bg-fd-secondary/30">
        <div className="max-w-6xl mx-auto px-6 py-32 text-left">
          <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-fd-muted-foreground mb-3 block">
            The Engine
          </span>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-20 text-fd-foreground max-w-xl">
            Everything you need for enterprise-grade streams.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Sparkles,
                n: "01",
                title: "Preserve Business Intent",
                body: "Every state transition is stored as an immutable, append-only historical fact. Never lose the 'why' behind a change again.",
              },
              {
                icon: Database,
                n: "02",
                title: "Native PostgreSQL",
                body: "No heavy Kafka or EventStoreDB setups. Uses native Postgres advisory locks, optimistic concurrency, and Outbox patterns in your current DB.",
              },
              {
                icon: Lock,
                n: "03",
                title: "GDPR Crypto-Shredding",
                body: "Built-in AES-256-GCM event encryption. Instantly shred a cryptographic tenant key to make PII irrecoverable—even in historical logs.",
              },
              {
                icon: GitFork,
                n: "04",
                title: "Schema Evolution",
                body: "Real-world business logic shifts. Out-of-the-box support for Event Upcasting and version mappings ensures history evolves gracefully.",
              },
              {
                icon: FileJson,
                n: "05",
                title: "Type-Safe Aggregates",
                body: "Strict TypeScript compilation guarantees. Event mapping inference and strict aggregate state definitions.",
              },
              {
                icon: Activity,
                n: "06",
                title: "High-Fidelity History",
                body: "An absolute record of every business decision and user action. The foundational core for auditable systems and AI-ready datasets.",
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
            Stop treating your data like a draft. Every action in your system is
            a permanent piece of your business history. By recording the truth
            of how your application evolves, you build a foundation that
            empowers your logic, your auditors, and your AI future.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full px-10 py-4 text-sm font-semibold bg-fd-primary text-fd-primary-foreground hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_8px_30px_rgba(var(--color-fd-primary),0.15)] cursor-pointer"
            >
              Start Building Now
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
