import type { BrowserSessionReference } from "./browser-account-session-manager.js";

export const DEFAULT_PENDING_BROWSER_ACCOUNT_REFERENCE_TTL_MS = 15 * 60 * 1_000;

export interface PendingBrowserAccountReference {
  accountKey: string;
  baseUrl: string;
  sessionId: string;
  reference: BrowserSessionReference;
}

export interface PendingBrowserAccountReferenceRegistryDependencies {
  createReference: (baseUrl: string) => BrowserSessionReference;
  createSessionId: () => string;
  buildAccountKey: (baseUrl: string, sessionId: string) => string;
  discardReference: (accountKey: string, browserSessionId: string) => Promise<void>;
  ttlMs?: number;
  onDiscardError?: (error: unknown) => void;
}

interface PendingEntry extends PendingBrowserAccountReference {
  expirationTimer?: ReturnType<typeof setTimeout>;
}

export class PendingBrowserAccountReferenceRegistry {
  private readonly entries = new Map<string, PendingEntry>();
  private readonly attempts = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dependencies: PendingBrowserAccountReferenceRegistryDependencies,
  ) {}

  run<T>(
    baseUrl: string,
    operation: (pending: PendingBrowserAccountReference) => Promise<T>,
  ): Promise<T> {
    const existingAttempt = this.attempts.get(baseUrl);
    if (existingAttempt) {
      return existingAttempt as Promise<T>;
    }

    const entry = this.acquire(baseUrl);
    const attempt = Promise.resolve()
      .then(() => operation(entry))
      .then((result) => {
        this.consume(entry);
        return result;
      })
      .catch((error: unknown) => {
        this.retainTemporarily(entry);
        throw error;
      })
      .finally(() => {
        if (this.attempts.get(baseUrl) === attempt) {
          this.attempts.delete(baseUrl);
        }
      });
    this.attempts.set(baseUrl, attempt);
    return attempt;
  }

  async shutdown(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      if (entry.expirationTimer) clearTimeout(entry.expirationTimer);
    }
    await Promise.all(entries.map((entry) => this.discard(entry)));
  }

  private acquire(baseUrl: string): PendingEntry {
    const existing = this.entries.get(baseUrl);
    if (existing) {
      if (existing.expirationTimer) {
        clearTimeout(existing.expirationTimer);
        existing.expirationTimer = undefined;
      }
      return existing;
    }

    const sessionId = this.dependencies.createSessionId();
    const entry: PendingEntry = {
      accountKey: this.dependencies.buildAccountKey(baseUrl, sessionId),
      baseUrl,
      sessionId,
      reference: this.dependencies.createReference(baseUrl),
    };
    this.entries.set(baseUrl, entry);
    return entry;
  }

  private consume(entry: PendingEntry): void {
    if (this.entries.get(entry.baseUrl) !== entry) return;
    if (entry.expirationTimer) clearTimeout(entry.expirationTimer);
    this.entries.delete(entry.baseUrl);
  }

  private retainTemporarily(entry: PendingEntry): void {
    if (this.entries.get(entry.baseUrl) !== entry) return;
    if (entry.expirationTimer) clearTimeout(entry.expirationTimer);
    entry.expirationTimer = setTimeout(() => {
      if (this.entries.get(entry.baseUrl) !== entry) return;
      this.entries.delete(entry.baseUrl);
      void this.discard(entry);
    }, this.dependencies.ttlMs ?? DEFAULT_PENDING_BROWSER_ACCOUNT_REFERENCE_TTL_MS);
  }

  private async discard(entry: PendingEntry): Promise<void> {
    try {
      await this.dependencies.discardReference(
        entry.accountKey,
        entry.reference.browserSessionId,
      );
    } catch (error) {
      this.dependencies.onDiscardError?.(error);
    }
  }
}
