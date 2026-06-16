import type { Pool, PoolClient } from "pg";

import { notifyChannel } from "../stream/notify-channel";
import { sleep, type SubscriptionWaker } from "./subscribe";

/**
 * A `LISTEN/NOTIFY`-backed {@link SubscriptionWaker}.
 *
 * It holds a dedicated pooled connection that issues `LISTEN` on the store's
 * per-schema channel. Each appended (committed) transaction fires `pg_notify`
 * on that channel (see `append-to-stream.ts`), which wakes the catch-up loop
 * immediately for sub-second live delivery.
 *
 * Robustness:
 * - **Debounced wake-ups:** notifications received while not waiting set a
 *   pending flag so the next `wait()` returns instantly without missing a wake.
 * - **Reconnect:** if the listen connection drops, it is transparently
 *   re-established on the next `wait()`.
 * - **Polling fallback:** `wait()` always resolves after `timeoutMs` even if a
 *   notification is dropped, guaranteeing eventual delivery.
 *
 * Connection usage: each live subscriber holds one connection for the lifetime
 * of the stream. Consider sharing a listener across subscribers per process if
 * you run many concurrent subscriptions.
 */
class NotifyWaker implements SubscriptionWaker {
  private readonly channel: string;
  private client: PoolClient | null = null;
  /** A notification arrived while we were not actively waiting. */
  private pending = false;
  /** Resolver for an in-flight `wait()`, if any. */
  private wake: (() => void) | null = null;

  constructor(
    private readonly pool: Pool,
    schema: string,
  ) {
    this.channel = notifyChannel(schema);
  }

  private async ensureListening(): Promise<void> {
    if (this.client) return;
    const client = await this.pool.connect();
    client.on("notification", () => this.signal());
    client.on("error", () => {
      // Connection is unhealthy: drop it so the next wait() reconnects, and
      // wake any current waiter so it falls back to a fresh poll.
      this.client = null;
      this.signal();
    });
    await client.query(`LISTEN "${this.channel}"`);
    this.client = client;
  }

  private signal(): void {
    this.pending = true;
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async wait(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;

    try {
      await this.ensureListening();
    } catch {
      // Could not establish the listen connection — fall back to a plain sleep
      // so polling still drives eventual delivery.
      await sleep(timeoutMs, signal);
      return;
    }

    if (this.pending) {
      this.pending = false;
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      const onAbort = (): void => finish();
      this.wake = finish;
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    this.pending = false;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.query(`UNLISTEN *`);
    } catch (error) {
      // best-effort: the connection is being released regardless.
      void error;
    }
    client.release();
  }
}

/** Creates a NOTIFY-backed {@link SubscriptionWaker} for a given pool and schema. */
export function createNotifyWaker(
  pool: Pool,
  schema: string,
): SubscriptionWaker {
  return new NotifyWaker(pool, schema);
}
