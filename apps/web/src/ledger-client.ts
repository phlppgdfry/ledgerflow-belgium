import {
  InMemoryLedger,
  NotFoundError,
  TransitionError,
  type Dashboard,
  type DocumentStatus,
  type FinancialDocument,
  type ImportInput,
} from '@ledgerflow/core';

export type ImportResult = {
  document: FinancialDocument;
  duplicate: boolean;
  correlationId: string;
};

export class LedgerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly correlationId: string,
  ) {
    super(message);
  }
}

export interface LedgerClient {
  readonly mode: 'api' | 'browser';
  dashboard(): Promise<Dashboard>;
  transition(id: string, status: DocumentStatus, actor: string): Promise<FinancialDocument>;
  import(input: ImportInput): Promise<ImportResult>;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new LedgerRequestError(
      body.message ?? `Request failed (${response.status})`,
      response.status,
      body.correlationId ?? response.headers.get('x-correlation-id') ?? '—',
    );
  }
  return body as T;
}

/** Talks to the Fastify API (local dev or the AWS deployment). */
export const httpClient: LedgerClient = {
  mode: 'api',
  dashboard: () => call('/api/dashboard'),
  transition: (id, status, actor) =>
    call(`/api/documents/${id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, actor }),
    }),
  import: ({ idempotencyKey, ...input }) =>
    call('/api/documents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
};

/**
 * Runs the exact same domain rules in the browser, for the GitHub Pages demo.
 * Errors are mapped to the same status codes the API would return.
 */
export function browserClient(): LedgerClient {
  const ledger = new InMemoryLedger();
  const correlation = () => `web-${Math.random().toString(16).slice(2, 10)}`;
  const run = <T>(fn: (cid: string) => T): Promise<T> => {
    const cid = correlation();
    try {
      return Promise.resolve(fn(cid));
    } catch (error) {
      const status =
        error instanceof TransitionError ? 409 : error instanceof NotFoundError ? 404 : 500;
      return Promise.reject(new LedgerRequestError((error as Error).message, status, cid));
    }
  };
  return {
    mode: 'browser',
    dashboard: () => run(() => ledger.dashboard()),
    transition: (id, status, actor) => run((cid) => ledger.transition(id, status, actor, cid)),
    import: (input) => run((cid) => ({ ...ledger.import(input, cid), correlationId: cid })),
  };
}

export const client: LedgerClient =
  import.meta.env.VITE_LEDGER_MODE === 'browser' ? browserClient() : httpClient;
