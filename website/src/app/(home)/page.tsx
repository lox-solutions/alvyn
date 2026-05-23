import Link from 'next/link';
import { basePath } from '@/lib/shared';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center flex-1 overflow-hidden">

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="relative w-full min-h-[92vh] flex flex-col items-center justify-center px-6 text-center">

        {/* grid background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(var(--color-fd-foreground) 1px, transparent 1px), linear-gradient(90deg, var(--color-fd-foreground) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--color-fd-primary) 0%, transparent 70%)' }}
        />

        <div className="relative z-10 flex flex-col items-center">
          {/* logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${basePath}/logo.png`}
            alt="Alvyn"
            width={72}
            height={72}
            className="rounded-xl mb-10 shadow-lg"
          />

          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-fd-border px-4 py-1.5 text-xs font-semibold tracking-[0.2em] uppercase text-fd-muted-foreground"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-fd-primary"
              style={{ boxShadow: '0 0 6px var(--color-fd-primary)' }}
            />
            Event Sourcing · PostgreSQL · Node.js
          </div>

          <h1
            className="text-5xl sm:text-6xl md:text-8xl font-black tracking-[-0.04em] leading-[0.95] mb-8 max-w-5xl"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            Your data tells<br />
            <span style={{ color: 'var(--color-fd-primary)' }}>the whole story.</span>
          </h1>

          <p className="text-lg md:text-xl text-fd-muted-foreground max-w-2xl mb-12 leading-relaxed font-light">
            In the AI era, features are commodities. The only defensible moat is{' '}
            <em className="not-italic font-semibold text-fd-foreground">domain-specific, high-fidelity data</em>.
            Alvyn captures every business intent as an immutable event — so your system remembers everything, forever.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg px-7 py-3.5 text-sm font-bold text-fd-primary-foreground transition-all hover:opacity-90 hover:scale-[1.02]"
              style={{ background: 'var(--color-fd-primary)' }}
            >
              Get Started
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M8 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <Link
              href="https://github.com/lox-solutions/alvyn"
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-7 py-3.5 text-sm font-bold hover:bg-fd-accent transition-all"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              GitHub
            </Link>
          </div>
        </div>

        {/* scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-30">
          <div className="w-px h-12 bg-fd-foreground" />
        </div>
      </section>

      {/* ── THESIS ───────────────────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border">
        <div className="max-w-6xl mx-auto px-6 py-28 grid grid-cols-1 md:grid-cols-2 gap-24">

          {/* Pillar 1 */}
          <div>
            <p className="text-xs font-bold tracking-[0.25em] uppercase text-fd-primary mb-6">01 — The AI Shift</p>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight mb-6">
              Software is a commodity.<br />Data is the moat.
            </h2>
            <p className="text-fd-muted-foreground leading-relaxed mb-6">
              Vibe-coding tools can ship a feature in minutes. Foundation models can replicate your UI overnight.
              The a16z 2025 report is unambiguous: <em className="not-italic font-semibold text-fd-foreground">as model capabilities commoditize, scarcity shifts to data.</em>
            </p>
            <p className="text-fd-muted-foreground leading-relaxed">
              The companies that win the next decade are moving up the stack —
              from <strong>Software</strong> to <strong>Platform</strong> to <strong>Data Ecosystem</strong>.
              Domain-specific, high-fidelity event data is the one asset AI cannot synthesize for you.
            </p>
          </div>

          {/* Pillar 2 */}
          <div>
            <p className="text-xs font-bold tracking-[0.25em] uppercase text-fd-primary mb-6">02 — Domain Reality</p>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight mb-6">
              Business isn&apos;t<br />representable in CRUD.
            </h2>
            <p className="text-fd-muted-foreground leading-relaxed mb-6">
              When you reduce a domain to rows and columns, you lose the <em className="not-italic font-semibold text-fd-foreground">intent behind every action</em>.
              A customer didn&apos;t &ldquo;update their order&rdquo; — they cancelled, disputed, and re-ordered under a promotion.
            </p>
            <p className="text-fd-muted-foreground leading-relaxed">
              In the age of agentic AI, coding is no longer the hard part.
              Product engineering and domain modeling are. Engineers who can capture business reality in code
              become the most valuable people in the room.
            </p>
          </div>
        </div>
      </section>

      {/* ── WHAT ALVYN DOES ──────────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border bg-fd-accent/30">
        <div className="max-w-6xl mx-auto px-6 py-28">
          <p className="text-xs font-bold tracking-[0.25em] uppercase text-fd-primary mb-4">The Solution</p>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-16 max-w-2xl">
            Every business fact, captured. Forever.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                n: '01',
                title: 'Immutable Event Log',
                body: 'Every state change is an append-only fact. Replay history, reconstruct any past state, feed AI agents with ground truth.',
              },
              {
                n: '02',
                title: 'Native PostgreSQL',
                body: 'No new infrastructure. Advisory locks, optimistic concurrency, and transactional outbox — all on the database you already trust.',
              },
              {
                n: '03',
                title: 'GDPR Crypto-Shredding',
                body: 'Per-entity AES-256-GCM encryption. Revoke a key and PII becomes cryptographically irrecoverable — even from immutable logs.',
              },
              {
                n: '04',
                title: 'Schema Evolution',
                body: 'Business domains evolve. Built-in upcasting and versioning ensure your event store evolves without losing historical fidelity.',
              },
              {
                n: '05',
                title: 'Type-Safe Aggregates',
                body: 'Full TypeScript inference across event maps, evolve handlers, and snapshots. No casting. No surprises.',
              },
              {
                n: '06',
                title: 'AI-Ready Audit Trail',
                body: 'Every agent decision is logged, reproducible, and explainable. The foundation for trustworthy agentic systems.',
              },
            ].map(({ n, title, body }) => (
              <div
                key={n}
                className="group rounded-xl border border-fd-border bg-fd-background p-7 hover:border-fd-primary/50 transition-colors"
              >
                <p className="text-xs font-bold tracking-widest text-fd-muted-foreground mb-4">{n}</p>
                <h3 className="text-base font-bold mb-3">{title}</h3>
                <p className="text-sm text-fd-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── QUOTE / MANIFESTO ────────────────────────────────────────── */}
      <section className="w-full border-t border-fd-border">
        <div className="max-w-4xl mx-auto px-6 py-32 text-center">
          <p className="text-2xl md:text-4xl font-black tracking-tight leading-tight mb-8">
            &ldquo;The event log is not a side effect of your system.<br />
            <span style={{ color: 'var(--color-fd-primary)' }}>It is your system.&rdquo;</span>
          </p>
          <p className="text-fd-muted-foreground max-w-xl mx-auto mb-14 leading-relaxed">
            Stop overwriting the present. Start accumulating the past.
            Every event is a data point your AI, your auditors, and your future self will thank you for.
          </p>
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-lg px-8 py-4 text-sm font-bold text-fd-primary-foreground transition-all hover:opacity-90"
            style={{ background: 'var(--color-fd-primary)' }}
          >
            Read the Documentation
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M8 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </Link>
        </div>
      </section>

    </div>
  );
}
