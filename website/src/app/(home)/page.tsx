import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center text-center flex-1 px-4 py-16">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="Alvyn logo"
        width={220}
        height={220}
        className="rounded-xl mb-6"
      />
      <p className="text-sm font-medium text-fd-muted-foreground mb-4 tracking-wide uppercase">
        Event Sourcing for Node.js
      </p>
      <h1 className="text-5xl font-bold tracking-tight mb-6">
        Alvyn
      </h1>
      <p className="text-lg text-fd-muted-foreground max-w-xl mb-8 leading-relaxed">
        A production-grade event store for PostgreSQL. Type-safe aggregates,
        GDPR crypto-shredding, projections, transactional outbox, and schema
        evolution — all in one library.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs"
          className="inline-flex items-center justify-center rounded-md bg-fd-primary px-6 py-2.5 text-sm font-medium text-fd-primary-foreground shadow hover:bg-fd-primary/90 transition-colors"
        >
          Get Started
        </Link>
        <Link
          href="https://github.com/lox-solutions/alvyn"
          className="inline-flex items-center justify-center rounded-md border border-fd-border px-6 py-2.5 text-sm font-medium hover:bg-fd-accent transition-colors"
        >
          GitHub
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-16 max-w-3xl w-full text-left">
        <div className="rounded-lg border border-fd-border p-5">
          <h3 className="font-semibold mb-2">Type-Safe Aggregates</h3>
          <p className="text-sm text-fd-muted-foreground">
            Define event maps, evolve handlers, and snapshots with full
            TypeScript inference. No casting required.
          </p>
        </div>
        <div className="rounded-lg border border-fd-border p-5">
          <h3 className="font-semibold mb-2">GDPR Crypto-Shredding</h3>
          <p className="text-sm text-fd-muted-foreground">
            Per-entity AES-256-GCM envelope encryption. Revoke a key and all
            PII becomes cryptographically irrecoverable.
          </p>
        </div>
        <div className="rounded-lg border border-fd-border p-5">
          <h3 className="font-semibold mb-2">Built for PostgreSQL</h3>
          <p className="text-sm text-fd-muted-foreground">
            Advisory locks, OCC, transactional outbox, and projection
            checkpoints — all using native PostgreSQL features.
          </p>
        </div>
      </div>
    </div>
  );
}
