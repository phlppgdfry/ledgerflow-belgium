import { assertTransition, canTransition, type AuditEvent, type DocumentStatus } from './ledger.js';
import { splitVat } from './money.js';

export type FinancialDocument = {
  id: string;
  kind: 'PURCHASE' | 'SALE';
  supplier: string;
  invoiceNumber: string;
  grossCents: number;
  vatRateBasisPoints: number;
  dueDate: string;
  receivedAt: string;
  status: DocumentStatus;
  category: string;
  confidence: number;
  idempotencyKey: string;
  needsAttention: boolean;
};

export type ImportInput = Omit<
  FinancialDocument,
  'id' | 'receivedAt' | 'status' | 'needsAttention'
>;

export type Dashboard = {
  documents: FinancialDocument[];
  auditEvents: AuditEvent[];
  metrics: {
    receivableCents: number;
    recoverableVatCents: number;
    reviewCount: number;
    postedCount: number;
  };
};

/** Below this extraction confidence a human must look at the document before it can be approved. */
export const REVIEW_THRESHOLD = 0.85;

export class TransitionError extends Error {}
export class NotFoundError extends Error {}

const DAY = 86_400_000;
const isoDay = (now: Date, offsetDays: number) =>
  new Date(now.getTime() + offsetDays * DAY).toISOString().slice(0, 10);

/** Demo data is relative to "now", so the dashboard never looks months out of date. */
export function demoDocuments(now = new Date()): FinancialDocument[] {
  const year = now.getFullYear();
  return [
    {
      id: 'doc-1001',
      kind: 'PURCHASE',
      supplier: 'Proximus NV',
      invoiceNumber: `PRX-${year}-08112`,
      grossCents: 9980,
      vatRateBasisPoints: 2100,
      dueDate: isoDay(now, 9),
      receivedAt: isoDay(now, 0),
      status: 'REVIEW_REQUIRED',
      category: 'Telecom',
      confidence: 0.74,
      idempotencyKey: `mail:prx-${year}-08112`,
      needsAttention: true,
    },
    {
      id: 'doc-1002',
      kind: 'SALE',
      supplier: 'Studio North',
      invoiceNumber: `LF-${year}-0042`,
      grossCents: 181500,
      vatRateBasisPoints: 2100,
      dueDate: isoDay(now, 14),
      receivedAt: isoDay(now, -16),
      status: 'POSTED',
      category: 'Consulting',
      confidence: 0.99,
      idempotencyKey: 'peppol:0088:LF42',
      needsAttention: false,
    },
    {
      id: 'doc-1003',
      kind: 'PURCHASE',
      supplier: 'Adobe Systems',
      invoiceNumber: 'AD-44718',
      grossCents: 7260,
      vatRateBasisPoints: 2100,
      dueDate: isoDay(now, 5),
      receivedAt: isoDay(now, -3),
      status: 'APPROVED',
      category: 'Software',
      confidence: 0.96,
      idempotencyKey: 'mail:ad-44718',
      needsAttention: false,
    },
    {
      id: 'doc-1004',
      kind: 'PURCHASE',
      supplier: 'Stationery Hub',
      invoiceNumber: 'SH-00391',
      grossCents: 4538,
      vatRateBasisPoints: 2100,
      dueDate: isoDay(now, 3),
      receivedAt: isoDay(now, -2),
      status: 'VALIDATED',
      category: 'Office',
      confidence: 0.92,
      idempotencyKey: 'upload:sha-8737',
      needsAttention: false,
    },
    {
      id: 'doc-1005',
      kind: 'PURCHASE',
      supplier: 'Boekhandel De Reyghere',
      invoiceNumber: 'DR-2231',
      grossCents: 4240,
      vatRateBasisPoints: 600,
      dueDate: isoDay(now, 21),
      receivedAt: isoDay(now, -1),
      status: 'RECEIVED',
      category: 'Books',
      confidence: 0.88,
      idempotencyKey: 'upload:sha-91c2',
      needsAttention: false,
    },
  ];
}

/**
 * In-memory ledger used by the local API and by the browser-only demo.
 * Production swaps this for DynamoDB with conditional writes; the rules stay identical.
 */
export class InMemoryLedger {
  private documents: FinancialDocument[];
  private auditEvents: AuditEvent[];
  private sequence = 0;

  constructor(
    seed: FinancialDocument[] = demoDocuments(),
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.documents = seed.map((d) => ({ ...d }));
    this.auditEvents = [...this.documents]
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .map((d) =>
        this.event(
          d.id,
          'DOCUMENT_IMPORTED',
          'system',
          `import-${d.id}`,
          `Imported ${d.invoiceNumber} through a verified channel.`,
          `${d.receivedAt}T09:00:00.000Z`,
        ),
      );
  }

  private event(
    documentId: string,
    type: AuditEvent['type'],
    actor: string,
    correlationId: string,
    detail: string,
    occurredAt = this.clock().toISOString(),
  ): AuditEvent {
    this.sequence += 1;
    return {
      id: `audit-${String(this.sequence).padStart(4, '0')}`,
      documentId,
      type,
      actor,
      occurredAt,
      correlationId,
      detail,
    };
  }

  dashboard(): Dashboard {
    const live = this.documents.filter((d) => d.status !== 'REJECTED');
    return {
      documents: this.documents.map((d) => ({ ...d })),
      auditEvents: [...this.auditEvents].reverse(),
      metrics: {
        receivableCents: live
          .filter((d) => d.kind === 'SALE' && d.status === 'POSTED')
          .reduce((s, d) => s + d.grossCents, 0),
        // Uses the tested VAT primitive per document: each document has its own rate (21%, 12%, 6%, 0%).
        recoverableVatCents: live
          .filter((d) => d.kind === 'PURCHASE')
          .reduce((s, d) => s + splitVat(d.grossCents, d.vatRateBasisPoints).vat.cents, 0),
        reviewCount: this.documents.filter((d) => d.needsAttention).length,
        postedCount: this.documents.filter((d) => d.status === 'POSTED').length,
      },
    };
  }

  transition(
    id: string,
    status: DocumentStatus,
    actor: string,
    correlationId: string,
  ): FinancialDocument {
    const document = this.documents.find((d) => d.id === id);
    if (!document) throw new NotFoundError('Document not found.');
    try {
      assertTransition(document.status, status);
    } catch (error) {
      throw new TransitionError((error as Error).message);
    }
    if (
      status === 'APPROVED' &&
      document.status === 'VALIDATED' &&
      document.confidence < REVIEW_THRESHOLD
    ) {
      throw new TransitionError(
        `Extraction confidence ${Math.round(document.confidence * 100)}% is below ${REVIEW_THRESHOLD * 100}%: request a review first.`,
      );
    }
    const previous = document.status;
    document.status = status;
    document.needsAttention = status === 'REVIEW_REQUIRED';
    this.auditEvents.push(
      this.event(
        id,
        status === 'POSTED' ? 'DOCUMENT_POSTED' : 'STATUS_CHANGED',
        actor,
        correlationId,
        `Status changed from ${previous} to ${status}.`,
      ),
    );
    return { ...document };
  }

  /** Idempotent: the same idempotency key always returns the first document and creates nothing new. */
  import(
    input: ImportInput,
    correlationId: string,
  ): { document: FinancialDocument; duplicate: boolean } {
    const existing = this.documents.find((d) => d.idempotencyKey === input.idempotencyKey);
    if (existing) {
      this.auditEvents.push(
        this.event(
          existing.id,
          'FIELD_CORRECTED',
          'system',
          correlationId,
          `Duplicate delivery of ${existing.invoiceNumber} ignored (idempotency key ${input.idempotencyKey}).`,
        ),
      );
      return { document: { ...existing }, duplicate: true };
    }
    const document: FinancialDocument = {
      ...input,
      id: `doc-${1000 + this.documents.length + 1}`,
      receivedAt: this.clock().toISOString().slice(0, 10),
      status: 'RECEIVED',
      needsAttention: false,
    };
    this.documents.push(document);
    this.auditEvents.push(
      this.event(
        document.id,
        'DOCUMENT_IMPORTED',
        'system',
        correlationId,
        `Received ${input.invoiceNumber}; queued for validation.`,
      ),
    );
    return { document: { ...document }, duplicate: false };
  }
}

/** The actions an operator may take next, in the order the UI shows them. */
export function nextActions(
  document: Pick<FinancialDocument, 'status' | 'confidence'>,
): DocumentStatus[] {
  // Forward step first, then the step back, then rejection.
  const order: DocumentStatus[] = [
    'VALIDATED',
    'APPROVED',
    'POSTED',
    'REVIEW_REQUIRED',
    'REJECTED',
  ];
  return order.filter((to) => {
    if (!canTransition(document.status, to)) return false;
    if (
      to === 'APPROVED' &&
      document.status === 'VALIDATED' &&
      document.confidence < REVIEW_THRESHOLD
    )
      return false;
    return true;
  });
}
