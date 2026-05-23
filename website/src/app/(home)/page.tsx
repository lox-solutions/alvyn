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
    <div className="flex flex-col items-center flex-1 overflow-hidden bg-black text-white selection:bg-zinc-800">
      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      <section className="relative w-full min-h-[92vh] flex flex-col items-center justify-center px-6 text-center py-24 overflow-hidden">
        {/* Soft, premium radial glow targeting the headline */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full opacity-[0.05] blur-[120px]"
          style={{
            background: "radial-gradient(circle, #ffffff 0%, transparent 70%)",
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
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/40 px-4 py-2 text-[10px] font-mono tracking-widest uppercase text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            Event Sourcing · Domain-Driven
          </div>

          <NeonHeadline
            line1="Your data tells"
            line2="the whole story."
            glowColor="rgba(255,255,255,0.75)"
          />

          <p className="text-base md:text-lg text-zinc-400 max-w-2xl mb-12 leading-relaxed tracking-normal font-normal text-center px-4">
            In the agentic AI era, features are commodity wrappers. The only
            defensible moat is{" "}
            <span className="font-semibold text-white border-b border-white/20 pb-0.5">
              domain-specific, high-fidelity business data
            </span>
            . Alvyn captures every business intent as an immutable append-only
            fact. Your AI systems remember everything, forever.
          </p>

          {/* Action CTAs in Apple Style */}
          <div className="flex flex-wrap justify-center gap-4 mb-24">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold bg-white text-black hover:bg-zinc-200 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer shadow-[0_8px_30px_rgba(255,255,255,0.15)]"
            >
              Get Started
              <ArrowRight size={15} />
            </Link>
            <Link
              href="https://github.com/lox-solutions/alvyn"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 backdrop-blur-sm px-8 py-3.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-900/60 hover:text-white transition-all cursor-pointer"
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
              <h2 className="text-3xl font-semibold tracking-tight text-white mb-3">
                Experience the Paradigm Shift
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-md mx-auto">
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
      <section className="w-full border-t border-zinc-900 bg-zinc-950/20 backdrop-blur-xl relative">
        <div className="max-w-6xl mx-auto px-6 py-32 grid grid-cols-1 md:grid-cols-2 gap-24 relative z-10">
          {/* Pillar 1 */}
          <div className="flex flex-col text-left">
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-zinc-500 mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-zinc-850" /> 01 — The AI Shift
            </span>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-6 text-white">
              Software is a commodity.
              <br />
              <span className="text-zinc-500 font-normal">
                Data is your moat.
              </span>
            </h2>
            <div className="space-y-6 text-zinc-400 leading-relaxed text-base font-normal">
              <p>
                Vibe-coding tools can ship a feature in minutes. Foundation
                models can replicate your entire application interface
                overnight. The landmark a16z 2025 findings are absolute:{" "}
                <em className="not-italic text-zinc-200">
                  as model capabilities commoditize, competitive scarcity shifts
                  entirely to proprietary data.
                </em>
              </p>
              <p>
                The enterprises leading the next decade are moving up the value
                stack — from basic{" "}
                <strong className="font-semibold text-white">
                  Software Features
                </strong>{" "}
                to integrated{" "}
                <strong className="font-semibold text-white">
                  Platform Infrastructure
                </strong>
                , and ultimately to a private, high-fidelity{" "}
                <strong className="font-semibold text-white">
                  Domain Data Ecosystem
                </strong>
                .
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
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-zinc-500 mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-zinc-850" /> 02 — Domain Reality
            </span>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight mb-6 text-white">
              Your business
              <br />
              <span className="text-zinc-500 font-normal">
                isn&apos;t CRUD.
              </span>
            </h2>
            <div className="space-y-6 text-zinc-400 leading-relaxed text-base font-normal">
              <p>
                When you translate complex business events into static tables
                and rows, you erase the{" "}
                <em className="not-italic text-zinc-200">
                  narrative and intent
                </em>{" "}
                of your actions. A library member didn&apos;t just &ldquo;mark
                loan returned&rdquo; — they checked out a trending topic,
                extended their study, resolved a misplaced asset, and pivoted to
                deep platform engineering books.
              </p>
              <p>
                In the era of AI engineering, syntax and code writing are solved
                problems.{" "}
                <strong className="font-semibold text-white">
                  Domain modeling and software architecting
                </strong>{" "}
                are the new high-value frontiers.
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

      {/* ── CODE SHOWCASE SECTION ───────────────────────────────────────── */}
      <section className="w-full border-t border-zinc-900 bg-black relative py-32">
        <div className="max-w-5xl mx-auto px-6 flex flex-col items-center">
          <div className="text-center mb-16 max-w-xl">
            <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-zinc-500 mb-3 block">
              Type-Safe, PostgreSQL-Native
            </span>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-white mb-4">
              Event streams as simple as standard DB queries.
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-md mx-auto">
              No complex external message brokers or distributed consensus
              clusters. Alvyn runs directly inside your existing PostgreSQL
              database with total compile-time safety.
            </p>
          </div>
          <CodeShowcase />
        </div>
      </section>

      {/* ── FEATURES SECTION ────────────────────────────────────────────── */}
      <section className="w-full border-t border-zinc-900 bg-[#040406]/30">
        <div className="max-w-6xl mx-auto px-6 py-32 text-left">
          <span className="text-xs font-mono font-medium uppercase tracking-[0.2em] text-zinc-500 mb-3 block">
            The Engine
          </span>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-20 text-white max-w-xl">
            Everything you need for enterprise-grade streams.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
                className="group relative rounded-3xl border border-zinc-900 bg-[#09090b]/40 p-8 hover:border-zinc-800 hover:bg-zinc-900/20 transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="p-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-200 group-hover:text-white group-hover:border-zinc-700 transition-all duration-300 shadow-sm">
                    <Icon size={18} />
                  </div>
                  <span className="text-xs font-mono font-bold tracking-widest text-zinc-700 group-hover:text-zinc-500 transition-all duration-300">
                    {n}
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-3 text-white transition-all duration-300">
                  {title}
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed font-light">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MANIFESTO & CLOSING CTA ─────────────────────────────────────── */}
      <section className="relative w-full border-t border-zinc-900 overflow-hidden bg-gradient-to-b from-transparent to-black">
        {/* Soft, premium highlight mask */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full opacity-[0.03] blur-[120px]"
          style={{
            background: "radial-gradient(circle, #ffffff 0%, transparent 70%)",
          }}
        />

        <div className="max-w-4xl mx-auto px-6 py-40 text-center relative z-10">
          <p className="text-4xl md:text-6xl font-semibold tracking-tight leading-tight mb-8 text-white">
            &ldquo;The event log is not a side effect.
            <br />
            <span className="text-zinc-500">It is your system.&rdquo;</span>
          </p>
          <p className="text-zinc-400 text-base max-w-xl mx-auto mb-14 leading-relaxed font-normal">
            Stop overwriting the present. Accumulate history to command the
            future. Your AI, your compliance auditors, and your product
            engineering metrics will thank you.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full px-10 py-4 text-sm font-semibold bg-white text-black hover:bg-zinc-200 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_8px_30px_rgba(255,255,255,0.15)] cursor-pointer"
            >
              Start Building Now
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/docs/introduction"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/20 backdrop-blur-md px-10 py-4 text-sm font-semibold text-zinc-300 hover:bg-zinc-900/60 hover:text-white transition-all cursor-pointer"
            >
              Read Philosophy
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
