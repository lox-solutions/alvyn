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
  BookOpen,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center flex-1 overflow-hidden bg-[#07090b]">
      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      <section className="relative w-full min-h-[92vh] flex flex-col items-center justify-center px-6 text-center py-20 overflow-hidden">
        {/* Sleek cyber grid background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04] bg-[size:48px_48px]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-fd-foreground) 1px, transparent 1px), linear-gradient(90deg, var(--color-fd-foreground) 1px, transparent 1px)",
          }}
        />

        {/* Cinematic abstract glow mesh */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.15] blur-[120px]"
          style={{
            background:
              "radial-gradient(circle, var(--color-fd-primary) 0%, transparent 60%)",
          }}
        />

        <div className="relative z-10 flex flex-col items-center w-full max-w-5xl">
          {/* Logo with high-end glassmorphism */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${basePath}/logo.png`}
            alt="Alvyn"
            width={120}
            height={120}
            className="rounded-2xl mb-8 shadow-[0_0_50px_rgba(var(--color-fd-primary),0.3)] border border-fd-border/30 hover:scale-105 transition-all duration-500"
          />

          {/* Glowing pill badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-fd-border/50 bg-fd-background/50 backdrop-blur-md px-4 py-2 text-xs font-semibold tracking-[0.2em] uppercase text-fd-muted-foreground animate-in fade-in slide-in-from-top-4 duration-1000">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-fd-primary animate-pulse"
              style={{ boxShadow: "0 0 10px var(--color-fd-primary)" }}
            />
            Event Sourcing · Domain-Driven
          </div>

          <NeonHeadline line1="Your data tells" line2="the whole story." />

          <p className="text-lg md:text-xl text-fd-muted-foreground max-w-3xl mb-12 leading-relaxed font-light text-center px-4">
            In the agentic AI era, features are commodity wrappers. The only
            defensible moat is{" "}
            <span className="not-italic font-semibold text-fd-foreground border-b border-fd-primary/30 pb-0.5">
              domain-specific, high-fidelity business data
            </span>
            . Alvyn captures every business intent as an immutable append-only
            fact. Your AI systems remember everything, forever.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-wrap justify-center gap-4 mb-20">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-xl px-8 py-4 text-sm font-bold text-fd-primary-foreground hover:scale-[1.03] transition-all shadow-[0_4px_30px_rgba(var(--color-fd-primary),0.2)] hover:shadow-[0_4px_40px_rgba(var(--color-fd-primary),0.4)] cursor-pointer"
              style={{ background: "var(--color-fd-primary)" }}
            >
              Get Started
              <BookOpen size={16} />
            </Link>
            <Link
              href="https://github.com/lox-solutions/alvyn"
              className="inline-flex items-center gap-2 rounded-xl border border-fd-border bg-fd-accent/10 backdrop-blur-sm px-8 py-4 text-sm font-bold hover:bg-fd-accent hover:border-fd-primary/30 transition-all cursor-pointer"
            >
              <svg
                width="16"
                height="16"
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
            <div className="text-center mb-8 max-w-xl">
              <h2 className="text-2xl font-black tracking-tight mb-2">
                Experience the Paradigm Shift
              </h2>
              <p className="text-sm text-fd-muted-foreground leading-relaxed">
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
      <section className="w-full border-t border-fd-border/30 bg-[#0a0c0e]/50 backdrop-blur-xl relative">
        <div className="max-w-6xl mx-auto px-6 py-32 grid grid-cols-1 md:grid-cols-2 gap-24 relative z-10">
          {/* Pillar 1 */}
          <div className="flex flex-col text-left">
            <span className="text-xs font-bold tracking-[0.25em] uppercase text-fd-primary mb-6 flex items-center gap-2">
              <span className="w-8 h-px bg-fd-primary/50" /> 01 — The AI Shift
            </span>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-tight mb-6 text-fd-foreground">
              Software is a commodity.
              <br />
              <span className="text-fd-primary">Data is your moat.</span>
            </h2>
            <div className="space-y-6 text-fd-muted-foreground leading-relaxed text-base font-light">
              <p>
                Vibe-coding tools can ship a feature in minutes. Foundation
                models can replicate your entire application interface
                overnight. The landmark a16z 2025 findings are absolute:{" "}
                <em className="not-italic font-semibold text-fd-foreground">
                  as model capabilities commoditize, competitive scarcity shifts
                  entirely to proprietary data.
                </em>
              </p>
              <p>
                The enterprises leading the next decade are moving up the value
                stack — from basic <strong>Software Features</strong> to
                integrated <strong>Platform Infrastructure</strong>, and
                ultimately to a private, high-fidelity{" "}
                <strong>Domain Data Ecosystem</strong>.
              </p>
              <p>
                Alvyn provides the event-driven storage framework that records
                raw business actions as they happen, yielding an irreplaceable
                dataset no model can synthesize for you.
              </p>
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="flex flex-col text-left">
            <span className="text-xs font-bold tracking-[0.25em] uppercase text-fd-primary mb-6 flex items-center gap-2">
              <span className="w-8 h-px bg-fd-primary/50" /> 02 — Domain Reality
            </span>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-tight mb-6 text-fd-foreground">
              Your business
              <br />
              <span className="text-fd-primary">isn&apos;t CRUD.</span>
            </h2>
            <div className="space-y-6 text-fd-muted-foreground leading-relaxed text-base font-light">
              <p>
                When you translate complex business events into static tables
                and rows, you erase the{" "}
                <em className="not-italic font-semibold text-fd-foreground">
                  narrative and intent
                </em>{" "}
                of your actions. A library member didn&apos;t just &ldquo;mark
                loan returned&rdquo; — they checked out a trending topic,
                extended their study, resolved a misplaced asset, and pivoted to
                deep platform engineering books.
              </p>
              <p>
                In the era of AI engineering, syntax and code writing are solved
                problems. **Domain modeling and software architecting** are the
                new high-value frontiers.
              </p>
              <p>
                Engineers who leverage Event-Sourcing build systems that
                perfectly capture business truth, elevating themselves from
                feature coders to domain architects.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES SECTION ────────────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border/30">
        <div className="max-w-6xl mx-auto px-6 py-32 text-left">
          <span className="text-xs font-bold tracking-[0.25em] uppercase text-fd-primary mb-4 block">
            The Engine
          </span>
          <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-20 text-fd-foreground max-w-2xl">
            Everything you need for enterprise-grade streams.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: Sparkles,
                n: "01",
                title: "Immutable Event Log",
                body: "Every state transition is stored as an immutable, append-only historical fact. Feed downstream AI pipelines with flawless ground truth.",
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
                body: "Strict TypeScript compilation guarantees. Event mapping inference, snapshotting, and strict aggregate state definitions.",
              },
              {
                icon: Activity,
                n: "06",
                title: "AI-Ready Audit Trail",
                body: "An absolute record of every algorithmic decision, user action, and agent intent. The foundational core of auditable AI systems.",
              },
            ].map(({ icon: Icon, n, title, body }) => (
              <div
                key={n}
                className="group relative rounded-2xl border border-fd-border/40 bg-fd-background/30 p-8 hover:border-fd-primary/30 hover:bg-fd-accent/5 backdrop-blur-sm transition-all duration-300"
              >
                {/* Visual Glow Indicator */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-fd-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 rounded-t-2xl" />

                <div className="flex items-center justify-between mb-6">
                  <div className="p-2.5 rounded-xl bg-fd-primary/5 text-fd-primary border border-fd-primary/15 group-hover:bg-fd-primary/10 group-hover:border-fd-primary/30 transition-all duration-300">
                    <Icon size={18} />
                  </div>
                  <span className="text-xs font-mono font-bold tracking-widest text-fd-muted-foreground/30 group-hover:text-fd-primary/30 transition-all duration-300">
                    {n}
                  </span>
                </div>
                <h3 className="text-lg font-bold mb-3 text-fd-foreground group-hover:text-fd-primary transition-all duration-300">
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
      <section className="w-full border-t border-fd-border/30 relative overflow-hidden bg-gradient-to-b from-transparent to-[#0a0c0e]">
        {/* Soft atmospheric bottom glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full opacity-20 blur-[100px]"
          style={{
            background:
              "radial-gradient(circle, var(--color-fd-primary) 0%, transparent 70%)",
          }}
        />

        <div className="max-w-4xl mx-auto px-6 py-40 text-center relative z-10">
          <p className="text-3xl md:text-5xl font-black tracking-tight leading-tight mb-8 text-fd-foreground">
            &ldquo;The event log is not a side effect.
            <br />
            <span style={{ color: "var(--color-fd-primary)" }}>
              It is your system.&rdquo;
            </span>
          </p>
          <p className="text-fd-muted-foreground text-base max-w-2xl mx-auto mb-14 leading-relaxed font-light">
            Stop overwriting the present. Accumulate history to command the
            future. Your AI, your compliance auditors, and your product
            engineering metrics will thank you.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-xl px-10 py-5 text-sm font-bold text-fd-primary-foreground hover:opacity-90 hover:scale-[1.03] transition-all shadow-[0_4px_30px_rgba(var(--color-fd-primary),0.25)] cursor-pointer"
              style={{ background: "var(--color-fd-primary)" }}
            >
              Start Building Now
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/docs/introduction"
              className="inline-flex items-center gap-2 rounded-xl border border-fd-border/80 bg-fd-background/50 backdrop-blur-md px-10 py-5 text-sm font-bold hover:bg-fd-accent hover:text-fd-foreground transition-all cursor-pointer"
            >
              Read Philosophy
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
